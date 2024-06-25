import { NextFunction } from "express";
import { Response } from "express";
import { ContentAnalyser } from "../../miner/content-analyser";
import { IgnoreModel } from "../../model/ignore";
import { WebsiteMinerManager } from "../../miner/website-miner-manger";

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    return IgnoreModel.instance().then(model => {
        return model.insert({host : params.host }).catch(err => {

        })
    })
    .then(() => {
        WebsiteMinerManager.ignore_set.add(params.host)
        res.end("success")
    })
}