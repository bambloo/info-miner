import fs from 'fs'
import path from 'path'
import { WriteStream } from 'fs'
import { walk, walkSync } from 'walk'
import { Semaphore } from '../util/Semaphore'
import { load } from 'cheerio'
import { logout } from '../util/logger-helper'
import { Transform } from 'stream'
import { MINER_CONFIG } from '../config'

const CACHE_SPLIT = 1024 * 64
const CACHE_COUNT = 16

export class WebsiteCache {
    semaphore: Semaphore = new Semaphore('Website Cache')
    cache_base: string

    cache_master: string[] = []
    cache_servant: string[][] = []

    cache_files: string[] = []

    writing_file?: string
    writing_stream?: WriteStream
    writing_count: number = 0

    constructor(cache_base: string) {
        this.cache_base = cache_base
        fs.mkdirSync(cache_base, { recursive : true, })
    }

    switch_cache_file() {
        if (this.writing_file) {
            this.cache_files.push(this.writing_file)
            this.writing_stream?.close()
        }
        this.writing_file = path.join(this.cache_base, `${new Date().toISOString().replaceAll(':', '').toString()}.txt`)
        this.writing_stream = fs.createWriteStream(this.writing_file)
        this.writing_count = 0
    }

    initialize() {
        setInterval(() => {
            logout(`master:${this.cache_master.length}`)
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
                this.add(MINER_CONFIG.ENTRY_DOMAIN)
            }
            return this.load_cache()
        }).then(() => {
            return this.switch_cache_file()
        })
    }

    add(website: string) {
        if (this.cache_master.length < CACHE_SPLIT) {
            this.semaphore.produce(1)
            return this.cache_master.push(website)
        }

        this.writing_stream?.write(`${website}\n`)
        if (++this.writing_count >= CACHE_SPLIT) {
            this.switch_cache_file()
        }
    }

    load_cache() {
        if (this.cache_servant.length >= CACHE_COUNT || !this.cache_files.length) {
            return
        }
        
        let next_file = this.cache_files.shift() as string
        fs.promises.readFile(next_file, 'utf-8').then(str => {
            if (str.length) {
                let split = str.trim().split("\n")
                this.cache_servant.push(split)
                this.semaphore.produce(split.length)
            }
            fs.promises.rm(next_file)
            this.load_cache()
        })
    }

    close() {
        return new Promise((resolve, reject) => {
            var write_file_path = path.join(this.cache_base, `${new Date().toISOString().replaceAll(':', '').toString()}.txt`)
            var write_file_stream = fs.createWriteStream(write_file_path)
    
            var transform = new Transform()
            transform.pipe(write_file_stream)
            for (let item of this.cache_master) {
                transform.push(`${item}\n`)
            }
            for (let item of this.cache_servant) {
                for (let i of item) {
                    transform.push(`${i}\n`)
                }
            }
            transform.end()
            write_file_stream.on('finish', resolve)
            this.writing_stream?.close()
        })
    }

    get(): Promise<string> {
        return this.semaphore.consume().then(() => {
            if (!this.cache_master.length) {
                this.cache_master = this.cache_servant.pop() as string[]
                this.load_cache()
            }
            return this.cache_master.pop() as string
        })
    }
}