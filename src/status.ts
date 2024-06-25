export enum BamblooStatusCode {
    SUCCESS = 0,
    NON_EXISTS = 1,
    TYPE_MISMATCH = 2,
    NETWORK_ERROR = 3,
    HANDLE_CLOSED = 4,
    SKIPPED_ITEM = 5
}

export class BamblooError {
    code : BamblooStatusCode
    mesg : string

    constructor(code : BamblooStatusCode, mesg: string) {
        this.code = code
        this.mesg = mesg
    }
}