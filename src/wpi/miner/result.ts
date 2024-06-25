import { NextFunction } from "connect";
import { Response } from "express";
import { WebsiteModel } from "../../model/website";

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    WebsiteModel.instance().then(model => {
        return model.find(params.cond).then(websites => {
            res.end(JSON.stringify(websites))
        })
    }).catch(err => {
        res.end("error.")
    })
}