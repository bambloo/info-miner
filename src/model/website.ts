import { WebsiteDesc, WebsiteUri } from "../entity/website";
import { Mutex } from "../util/mutex";
import { BaseModel } from "./base";

export class WebsiteModel extends BaseModel<WebsiteUri, WebsiteDesc> {

    private static global = new WebsiteModel('websites', ['uri'])
    private static inited = false
    private static mutex = new Mutex
    static instance(): Promise<WebsiteModel> {
        return new Promise((resolve, reject) => {
            if (this.inited) {
                resolve(this.global)
            }
            return this.mutex.do(() => {
                if (this.inited) {
                    return resolve(this.global)
                }
                return this.global.init().then(() => {
                    this.inited = true
                    resolve(this.global)
                })
            })
            .catch(reject)
        })
    }
}