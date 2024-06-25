import { ObjectId } from "bson"
import { mongo_db_operator, mongo_page } from "../util/mongo-helper"
import { BamblooError, BamblooStatusCode } from "../status"
import { DataObject, assign_keys, deep_copy } from "../util/object-util"
import { logout, errout } from "../util/logger-helper"

export interface BaseUri {
    [key:string] : any
}

export class BaseModel<
    UriType extends BaseUri & DataObject,
    ObjType extends UriType & DataObject,
    > {
    coll: string
    keys: string[]
    constructor(col: string, keys: string[]) {
        this.coll = col
        this.keys = keys
    }

    col() {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll)
        })
    }

    init() {
        return mongo_db_operator().then(db => {
            return db.createIndex(this.coll, this.keys, {
                unique: true, 
            }).then(() => {
                logout(`create index on ${this.coll} succeeded.`)
            })
            .catch(err => {
                errout(err)
            })
        })
    }

    get(uri: UriType): Promise<ObjType> {
        return mongo_db_operator().then(db => {
            var cond = {}
            assign_keys(cond, uri, this.keys)

            return db.collection(this.coll).findOne(uri).then(obj => {
                if (obj) {
                    return obj as any
                }
                throw new BamblooError(BamblooStatusCode.NON_EXISTS, "the item you're looking for is nonexist or locked by other user.")
            })
        })
    }

    borrow(cond: Object): Promise<ObjType>{
        return mongo_db_operator().then(db => {
            var c: any = deep_copy(cond, false)
            c.locked = { $ne : true }
            return db.collection(this.coll).findOneAndUpdate(c, { $set : { locked : true }}).then(obj => {
                if (!obj) {
                    throw new BamblooError(BamblooStatusCode.NON_EXISTS, "no idle item for you.")
                }
                return obj as any
            })
        })
    }

    revert(uri: UriType): Promise<void> {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).updateOne(uri, { $set : { locked : false }}).then(() => {})
        })
    }

    gets(uris: BaseUri[]): Promise<ObjType[]> {
        return mongo_db_operator().then(db => {
            uris.map(val => {
                return val.uri
            })
            return db.collection(this.coll).find({ uri : { $in : uris.map(val => val.uri)}}).toArray() as any
        })
    }

    find(cond: any): Promise<ObjType[]> {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).find(cond).toArray() as any
        })
    }

    page(pager: any) {
        return this.col().then(col => {
            pager.collection = col
            return mongo_page(pager)
        })
    }

    insert(obj: ObjType) {
        return mongo_db_operator().then(db => {
            var cond = { locked : false }
            assign_keys(cond, obj, this.keys)

            return db.collection(this.coll).insertOne(obj)
        })
    }

    insertMany(objs: ObjType[]) {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).insertMany(objs, { ordered: false })
        })
    }

    count(cond: Object) {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).countDocuments(cond)
        })
    }

    updateMany(cond: any, val: any) {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).updateMany(cond, val)
        })
    }

    update(uri: UriType, val: any) {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).updateOne(uri, val)
        })
    }

    deleteMany(cond: any) {
        return mongo_db_operator().then(db => {
            return db.collection(this.coll).deleteMany(cond)
        })
    }

}
