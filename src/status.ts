export enum BamblooStatusCode {
    SUCCESS = 0,
    NON_EXISTS = 1000,
    TYPE_MISMATCH,
    NETWORK_ERROR,
    TIMEOUT,
    HANDLE_CLOSED,
    SKIPPED_ITEM,
    PROCEDURE,
}

export class BamblooError extends Error {
    code : BamblooStatusCode

    constructor(code : BamblooStatusCode, mesg: string) {
        super(mesg)
        this.code = code
    }
}