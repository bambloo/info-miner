const { isMainThread } = require('worker_threads')
if (isMainThread) {
    const { Worker } = require('worker_threads')
    module.exports.WebsiteMiner = class {
        constructor() {
            this.worker = new Worker(__filename)
            this.count = 0
        }

        push(website) {
            this.count += 1
            this.worker.postMessage(website)
        }

        on_mined(listener) {
            this.worker.on('message', result => {
                this.count -= 1
                listener(result)
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

    function doif_exists() {
        var website = websites.pop()
        if (website) {
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
                doif_exists()
            })
        }        
    }

    content_analyser.initialize().then((() => {
        parentPort.on('message', website => {
            websites.push(website)
            doif_exists()
        })
    }))


}