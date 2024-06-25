import { IgnoreDesc, IgnoreUri } from "../entity/ignore";
import { WebsiteDesc, WebsiteUri } from "../entity/website";
import { Mutex } from "../util/mutex";
import { BaseModel } from "./base";

export class IgnoreModel extends BaseModel<IgnoreUri, IgnoreDesc> {

    private static global = new IgnoreModel('ignore', ['host'])
    private static inited = false
    private static mutex = new Mutex
    
    static instance(): Promise<IgnoreModel> {
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