import http from 'http'
import https from 'https'
import zlib from 'zlib'
import { BamblooError, BamblooStatusCode } from '../status'
import { errout } from './logger-helper'

export function get_hostname(url: string) {
    try {
        return new URL(url).hostname
    } catch(err) {
        return ''
    }
}

const REQUEST_TIMEOUT = 180000

export function request_website(uri: string) {
    return new Promise<string>((resolve, reject) => {
        if (uri.startsWith("https")) {
            var req = https.get(uri)
        } else {
            var req = http.get(uri)
        }
        var bufs: Buffer[] = []

        var response: any
        var timeout = setTimeout(() => {
            req.destroy()
            reject(new BamblooError(BamblooStatusCode.TIMEOUT, `${uri} req timedout.`))
        }, REQUEST_TIMEOUT)

        req.on('response', res => {
            response = res
            var length = 0
            var contentType = res.headers['content-type']
            var gzip = res.headers['content-encoding'] == 'gzip'
            
            if (contentType && contentType.indexOf('text') < 0) {
                clearTimeout(timeout)
                return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} content-type ${res.headers['content-type']} skip`))
            }
            res.on("data", (data: Buffer) => {
                length += data.byteLength
                if (length > 8 * 1024 * 1024) {
                    req.destroy()
                    clearTimeout(timeout)
                    errout(`${uri} too long`)
                    return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} too long`))
                }
                bufs.push(Buffer.from(data))
            })
            res.on('end', () => {
                clearTimeout(timeout)
                var buf = Buffer.concat(bufs)
                if (gzip) {
                    zlib.gunzip(buf, (err, decompressed) => {
                        if (err) {
                            clearTimeout(timeout)
                            return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `decompress response from ${uri} error`))
                        }
                        resolve(decompressed.toString())
                    })
                } else {
                    resolve(buf.toString())
                }
            })
            res.on('error', err => {
                clearTimeout(timeout)
                reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} res ${err.message}`))
            })
        })
        .on('error', err => {
            clearTimeout(timeout)
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} req ${err.message}`))
        })
        .end()

        req.setMaxListeners(20)
    })
}