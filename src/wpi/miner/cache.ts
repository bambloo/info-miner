import { NextFunction } from "connect";
import { Response } from "express";
import { WebsiteModel } from "../../model/website";
import { miner_manager } from "../../app";

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    miner_manager.cache_bloom().then(() => {
        res.end("SUCC")
    })
}