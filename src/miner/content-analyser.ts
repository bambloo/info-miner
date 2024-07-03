import { CheerioAPI, load } from "cheerio";
import url from 'url'

class ContentAnalyseResult {
    private keyword?: string
    private urls_tomine: string[] = []

    keyword_got(keyword: string) {
        this.keyword = keyword
    }

    tomine(website: string) {
        this.urls_tomine.push(website)
    }
}

const ignore_suffix_set = new Set(['.pdf', '.png', '.mp4', '.jpg', '.apk', '.zip', '.exe', '.rpm'])
export default class ContentAnalyser {

    protected initialize(): Promise<void> {
        return Promise.resolve()
    }

    protected on_content(domain:string, website: string, content: string, $: CheerioAPI, result: ContentAnalyseResult) {
        var a_sections = $('a')

        for (let item of a_sections) {
            var href = item.attribs['href']
            if (!href || !href.length || 
                href.indexOf('void(0)') >= 0 || href.startsWith("mailto:") || href.startsWith("tel:") || 
                ignore_suffix_set.has(href.substring(href.length - 4))) {
                continue
            }

            href = url.resolve(website, href)
            if (href.startsWith("http")) {
                result.tomine(href)
            }
        }
    }

    protected analyse(domain: string, website: string, content: string): ContentAnalyseResult {
        var $ = load(content)
        var result = new ContentAnalyseResult()
        this.on_content(domain, website, content, $, result)
        return result
    }
}
