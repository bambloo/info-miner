import { NextFunction } from "connect";
import { Response } from "express";

export default function handler(params: any, req: Request, res : Response, next: NextFunction) {
    res.end("Hello World!")
}