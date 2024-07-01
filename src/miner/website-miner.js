const { isMainThread } = require('worker_threads')
if (isMainThread) {
    const { errout, logout } = require('../util/logger-helper')
    const { Worker } = require('worker_threads')
    module.exports.WebsiteMiner = class {
        constructor(id) {
            this.id = id
            this.mining_set = new Set()
        }

        get count() {
            return this.mining_set.size
        }

        hire(exit_listener) {
            this.worker = new Worker(__filename)
            this.worker.once('exit', exit_code => {
                delete this.worker
                exit_listener(exit_code)
            })
            this.worker.on('error', err => {
                errout(err.message)
            })
            this.worker.on('message', result => {
                this.mining_set.delete(result.website)
                if (this.mined_data_listener) {
                    this.mined_data_listener(result)
                }
            })

            this.mining_set.forEach(website => {
                this.worker.postMessage({ cmd: 'crawl', website : website })
            })
        }

        push(website) {
            if (this.mining_set.has(website)) {
                return
            }
            this.mining_set.add(website)
            if (this.worker) {
                this.worker.postMessage({ cmd: 'crawl', website : website })
            }
        }

        on_mined(listener) {
            this.mined_data_listener = listener
        }

        dump_mining_set() {
            this.mining_set.forEach(website => {
                errout(`miner ${this.id} unmined website: ${website}`)
            })
        }

        fire() {
            return new Promise(resolve => {
                if (!this.worker) {
                    return resolve()
                }
                this.worker.postMessage({})
                this.worker.once('exit', resolve)
            })
        }
    }
} else {
    require('ts-node').register()
    const { parentPort } = require("worker_threads")
    const { request_website, get_hostname } = require("../util/request-util")
    const { ContentAnalyser } = require('./content-analyser')
    const cheerio = require('cheerio')
    const url = require('url')

    var websites = []

    const ignore_suffix_set = new Set(['.pdf', '.png', '.mp4', '.jpg', '.apk', '.zip', '.exe'])

    var content_analyser = new ContentAnalyser()
    var exiting = false
    var mining = false

    function doif_exists() {
        var website = websites.pop()
        if (website) {
            mining = true
            var res
            var parent_host = get_hostname(website)
            return request_website(website).then(data => {
                var keyword = content_analyser.analyse(website, data)
                var $ = cheerio.load(data)
                var a_sections = $('a')
        
                var foreign_urls = []
                var domestic_urls = []

                for (let item of a_sections) {
                    var href = item.attribs['href']
                    if (!href || !href.length || href.length > 128 || 
                        href.indexOf('void(0)') >= 0 || href.startsWith("mailto:") || href.startsWith("tel:") || 
                        ignore_suffix_set.has(href.substring(href.length - 4))) {
                        continue
                    }

                    href = url.resolve(website, href)
                    if (href.startsWith("http")) {
                        var child_hostname = get_hostname(href)
                        if (child_hostname != parent_host) {
                            foreign_urls.push({
                                url: href,
                                host: child_hostname
                            })
                        } else {
                            domestic_urls.push({
                                url: href,
                                host: child_hostname
                            })
                        }
                    }
                }
                if (keyword) {
                    res = { website: website, host: parent_host, domestic: domestic_urls, foreign: foreign_urls, keyword: keyword}
                } else {
                    res = { website: website, host: parent_host, domestic: domestic_urls, foreign: foreign_urls }
                }
            })
            .catch(err => {
                res = { website: website, host: parent_host, err: err }
            })
            .finally(() => {
                parentPort.postMessage(res)
                mining = false
                doif_exists()
            })
        } else {
            if (exiting && !mining) {
                process.exit(0)
            }
        }
    }

    content_analyser.initialize().then((() => {
        parentPort.on('message', message => {
            if (message.cmd == 'crawl') {
                websites.push(message.website)
            } else {
                exiting = true
                parentPort.removeAllListeners()
            }
            doif_exists()
        })
    }))

    process.on('uncaughtException', err => {
        console.log(err)
    })

    process.on('unhandledRejection', err => {
        console.log(err)
    })
}