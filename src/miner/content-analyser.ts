import { WebsiteModel } from "../model/website";
import { errout, logout } from "../util/logger-helper";
import fs from 'fs'
import path from 'path'

export class ContentAnalyser {
    private keywords: string[] = []

    initialize() {
        return fs.promises.readFile(path.resolve(__dirname, '../../resources/dictionary.txt')).then(data => {
            this.keywords = data.toString().split('\n')
            // logout(this.content_list)
        })
    }

    analyse(website: string, content: string) {
        for (let keyword of this.keywords) {
            if (content.indexOf(keyword) >= 0) {
                logout(`matched: ${website} keyword:${keyword}`)
                return keyword
            }
        }
    }
}
