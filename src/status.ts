export enum BamblooStatusCode {
    SUCCESS = 0,
    NON_EXISTS = 1000,
    TYPE_MISMATCH,
    NETWORK_ERROR,
    TIMEOUT,
    HANDLE_CLOSED,
    SKIPPED_ITEM,
}

export class BamblooError {
    code : BamblooStatusCode
    mesg : string

    constructor(code : BamblooStatusCode, mesg: string) {
        this.code = code
        this.mesg = mesg
    }
}