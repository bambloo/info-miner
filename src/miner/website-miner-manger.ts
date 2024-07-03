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

export class WebsiteMinerManager {
    private website_cache: WebsiteCache

    private miners: WebsiteMiner[] = []
    private mining: boolean = false
    
    private mining_count: number = 0
    private mined_count: number = 0
    private mined_diff: number = 0
    private error_count: number = 0

    private bloom: string
    private analyser?: string

    constructor(bloom: string) {
        this.bloom = bloom
        this.website_cache = new WebsiteCache(MINER_CONFIG.WEBSITE_CACHE_PATH, bloom)
    }

    ignore_add(ignore: string) {
        return this.website_cache.ignore_add(ignore)
    }

    private initialize() {
        return this.website_cache.initialize()
    }

    private make_miner_working(miner: WebsiteMiner) {
        if (this.mining && miner.count < MINER_CONFIG.WORK_PER_MINER) {
            this.website_cache.pop().then(website => {
                this.mining_count += 1
                miner.push(website)
                this.make_miner_working(miner)
            }).catch(err => {
                this.make_miner_working(miner)
            })
        }
    }

    private init_miner(miner: WebsiteMiner) {
        let reset_miner = (exitcode: number) => {
            if (this.mining) {
                miner.dump_mining_set()
                miner.hire(reset_miner, this.analyser)
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

            if (!result.err) {
                for (var domestic of result.domestic) {
                    this.website_cache.push(domestic.host, domestic.url)
                }
    
                for (var foreign of result.foreign) {
                    this.website_cache.push(foreign.host, foreign.url)
                }
                this.mined_count += 1
                this.mined_diff++
            } else {
                this.error_count += 1
            }
            this.website_cache.mined(result.host, result.website)
        })
        miner.hire(reset_miner, this.analyser)
        this.make_miner_working(miner)
    }

    private logger_timer?: NodeJS.Timeout

    private last_logged_time: number = 0
    start(analyser?: string) {
        this.analyser = analyser
        return this.initialize().then(() => {
            this.mined_count = 0
            this.error_count = 0
            this.mining = true
            this.last_logged_time = 0

            this.logger_timer = setInterval(() => {
                const curr_logged_time = new Date().getTime()
                const diff_time = (curr_logged_time - this.last_logged_time)
                const mine_speed = this.mined_diff * 1000 / diff_time
                this.last_logged_time = curr_logged_time
                logout(`mined:${this.mined_count},speed:${mine_speed.toFixed(2)}/s,error:${this.error_count},mining:${this.mining_count}`)
                this.mined_diff = 0
            }, 10000)
    
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
        .then(() => {
            this.miners = []
            this.website_cache = new WebsiteCache(MINER_CONFIG.WEBSITE_CACHE_PATH, this.bloom)
            this.mining_count = 0
            this.mined_diff = 0
            this.mined_count = 0
            this.error_count = 0
            clearInterval(this.logger_timer)
        })
    }
}
