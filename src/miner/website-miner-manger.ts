import fs from 'fs'
import { MINER_CONFIG } from '../config'
import { BloomFilter } from '../../libs/bloom-filters/src/api'
import { WebsiteCache } from './website-cache'
import { WebsiteMiner } from './website-miner'
import { IgnoreModel } from '../model/ignore'
import { errout, logout } from '../util/logger-helper'
import { get_hostname } from '../util/request-util'
import { BamblooError, BamblooStatusCode } from '../status'
import { WebsiteModel } from '../model/website'

class HostRecord {
    host: string
    urls: Set<string> = new Set()
    time: number
    error: number
    timeout: number

    constructor(host: string) {
        this.host = host
        this.time = new Date().getTime()
        this.error = 0
        this.timeout = 0
    }

    add(url: string): number {
        if (this.urls.has(url)) {
            return 1
        } else {
            this.urls.add(url)
            if (this.urls.size >= MINER_CONFIG.MAX_PER_HOST) {
                return 2
            }
            this.time = new Date().getTime()
            return 0
        }
    }
}

export class WebsiteMinerManager {
    private bloom_path: string
    private bloom: BloomFilter = new BloomFilter(1, 1)
    private website_cache: WebsiteCache = new WebsiteCache(MINER_CONFIG.WEBSITE_CACHE_PATH)

    private miners: WebsiteMiner[] = []
    private mining: boolean = false
    private mining_count: number = 0
    private bloomed_count: number = 0

    private host_records: Map<string, HostRecord> = new Map()
    private ignore_set: Set<string> = new Set()
    private ignore_regex?: RegExp

    constructor(bloom: string) {
        this.bloom_path = bloom
    }

    add_igore(ign: string) {
        this.ignore_set.add(ign)
        this.update_ignore_regex()
        return IgnoreModel.instance().then(model => {
            return model.insert({ host: ign})
        })
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

    cache_bloom() {
        if (this.bloom) {
            var wstream = fs.createWriteStream(this.bloom_path)
            return this.bloom.saveToStream(wstream)
            .then(() => {
                wstream.close()
            })
        } else {
            return Promise.resolve()
        }
    }

    private initialize() {
        return fs.promises.open(MINER_CONFIG.BLOOM_LOCATION).then(handle => {
            return BloomFilter.fromHandle(handle).then(bloom => {
                this.bloom = bloom
                // logout(`bloom bits: ${this.bloom.length}`)
                handle.close()
            })
        })
        .catch(err => {
            if (err.code == 'ENOENT') {
                this.bloom = BloomFilter.create(4000000000, 0.05)
                return this.cache_bloom()
            } else {
                throw err
            }
        })
        .then(() => {
            return IgnoreModel.instance().then(model => {
                return model.find({}).then(ignores => {
                    for (let ignore of ignores) {
                        this.ignore_set.add(ignore.host)
                    }
                    this.update_ignore_regex()
                })
            })
        })
        .then(() => {
            return this.website_cache.initialize()
        })
    }

    private make_miner_working(miner: WebsiteMiner) {
        if (this.mining && miner.count < MINER_CONFIG.WORK_PER_MINER) {
            this.website_cache.pop().then(website => {
                let hostname = get_hostname(website)
                if (this.bloom.has(hostname)) {
                    throw new BamblooError(BamblooStatusCode.SKIPPED_ITEM, `${hostname} was skipped.`)
                }
                if(this.ignore_regex) {
                    if (this.ignore_regex.test(hostname)) {
                        this.bloom.add(hostname)
                        const message = `${hostname} was ignored.`
                        errout(message)
                        throw new BamblooError(BamblooStatusCode.SKIPPED_ITEM, message)
                    }
                }
                let state = this.ensure_host_record(hostname).add(website)
                switch(state) {
                    case 0:
                        miner.push(website)
                        this.mining_count++
                        this.make_miner_working(miner)
                        break
                    case 1:
                        throw new BamblooError(BamblooStatusCode.SKIPPED_ITEM, `we have crawled on ${website}.`)
                    default:
                        this.bloom_host(hostname)
                        logout(`we crawled too much on ${hostname}.`)
                        throw new BamblooError(BamblooStatusCode.SKIPPED_ITEM, `we crawled too much on ${hostname}.`)
                }
            }).catch(err => {
                this.make_miner_working(miner)
            })
        }
    }

    private ensure_host_record(host: string) {
        var host_record = this.host_records.get(host)
        if (!host_record) {
            host_record = new HostRecord(host)
            this.host_records.set(host, host_record)
        }
        return host_record
    }

    private remove_timedout_records() {
        let remove_before = new Date().getTime() - 15 * 60 * 1000 * 1
        this.host_records.forEach((value, key) => {
            if (value.time <= remove_before) {
                logout(`there has been a while after we crawled ${key}, remove and ignore it.`)
                this.bloom_host(key)
            }
        })
    }

    private bloom_host(host: string) {
        this.bloomed_count += 1
        this.bloom.add(host)
        this.host_records.delete(host)
    }

    private init_miner(miner: WebsiteMiner) {
        let reset_miner = (exitcode: number) => {
            if (this.mining) {
                miner.dump_mining_set()
                miner.hire(reset_miner)
            }
            errout(`${miner.id} miner exited with exitcode  ${exitcode}`)
        }

        miner.on_mined(result => {
            this.mining_count--
            this.make_miner_working(miner)
            if (result.keyword) {
                WebsiteModel.instance().then(model => {
                    return model.insert({ uri : result.website, keyword: result.keyword, confirm : false})
                    .catch(err => {
                        errout(`website insert failed: ${result.website} ${err.message}`)
                    })
                })
            }
            
            var record = this.host_records.get(result.host)
            if (result.err) {
                if (record) {
                    record.error += 1
                    switch(result.err.code) {
                        case BamblooStatusCode.TIMEOUT:
                            record.timeout += 1;
                            if (record.timeout >= 3) {
                                errout(`${record.host} response too slow.`)
                                this.bloom_host(record.host)
                            }
                            break
                        default:
                            if (record.error > 10) {
                                errout(`too much error on ${record.host}, skip it.`)
                                this.bloom_host(record.host)
                            }
                    }
                    this.error_count++
                }
                return
            }
            if (record) {
                record.error = 0
            }
            this.mined_count++

            for (var domestic of result.domestic) {
                if (!this.bloom.has(domestic.host)) {
                    this.website_cache.push(domestic.host, domestic.url)
                }
            }

            for (var foreign of result.foreign) {
                if (!this.bloom.has(foreign.host)) {
                    this.website_cache.push(foreign.host, foreign.url)
                }
            }

        })
        miner.hire(reset_miner)
        this.make_miner_working(miner)
    }
    
    mined_count: number = 0
    error_count: number = 0
    private logger_timer?: NodeJS.Timeout
    private records_checker_timer?: NodeJS.Timeout
    start() {
        return this.initialize().then(() => {
            this.mined_count = 0
            this.error_count = 0
            this.mining = true
            this.bloomed_count = 0
    
            this.logger_timer = setInterval(() => {
                logout(`mined:${this.mined_count},error:${this.error_count},mining:${this.mining_count},bloomed:${this.bloomed_count}`)
            }, 5000)
    
            this.records_checker_timer = setInterval(() => {
                this.remove_timedout_records()
            }, 1 * 60 * 1000)
    
            this.miners = new Array(MINER_CONFIG.MINER_COUNT)
            for (let miner_index = 0; miner_index < MINER_CONFIG.MINER_COUNT; miner_index++) {
                let miner = new WebsiteMiner(miner_index)
                this.init_miner(miner)
                this.miners[miner_index] = miner
            }
        })
    }
    
    stop() {
        return new Promise<void>(resolve => {
            this.mining = false
            let fired_count = 0
            for (let miner of this.miners) {
                miner.fire().then(() =>{
                    fired_count += 1
                    logout(`fired ${miner.id}`)
                    if (fired_count == this.miners.length) {
                        resolve()
                    }
                })
            }
        })
        .then(() => this.website_cache.close())
        .then(() => this.cache_bloom()) 
        .then(() => {
            this.miners = []
            this.website_cache = new WebsiteCache(MINER_CONFIG.WEBSITE_CACHE_PATH)
            this.bloom = new BloomFilter(1, 1)
            this.mining_count = 0
            this.mined_count = 0
            this.error_count = 0

            this.bloomed_count = 0
        
            this.host_records = new Map()
            this.ignore_set = new Set()
            clearInterval(this.logger_timer)
            clearInterval(this.records_checker_timer)
        })
    }
}
