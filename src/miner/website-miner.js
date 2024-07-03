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

        hire(exit_listener, analyser) {
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

            this.worker.postMessage({ analyser: analyser })

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
    const path = require('path')

    var websites = []

    var content_analyser
    var exiting = false
    var mining = false

    function doif_exists() {
        var website = websites.pop()
        if (website) {
            mining = true
            var res

            var domain = get_hostname(website)
            return request_website(website).then(data => {
                var result = content_analyser.analyse(domain, website, data)

                var foreign_urls = []
                var domestic_urls = []

                for (let url of result.urls_tomine) {
                    var child_domain = get_hostname(url)
                    if (child_domain != result.domain) {
                        foreign_urls.push({ url: url, host: child_domain })
                    } else {
                        domestic_urls.push({ url: url, host: child_domain })
                    }
                }

                if (result.keyword) {
                    res = { website: website, host: domain, domestic: domestic_urls, foreign: foreign_urls, keyword: result.keyword}
                } else {
                    res = { website: website, host: domain, domestic: domestic_urls, foreign: foreign_urls }
                }
            })
            .catch(err => {
                res = { website: website, host: domain, err: err }
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

    parentPort.once('message', message => {
        if (message.analyser) {
            content_analyser = new (require(path.resolve(message.analyser)).default)
        } else {
            content_analyser = new (require('./content-analyser').default)
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
    })

    process.on('uncaughtException', err => {
        console.log(err)
    })

    process.on('unhandledRejection', err => {
        console.log(err)
    })
}