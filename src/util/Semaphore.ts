import { BamblooError, BamblooStatusCode } from "../status"

export class Semaphore {
    waiting: any[] = []
    resources: number = 0
    name: string
    closed: boolean = false

    constructor(name:string) {
        this.name = name
    }

    consume() {
        return new Promise<void>((resolve, reject) => {
            if (this.closed) {
                return reject(new BamblooError(BamblooStatusCode.HANDLE_CLOSED, `Semaphore [${this.name}] is closed, Do not consume it anymore`))
            }
            if (this.resources > 0) {
                this.resources--
                resolve()
            } else {
                this.waiting.push({
                    resolver: resolve,
                    rejecter: reject,
                })
            }
        })
    }

    produce(count: number) {
        if (this.closed) {
            return
        }

        this.resources += count
        while(this.waiting.length && this.resources) {
            this.waiting.shift().resolver()
            this.resources--
        }
    }

    close() {
        this.closed = true
        for (var item of this.waiting) {
            item.rejecter(new BamblooError(BamblooStatusCode.HANDLE_CLOSED, `Semaphore [${this.name}] is closed`))
        }
        this.waiting = []
    }
}