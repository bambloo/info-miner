import request from 'request'
import { BamblooError, BamblooStatusCode } from '../status'

export function get_hostname(url: string) {
    try {
        return new URL(url).hostname
    } catch(err) {
        return ''
    }
}

const REQUEST_TIMEOUT = 300000

export function request_website(uri: string) {
    return new Promise<string>((resolve, reject) => {
        let req = request.get(uri, { timeout : REQUEST_TIMEOUT})
        var bufs: Buffer[] = []
        var length = 0

        var timeout = setTimeout(() => {
            req.abort()
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} req timedout.`))
        }, REQUEST_TIMEOUT)

        req.on('response', res => {
            var contentType = res.headers['content-type']
            if (contentType && contentType.indexOf('text') < 0) {
                req.abort()
                res.destroy()
                clearTimeout(timeout)
                return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} content-type ${res.headers['content-type']} skip`))
            }
            res.on("data", data => {
                length += data.length
                if (length > 3 * 1024 * 1024) {
                    res.destroy()
                    req.abort()
                    clearTimeout(timeout)
                    return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} too long`))
                }
                bufs.push(Buffer.from(data))
            })
            res.on('end', () => {
                var buf = Buffer.concat(bufs)
                if (buf.length > 1024 * 1024 * 100) {
                    debugger
                }
                clearTimeout(timeout)
                res.destroy()
                req.abort()
                resolve(buf.toString())
            })
            res.on('error', err => {
                clearTimeout(timeout)
                res.destroy()
                req.abort()
                reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} res ${err.message}`))
            })
        })

        req.on('error', err => {
            req.abort()
            clearTimeout(timeout)
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} req ${err.message}`))
        })

        req.setMaxListeners(20)
    })
}