import { Mutex } from "../util/mutex"
import { Express } from 'express'

class SessionManager {
    static global?: SessionManager
    static global_mutex = new Mutex

    static instance() {
        return this.global_mutex.do(() => {
            if (global) {
                return global
            }
            this.global = new SessionManager()
            return this.global.prepare()
        })
    }

    prepare(): Promise<this> {
        return Promise.resolve(this)
    }

    register(express: Express, path: string, file_path: string) {

    }
}
