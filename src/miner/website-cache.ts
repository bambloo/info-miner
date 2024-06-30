import fs from 'fs'
import path from 'path'
import { WriteStream } from 'fs'
import { walk } from 'walk'
import { Semaphore } from '../util/Semaphore'
import { errout, logout } from '../util/logger-helper'
import { Transform } from 'stream'
import { MINER_CONFIG } from '../config'
import { get_hostname } from '../util/request-util'
import { BamblooError, BamblooStatusCode } from '../status'
import { BloomFilter } from '../../libs/bloom-filters/src/api'
import { IgnoreModel } from '../model/ignore'

const CACHE_SPLIT = 1024 * 64
const CACHE_COUNT = 4

const CACHE_RING_PERIMETER = MINER_CONFIG.MINER_COUNT * MINER_CONFIG.WORK_PER_MINER / 2
const CACHE_RING_HEIGHT = MINER_CONFIG.MAX_PER_HOST
type HostRingItem = {
    prev: HostRingItem
    next: HostRingItem
    tomine_list: string[]
    website_set: Set<string>
    mining_count: number
    host: string
}

enum HostRingPushStatus {
    SUCCESS,
    DUPLICATE,
    SKIP,
    FULL
}

class HostRing {
    count: number = 0
    current?: HostRingItem

    host_website_map: Map<string, HostRingItem> = new Map()

    push(host: string, website: string): HostRingPushStatus {
        var ring_item = this.host_website_map.get(host)
        if (ring_item) {
            if (ring_item.website_set.has(website)) {
                return HostRingPushStatus.DUPLICATE
            }
            if (ring_item.website_set.size >= CACHE_RING_HEIGHT) {
                return HostRingPushStatus.SKIP
            }
            ring_item.tomine_list.push(website)
            ring_item.website_set.add(website)
            this.count += 1
            return HostRingPushStatus.SUCCESS
        }
        if (this.host_website_map.size >= CACHE_RING_PERIMETER) {
            return HostRingPushStatus.FULL
        }
        if (this.current) {
            var prev = this.current
            var next = this.current.next
            var item: HostRingItem = {
                prev: prev,
                next: next,
                tomine_list: [],
                website_set: new Set(),
                mining_count: 0,
                host: host,
            }
            prev.next = item
            next.prev = item
        } else {
            var item = {
                tomine_list: [],
                website_set: new Set(),
                mining_count: 0,
                host: host,
            } as unknown as HostRingItem
            item.next = item
            item.prev = item

            this.current = item
        }
        item.tomine_list.push(website)
        item.website_set.add(website)
        this.host_website_map.set(host, item)

        this.count += 1
        // console.log(`ring add host:${host}`)
        return HostRingPushStatus.SUCCESS
    }

    pop(): string {
        if (this.count && this.current) {
            while(!this.current.tomine_list.length) {
                this.current = this.current.next
            }

            var item = this.current.tomine_list.pop() as string
            this.current.mining_count += 1
            this.current = this.current.next
            this.count -= 1

            return item
        }
        throw new BamblooError(BamblooStatusCode.NON_EXISTS, "there is no more item")
    }

    mined(host: string, website: string):boolean {
        var host_item = this.host_website_map.get(host)
        if (!host_item || !host_item.website_set.has(website)) {
            throw new BamblooError(BamblooStatusCode.NON_EXISTS, `there is no host or website:${website}`)
        }
        host_item.mining_count -= 1

        if (!host_item.tomine_list.length && !host_item.mining_count) {
            this.host_website_map.delete(host)
            if (this.host_website_map.size) {
                if (this.current === host_item) {
                    this.current = host_item.next
                }
                host_item.prev.next = host_item.next
                host_item.next.prev = host_item.prev
            } else {
                delete this.current
            }
            // logout(`${host} mined ${host_item.website_set.size}`)
            return true
        }
        return false
    }

    to_stream(ws: WriteStream) {
        this.host_website_map.forEach((value, key) => {
            value.website_set.forEach(v => {
                ws.write(`${v}\n`)
            })
        })
    }
}

export class WebsiteCache {
    private bloom_path: string
    private bloom_bkup: string

    private bloom: BloomFilter = new BloomFilter(1, 1)
    private bloom_saving: boolean = false
    private bloom_count: number = 0
    
    private cache_base: string
    private ring_sema: Semaphore = new Semaphore("website-cache-ring")
    private ring: HostRing = new HostRing()

    private cache_split_cursor: number = 0
    private cache_split: string[][] = []
    private cache_files: string[] = []

    private writing_file?: string
    private writing_stream?: WriteStream
    private writing_count: number = 0

    private ignore_set: Set<string> = new Set()
    private ignore_regex?: RegExp

    constructor(cache_base: string, bloom: string) {
        this.cache_base = cache_base
        this.bloom_path = bloom
        this.bloom_bkup = `${this.bloom_path}.bkup`
        fs.mkdirSync(cache_base, { recursive : true, })
    }
    
    private initialize_bloom_backup() {
        var stat_bloom: fs.Stats
        var stat_bakup: fs.Stats

        return fs.promises.stat(this.bloom_bkup).then(stat => {
            stat_bakup = stat
        })
        .catch(err => {})
        .then(() => {
            return fs.promises.stat(this.bloom_path).then(stat => {
                stat_bloom = stat
            })
        }).catch(err => {})
        .then(() => {
            if (stat_bloom) {
                if (stat_bakup) {
                    if (stat_bakup.size >= stat_bloom.size && stat_bakup.mtime > stat_bloom.mtime) {
                        return fs.promises.rm(this.bloom_path, { force : true }).then(() => {
                            return fs.promises.rename(this.bloom_bkup, this.bloom_path)
                        })
                    }
                }
                return fs.promises.rm(this.bloom_bkup, { force : true })
            } else {
                throw new BamblooError(BamblooStatusCode.PROCEDURE, 'no bloom found')
            }
        })
    }

    private initialize_bloom() {
        return this.initialize_bloom_backup().then(() => {
            return fs.promises.open(this.bloom_path).then(handle => {
                return BloomFilter.fromHandle(handle).then(bloom => {
                    this.bloom = bloom
                    // logout(`bloom bits: ${this.bloom.length}`)
                    handle.close()
                })
            })
        })
        .catch(err => {
            this.bloom = BloomFilter.create(4000000000, 0.05)
            return this.bloom_save()
        })
    }

    private initialize_cache_list() {
        return new Promise<void>((resolve, reject) => {
            var walker = walk(this.cache_base)
            walker.on('file', (base, stat, next) => {
                this.cache_files.push(path.join(base, stat.name))
                next()
            })
            walker.on('end', resolve)
        })
        .then(() => {
            if (this.cache_files.length == 0) {
                this.push(get_hostname(MINER_CONFIG.ENTRY_DOMAIN), MINER_CONFIG.ENTRY_DOMAIN,)
            }
            return this.load_cache()
        })
    }

    private bloom_save() {
        // logout(`saving bloom to file`)
        var wstream = fs.createWriteStream(this.bloom_bkup)
        return this.bloom.saveToStream(wstream)
        .then(() => {
            return new Promise(resolve => {
                wstream.close(resolve)
            })
            .then(() => {
                return fs.promises.rm(this.bloom_path, { force : true }).then(() => {
                    return fs.promises.rename(this.bloom_bkup, this.bloom_path)
                })
            })
        })
    }

    private bloom_host(host: string) {
        this.bloom_count += 1
        this.bloom.add(host)

        if (this.bloom_saving) {
            return
        }
        this.bloom_saving = true
        this.bloom_save().finally(() => {
            this.bloom_saving = false
        })
    }

    ignore_add(ign: string) {
        this.ignore_set.add(ign)
        this.update_ignore_regex()
        return IgnoreModel.instance().then(model => {
            return model.insert({ host: ign})
        })
    }

    private switch_cache_file() {
        if (this.writing_file) {
            this.cache_files.push(this.writing_file)
            this.writing_stream?.close()
        }
        this.writing_file = path.join(this.cache_base, `${new Date().toISOString().replaceAll(':', '').toString()}.txt`)
        this.writing_stream = fs.createWriteStream(this.writing_file)
        this.writing_count = 0
    }
    
    private update_ignore_regex() {
        if (this.ignore_set.size) {
            var pattern = `${Array.from(this.ignore_set).map(value => `.*\\.${value}$`).join("|")}`
            logout(`ignore pattern: ${pattern}`)
            this.ignore_regex = new RegExp(pattern)
        } else {
            delete this.ignore_regex
        }
    }

    private initialize_ignore_list() {
        return IgnoreModel.instance().then(model => {
            return model.find({}).then(ignores => {
                for (let ignore of ignores) {
                    this.ignore_set.add(ignore.host)
                }
                this.update_ignore_regex()
            })
        })
    }

    logger_timer?: NodeJS.Timeout
    initialize() {
        this.logger_timer = setInterval(() => {
            logout(`ring size:${this.ring.count},perimeter:${this.ring.host_website_map.size},splits:${this.cache_split.length},bloomed:${this.bloom_count}`)
        }, 30000)
        
        return Promise.resolve()
        .then(() => this.initialize_ignore_list())
        .then(() => this.initialize_bloom())
        .then(() => this.initialize_cache_list())
        .then(() => this.switch_cache_file())
    }

    write_website_to_file(website: string) {
        this.writing_stream?.write(`${website}\n`)
        if (++this.writing_count >= CACHE_SPLIT) {
            this.switch_cache_file()
        }
    }

    push(host: string, website: string) {
        if (this.bloom.has(host)) {
            return
        }
        switch(this.ring.push(host, website)) {
            case HostRingPushStatus.SUCCESS:
                return this.ring_sema.produce(1)
            case HostRingPushStatus.DUPLICATE:
            case HostRingPushStatus.SKIP:
                return    
            default:
                this.write_website_to_file(website)
        }
    }

    pop(): Promise<string> {
        return this.ring_sema.consume().then(() => {
            var item = this.ring.pop()
            if (!item) {
                console.log("error")
            }
            // console.log(item, this.ring.count)
            return item as string
        })
    }

    mined(host: string, website: string) {
        const res = this.ring.mined(host, website)
        if (res) {
            this.bloom_host(host)
        }
        this.fill_ring()
    }

    private fill_ring() {
        var item: string
        var count = 0
    out:while(this.cache_split.length && this.ring.host_website_map.size < CACHE_RING_PERIMETER) {
            var current_cache = this.cache_split[0]
            while(this.cache_split_cursor < current_cache.length) {
                var website = current_cache[this.cache_split_cursor++]

                var host = get_hostname(website)

                if (this.bloom.has(host)) {
                    continue
                } else if(this.ignore_regex) {
                    if (this.ignore_regex.test(host)) {
                        this.bloom_host(host)
                        const message = `${host} was ignored.`
                        errout(message)
                        continue
                    }
                }

                var status = this.ring.push(host, website)
                if (status == HostRingPushStatus.SUCCESS) {
                    count += 1
                }

                if (this.ring.host_website_map.size >= CACHE_RING_PERIMETER) {
                    break out
                }
            }
            this.cache_split_cursor = 0
            this.cache_split.shift()
        }
        this.ring_sema.produce(count)
        this.load_cache()
    }

    private loading_cache = false
    private load_cache() {
        if (this.loading_cache || this.cache_split.length >= CACHE_COUNT || !this.cache_files.length) {
            return
        }
        this.loading_cache = true
        let next_file = this.cache_files.shift() as string
        // errout(`load next_file: ${next_file}`)
        return fs.promises.readFile(next_file, 'utf-8').then(str => {
            if (str.length) {
                let split = str.trim().split("\n")
                this.cache_split.push(split)
            }
            // errout(`loaded file: ${next_file}`)
            fs.promises.rm(next_file)
            this.fill_ring()
            this.loading_cache = false
            this.load_cache()
        })
    }

    close() {
        return new Promise((resolve, reject) => {
            var write_file_path = path.join(this.cache_base, `${new Date(0).toISOString().replaceAll(':', '').toString()}.txt`)
            var write_file_stream = fs.createWriteStream(write_file_path)
    
            var transform = new Transform()
            transform.pipe(write_file_stream)
            this.ring.to_stream(write_file_stream)
            for (let item of this.cache_split) {
                for (let i of item) {
                    transform.push(`${i}\n`)
                }
            }
            transform.end()
            write_file_stream.on('finish', resolve)
            this.writing_stream?.close()
        })
        .then(() => {       
            this.bloom = new BloomFilter(1, 1)
            this.bloom_saving = false
            this.bloom_count = 0

            this.ring_sema.close()
            this.ring_sema = new Semaphore("website-cache-ring")
            this.ring = new HostRing()
            
            this.cache_split_cursor = 0
            this.cache_split = []
            this.cache_files = []
        
            delete this.writing_file
            this.writing_stream?.close()
            this.writing_count = 0
        
            this.ignore_set = new Set()
            delete this.ignore_regex 

            clearInterval(this.logger_timer)
        })
    }
}