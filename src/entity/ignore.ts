import { BaseUri } from "../model/base";

export interface IgnoreUri extends BaseUri {
    host: string
}

export interface IgnoreDesc extends IgnoreUri{
    // [key: string] : any
}

export class Website {
    desc: IgnoreDesc
    referrer: number = 0

    constructor(desc: IgnoreDesc) {
        this.desc = desc
    }
}
