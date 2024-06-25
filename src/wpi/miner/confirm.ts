import { NextFunction } from "connect";
import { Response } from "express";
import { WebsiteModel } from "../../model/website";

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    WebsiteModel.instance().then(model => {
        return model.update({ uri: params.website}, { $set : { confirm : true }})
        .then(() => res.end('success'))
    }).catch(err => {
        res.end("error")
    })
}