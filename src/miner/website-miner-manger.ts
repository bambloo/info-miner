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

    constructor(host: string) {
        this.host = host
        this.time = new Date().getTime()
        this.error = 0
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
    bloom_path: string
    bloom: BloomFilter = new BloomFilter(1, 1)
    website_cache: WebsiteCache

    miners: WebsiteMiner[] = []
    mining: boolean = false
    mining_count: number = 0
    bloomed_count: number = 0

    private host_records: Map<string, HostRecord> = new Map()

    static ignore_set: Set<string> = new Set()

    stop_resolver?: () => void

    constructor(bloom: string) {
        this.bloom_path = bloom
        this.website_cache = new WebsiteCache(MINER_CONFIG.WEBSITE_CACHE_PATH)
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

    initialize() {
        return fs.promises.open(MINER_CONFIG.BLOOM_LOCATION).then(handle => {
            return BloomFilter.fromHandle(handle).then(bloom => {
                this.bloom = bloom
                handle.close()
            })
        })
        .then(() => {
            return IgnoreModel.instance().then(model => {
                return model.find({}).then(ignores => {
                    for (let ignore of ignores) {
                        WebsiteMinerManager.ignore_set.add(ignore.host)
                    }
                })
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
            return this.website_cache.initialize()
        })
    }

    make_miner_working(miner: WebsiteMiner) {
        if (this.mining && miner.count < MINER_CONFIG.WORK_PER_MINER) {
            this.website_cache.get().then(website => {
                let hostname = get_hostname(website)
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
        let remove_before = new Date().getTime() - 60 * 60 * 1000
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
    
    mined_count: number = 0
    error_count: number = 0
    start() {
        this.mined_count = 0
        this.error_count = 0
        this.mining = true
        this.bloomed_count = 0
        // this.website_cache.add("https://www.baidu.com")

        setInterval(() => {
            logout(`mined:${this.mined_count},error:${this.error_count},mining:${this.mining_count},bloomed:${this.bloomed_count}`)
        }, 5000)

        setInterval(() => {
            this.remove_timedout_records()
        }, 1 * 60 * 1000)

        while(this.miners.length < MINER_CONFIG.MINER_COUNT) {
            let miner = new WebsiteMiner()
            miner.on_mined(result => {
                this.mining_count--

                var record = this.ensure_host_record(result.host)
                if (!this.mining_count && this.stop_resolver) {
                    this.stop_resolver()
                }

                if (result.keyword) {
                    WebsiteModel.instance().then(model => {
                        return model.insert({ uri : result.website, keyword: result.keyword, confirm : false})
                        .catch(err => {
                            errout(`website insert failed: ${result.website} ${err.message}`)
                        })
                    })
                }
                
                this.make_miner_working(miner)
                if (result.err) {
                    record.error += 1
                    if (record.error > 32) {
                        this.bloom_host(record.host)
                    }
                    this.error_count++
                    // return logout(`${result.website} ${result.err.mesg}`)
                    return
                }
                record.error = 0
                this.mined_count++

                for (var foreign of result.foreign) {
                    if (!this.bloom.has(foreign.host)) {
                        this.website_cache.add(foreign.url)
                    }
                }

                for (var domestic of result.domestic) {
                    if (!this.bloom.has(domestic.host)) {
                        this.website_cache.add(domestic.url)
                    }
                }
            })
            this.make_miner_working(miner)
            this.miners.push(miner)
        }
    }
    
    stop() {
        return new Promise<void>(resolve => {
            this.mining = false
            if (this.mining_count == 0) {
                return resolve()
            }
            this.stop_resolver = resolve
        })
        .then(() => {
            return this.website_cache.close()
        })
        .then(() => {
            this.miners = []
            return this.cache_bloom()
        })
    }
}
