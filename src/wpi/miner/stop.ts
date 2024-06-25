import { NextFunction } from "express";
import { miner_manager } from "../../app";
import { Response, Request } from 'express'

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    miner_manager.stop().then(() => {
        res.end("SUCCESS")
    })
}