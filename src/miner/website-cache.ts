import fs from 'fs'
import path from 'path'
import { WriteStream } from 'fs'
import { walk, walkSync } from 'walk'
import { Semaphore } from '../util/Semaphore'
import { load } from 'cheerio'
import { logout } from '../util/logger-helper'
import { Transform } from 'stream'
import { MINER_CONFIG } from '../config'
import { get_hostname } from '../util/request-util'

const CACHE_SPLIT = 1024 * 64
const CACHE_COUNT = 4

const CACHE_RING_PERIMETER = 64
const CACHE_RING_HEIGHT = 4096
const CACHE_RING_MAX_SIZE = CACHE_RING_PERIMETER * CACHE_RING_HEIGHT

type HostRingItem = {
    prev: HostRingItem
    next: HostRingItem

    website_set: Set<string>
    host: string
}


enum HostRingPushStatus {
    SUCCESS,
    DUPLICATE,
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
                return HostRingPushStatus.FULL
            }
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
                website_set: new Set(),
                host: host,
                prev: prev,
                next: next
            }
            prev.next = item
            next.prev = item
        } else {
            var item = {
                website_set: new Set(),
                host: host
            } as HostRingItem
            item.next = item
            item.prev = item

            this.current = item
        }
        item.website_set.add(website)
        this.host_website_map.set(host, item)
        this.count += 1
        // console.log(`ring add host:${host}`)
        return HostRingPushStatus.SUCCESS
    }

    pop(): string {
        if (this.current) {
            var item = this.current.website_set.values().next().value as unknown as string
            this.current.website_set.delete(item)
            this.count--

            if (!this.current.website_set.size) {
                this.host_website_map.delete(this.current.host)
                // console.log(`ring rmv host:${this.current.host}`)
                if (this.current.next == this.current) {
                    this.current = undefined
                } else {
                    this.current.prev.next = this.current.next
                    this.current.next.prev = this.current.prev
                    this.current = this.current.next
                }
            } else{
                this.current = this.current.next
            }
            return item
        }
        return ""
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
    cache_base: string
    ring_sema: Semaphore = new Semaphore("website-cache-ring")
    ring: HostRing = new HostRing()

    cache_split_cursor: number = 0
    cache_split: string[][] = []
    cache_files: string[] = []

    writing_file?: string
    writing_stream?: WriteStream
    writing_count: number = 0

    constructor(cache_base: string) {
        this.cache_base = cache_base
        fs.mkdirSync(cache_base, { recursive : true, })
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

    logger_timer?: NodeJS.Timeout
    initialize() {
        this.logger_timer = setInterval(() => {
            logout(`ring size:${this.ring.count},perimeter:${this.ring.host_website_map.size},splits:${this.cache_split.length}`)
        }, 5000)
        return new Promise<void>((resolve, reject) => {
            var walker = walk(this.cache_base)
            walker.on('file', (base, stat, next) => {
                this.cache_files.push(path.join(base, stat.name))
                next()
            })
            walker.on('end', resolve)
        }).then(() => {
            if (this.cache_files.length == 0) {
                this.push(get_hostname(MINER_CONFIG.ENTRY_DOMAIN), MINER_CONFIG.ENTRY_DOMAIN,)
            }
            return this.load_cache()
        }).then(() => {
            return this.switch_cache_file()
        })
    }

    write_website_to_file(website: string) {
        this.writing_stream?.write(`${website}\n`)
        if (++this.writing_count >= CACHE_SPLIT) {
            this.switch_cache_file()
        }
    }

    push(host: string, website: string) {
        switch(this.ring.push(host, website)) {
            case HostRingPushStatus.SUCCESS:
                return this.ring_sema.produce(1)
            case HostRingPushStatus.DUPLICATE:
                return
            default:
                this.write_website_to_file(website)
        }
    }

    pop(): Promise<string> {
        return this.ring_sema.consume().then(() => {
            this.fill_ring()
            var item = this.ring.pop()
            if (!item) {
                console.log("error")
            }
            // console.log(item, this.ring.count)
            return item as string
        })
    }

    private fill_ring() {
        var item: string
        var count = 0
    out:while(this.cache_split.length) {
            var current_cache = this.cache_split[0]
            while(this.cache_split_cursor < current_cache.length) {
                var website = current_cache[this.cache_split_cursor]
                var host = get_hostname(website)
                var status = this.ring.push(host, website)
                if (status == HostRingPushStatus.SUCCESS) {
                    count += 1
                } else if (status == HostRingPushStatus.FULL){
                    this.write_website_to_file(website)
                }
                this.cache_split_cursor++
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
        fs.promises.readFile(next_file, 'utf-8').then(str => {
            if (str.length) {
                let split = str.trim().split("\n")
                this.cache_split.push(split)
            }
            fs.promises.rm(next_file)
            this.fill_ring()
            this.loading_cache = false
            this.load_cache()
        })
    }

    close() {
        return new Promise((resolve, reject) => {
            var write_file_path = path.join(this.cache_base, `${new Date().toISOString().replaceAll(':', '').toString()}.txt`)
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
            this.ring_sema.close()
            this.ring_sema = new Semaphore("website-cache-ring")
            this.ring = new HostRing()
            this.cache_split_cursor = 0
            this.cache_split = []
            this.cache_files = []
            delete this.writing_file
            this.writing_stream?.close()
            this.writing_count = 0
            clearInterval(this.logger_timer)
        })
    }
}