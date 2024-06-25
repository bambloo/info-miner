import { BaseUri } from "../model/base";

export interface WebsiteUri extends BaseUri {
    uri: string
}

export interface WebsiteDesc extends WebsiteUri{
    keyword: string
    confirm: boolean
    // [key: string] : any
}

export class Website {
    desc: WebsiteDesc
    referrer: number = 0

    constructor(desc: WebsiteDesc) {
        this.desc = desc
    }
}
