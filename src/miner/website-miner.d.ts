import { BamblooError } from "../status"

export type WebsiteMinerResult = {
    website: string,
    host: string,
    domestic: { host: string, url: string } [],
    foreign: {host: string, url: string } [],
    keyword: string,
    err: BamblooError
}

export class WebsiteMiner {
    id: number
    get count(): number
    
    constructor(id: number)

    hire(exit_callback: (exitcode: number) => void, analyser_path?: string)
    fire()
    
    push(website: string)
    on_mined(callback : (mined: WebsiteMinerResult) => void)
    dump_mining_set()
}