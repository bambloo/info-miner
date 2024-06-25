import { BaseModel, BaseUri } from "../model/base";
import { DataObject } from "../util/object-util";

export class BaseManager<
    UriType extends BaseUri & DataObject,
    DescType extends UriType & DataObject,
    EntityType> {

    model: BaseModel<UriType, DescType>

    cache: Map<string, EntityType>

    constructor(model: BaseModel<UriType, DescType>) {
        this.model = model;
        this.cache = new Map()
    }

    add(desc: DescType) {      
    }

    borrow(uri: UriType) {

    }

    do() {

    }
}