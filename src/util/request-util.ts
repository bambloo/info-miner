import http from 'http'
import https from 'https'
import { BamblooError, BamblooStatusCode } from '../status'
import { errout } from './logger-helper'

export function get_hostname(url: string) {
    try {
        return new URL(url).hostname
    } catch(err) {
        return ''
    }
}

const REQUEST_TIMEOUT = 120000

export function request_website(uri: string) {
    return new Promise<string>((resolve, reject) => {
        var mod = uri.startsWith('https') ? https : http
        let req = mod.get(uri, { timeout : REQUEST_TIMEOUT }, res => {
            var length = 0
            var bufs: Buffer[] = []
            var contentType = res.headers['content-type']
            if (contentType && contentType.indexOf('text') < 0) {
                req.destroy()
                clearTimeout(timeout)
                return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} content-type ${res.headers['content-type']} skip`))
            }
            res.on("data", (data: Buffer) => {
                length += data.byteLength
                if (length > 5 * 1024 * 1024) {
                    req.destroy()
                    clearTimeout(timeout)
                    errout(`${uri} too long`)
                    return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} too long`))
                }
                bufs.push(Buffer.from(data))
            })
            res.on('end', () => {
                var buf = Buffer.concat(bufs)
                clearTimeout(timeout)
                resolve(buf.toString())
            })
            res.on('error', err => {
                clearTimeout(timeout)
                req.destroy()
                reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} res ${err.message}`))
            })
        })
        .on('error', err => {
            clearTimeout(timeout)
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} req ${err.message}`))
        })
        .end()

        var timeout = setTimeout(() => {
            req.destroy()
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} req timedout.`))
        }, REQUEST_TIMEOUT)

        req.setMaxListeners(20)
    })
}