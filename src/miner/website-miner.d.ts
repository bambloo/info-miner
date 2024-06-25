export type WebsiteMinerResult = {
    website: string,
    host: string,
    domestic: { host: string, url: string } [],
    foreign: {host: string, url: string } [],
    keyword: string,
    err: any   
}

export class WebsiteMiner {
    count: number

    push(website: string)
    on_mined(callback : (mined: WebsiteMinerResult) => void)
}