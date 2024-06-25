import { Express } from "express"
import { walk } from "walk"
import path from "path"
import { logout } from "./logger-helper"

export function proxy_router(express: Express, base: string) {
    return new Promise((resolve, reject) => {
        base = base.replaceAll('\\', '/')
        walk(base).on('file', (parent, stat, next) => {
            parent = parent.replaceAll('\\', '/')
            var router_path = path.join(parent, stat.name).replaceAll("\\", '/')
            var module_path = router_path.replace(base, '').replace('/index.ts', '').replace('.ts', '')
            if (module_path.length == 0) {
                module_path = '/'
            }
            var item = require(router_path)
            var mod = item.default
            logout(module_path)

            express.use(module_path, (req, res, next) => {
                var params = {}
                Object.assign(params, req.body)
                Object.assign(params, req.query)
                logout(module_path, params)
                mod(params, req, res, next)
            })
            next()
        })
    })   
}