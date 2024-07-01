import http from 'http'
import https from 'https'
import zlib from 'zlib'
import { BamblooError, BamblooStatusCode } from '../status'
import { errout } from './logger-helper'
import { Transform } from 'node:stream'

export function get_hostname(url: string) {
    try {
        return new URL(url).hostname
    } catch(err) {
        return ''
    }
}

const REQUEST_TIMEOUT = 180000

export function request_website(uri: string) {
    return new Promise<{ buffer: Buffer, content_encoding?: string }>((resolve, reject) => {
        if (uri.startsWith("https")) {
            var req = https.get(uri, {
                headers: {
                    "accept-encoding": "gzip"
                }
            })
        } else {
            var req = http.get(uri, {
                headers: {
                    "accept-encoding": "gzip"
                }
            })
        }
        const bufs: Buffer[] = []
        const timeout = setTimeout(() => {
            req.destroy()
            reject(new BamblooError(BamblooStatusCode.TIMEOUT, `${uri} req timedout.`))
        }, REQUEST_TIMEOUT)

        const error_handler = (error: any, type: string) => {
            if (error.code == 'ENOBUFS') {
                errout(`${uri} ENOBUFS`)
            }
            clearTimeout(timeout)
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} ${type} ${error.code || error.message}`))
        }

        req.on('response', res => {
            let total_length = 0
            const content_type = res.headers['content-type']
            const content_encoding = res.headers['content-encoding']

            if (content_type && content_type.indexOf('text') < 0) {
                clearTimeout(timeout)
                return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} content-type ${res.headers['content-type']} skip`))
            }

            res.on('data', data => {
                total_length += data.byteLength
                if (total_length >= 5 * 1024 * 1024) {
                    req.destroy()
                    clearTimeout(timeout)
                    errout(`${uri} too long`)
                    return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} too long`))
                }
                bufs.push(data)
            })
            .on('end', () => {
                clearTimeout(timeout)
                resolve({ buffer: Buffer.concat(bufs), content_encoding: content_encoding})
            })
            .on('error', err => error_handler(err, 'response'))
        })
        .on('error', err => error_handler(err, 'request'))
        .end()

        req.setMaxListeners(20)
    })
    .then(data => {
        switch(data.content_encoding) {
            case 'gzip':
                var decoder: Transform = zlib.createGunzip()
                break
            case 'br':
                var decoder: Transform = zlib.createBrotliDecompress()
                break
            case 'deflate':
                var decoder: Transform = zlib.createDeflate()
                break
            default:
                return data.buffer.toString()
        }
        var bufs: Buffer[] = []

        return new Promise((resolve, reject) => {
            decoder.write(data.buffer)
            decoder.end()

            decoder.on('data', data => {
                bufs.push(data)
            })
            decoder.on('error', err => {
                resolve(Buffer.concat(bufs).toString())
            })
            decoder.on('end', () => {
                resolve(Buffer.concat(bufs).toString())
            })
        })
    })
}