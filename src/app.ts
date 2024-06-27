import express from 'express'
import { errout, logout, proxy_console } from './util/logger-helper'
import { proxy_router } from './util/router-proxy'
import { join } from 'path'
import body_parser from 'body-parser'
import cookie_parser from 'express'
import { WebsiteModel } from './model/website'
import { WebsiteMinerManager } from './miner/website-miner-manger'
import { MINER_CONFIG } from './config'
import { BloomFilter } from '../libs/bloom-filters/src/api'

proxy_console({ base : "logs" })

process.on('unhandledRejection', rej => {
    errout(rej)
})

process.on('uncaughtException', err => {
    errout(err)
})

export const miner_manager = new WebsiteMinerManager(MINER_CONFIG.BLOOM_LOCATION)

Promise.resolve()
.then(() => {
    return WebsiteModel.instance().then(model => {
        return model.count({}).then(count => {
            logout(`previously crawled:${count}`)
        })
    })
})
.then(() => {
    var application = express()
    application.use(body_parser.json())
    application.use(body_parser.urlencoded())
    application.use(cookie_parser())

    proxy_router(application, join(__dirname, 'wpi'))

    application.listen(1992)
    .on('listening', () => {
        logout("Server Listening")
    })
    .on('error', err => {
        logout(err)
    })
})
.then(() => miner_manager.start())