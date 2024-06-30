import { NextFunction } from "express";
import { Response } from "express";
import { miner_manager } from "../../app";

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    return miner_manager.ignore_add(params.host)
    .then(() => res.end("success"))
}