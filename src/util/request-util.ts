import http from 'http'
import https from 'https'
import zlib from 'zlib'
import { BamblooError, BamblooStatusCode } from '../status'
import { errout, logout } from './logger-helper'
import { Readable, Writable, Transform, pipeline, Duplex } from 'node:stream'
import { TransformCallback } from 'stream'
import { MINER_CONFIG } from '../config'

export function get_hostname(url: string) {
    try {
        return new URL(url).hostname
    } catch(err) {
        return ''
    }
}

const REQUEST_TIMEOUT = 180000

// class MergeTransform extends Transform {
//     bufs: Buffer[] = []
//     leng: number = 0

//     _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
//         this.bufs.push(chunk)
//         this.leng += chunk.byteLength
//         if (this.leng >= 5 * 1024 * 1024) {
//             callback(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, "response too long"))
//         } else {
//             callback()
//         }
//     }
//     _flush(callback: TransformCallback): void {
//         this.push(Buffer.concat(this.bufs))
//         callback()
//     }
// }

// class GunzipTransform extends Transform {
//     bufs: Buffer[] = []
//     leng: number = 0

//     _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
//         this.bufs.push(chunk)
//         this.leng += chunk.byteLength
//         if (this.leng >= 5 * 1024 * 1024) {
//             callback(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, "response too long"))
//         } else {
//             callback()
//         }
//     }
//     _flush(callback: TransformCallback): void {
//         const buf = Buffer.concat(this.bufs)
//         zlib.gunzip(buf, (err, decompressed) => {
//             if (err) {
//                 return callback(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `gunzip error`))
//             } else {
//                 this.push(decompressed)
//                 callback()
//             }                        
//         })
//     }
// }

export function request_website(uri: string) {
    return new Promise<string>((resolve, reject) => {
        if (uri.startsWith("https")) {
            var req = https.get(uri, {
                headers: {
                    "accept-encoding": "gzip"
                }
            })
        } else {
            var req = http.get(uri)
        }
        const bufs: Buffer[] = []
        const timeout = setTimeout(() => {
            req.destroy()
            reject(new BamblooError(BamblooStatusCode.TIMEOUT, `${uri} req timedout.`))
        }, REQUEST_TIMEOUT)

        const error_handler = (error: any, type: string) => {
            clearTimeout(timeout)
            reject(new BamblooError(BamblooStatusCode.NETWORK_ERROR, `${uri} ${type} ${error.code || error.message}`))
        }

        req.on('response', res => {
            var length = 0
            const content_type = res.headers['content-type']
            const content_encoding = res.headers['content-encoding']
            const transfer_encoding = res.headers['transfer-encoding']

            if (content_type && content_type.indexOf('text') < 0) {
                clearTimeout(timeout)
                return reject(new BamblooError(BamblooStatusCode.TYPE_MISMATCH, `${uri} content-type ${res.headers['content-type']} skip`))
            }

            res.on('error', err => error_handler(err, 'response'))

            var pipes: (Writable | Readable | (Writable & Readable))[] = []
            var pipe: Readable = res

            // if (transfer_encoding == 'chunked') {
            //     pipes.push(new MergeTransform())
            // }

            switch(content_encoding) {
                case 'gzip':
                    pipes.push(zlib.createGunzip())
                    break
                case 'br':
                    pipes.push(zlib.createBrotliDecompress())
                    break
                case 'deflate':
                    pipes.push(zlib.createDeflate())
                    break
                default:
                    break
            }

            if (pipes.length) {
                pipes.unshift(res)
                pipe = pipes[pipes.length - 1] as Readable
                pipeline(pipes, err => {
                    if (err) {
                        error_handler(err, "transform")
                    }
                })
            }

            pipe.on('data', (data: Buffer) => {
                bufs.push(Buffer.from(data))
            })
            pipe.on('end', () => {
                clearTimeout(timeout)
                var buf = Buffer.concat(bufs)
                resolve(buf.toString())
            })
        })
        .on('error', err => error_handler(err, 'request'))
        .end()

        req.setMaxListeners(20)
    })
}