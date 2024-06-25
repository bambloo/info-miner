import { WebsiteDesc } from "../entity/website";
import { WebsiteModel } from "../model/website";

export class WebsiteManger {
    add(uri: string) {
        return WebsiteModel.instance().then(model => {
            return model.insert({
                uri: uri,
                crawled : false,
                locked: false
            })
        })
    }

    adds(uri: string[]) {
        return WebsiteModel.instance().then(model => {
            var items: WebsiteDesc[] = []
            for (var item of uri) {
                items.push({
                    uri: item,
                    crawled : false,
                    locked: false
                })
            }
            return model.insertMany(items)
        })
    }

    update(uri: string, val: any) {
        return WebsiteModel.instance().then(model => {
            return model.update({ uri : uri}, val)
        })
    }

    public static instance = new WebsiteManger()
}