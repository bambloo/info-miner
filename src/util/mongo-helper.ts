import { Collection, MongoClient} from 'mongodb'
import { DATABASE_CONFIG } from '../config'

var mongo_global: MongoClient

export function mongo_client() {
    return new Promise<MongoClient>((resolve, reject) => {
        if (mongo_global) {
            resolve(mongo_global)
        } else {
            MongoClient.connect(DATABASE_CONFIG.URL).then(client => {
                mongo_global = client
                resolve(mongo_global)
            }).catch(reject)
        }
    })  
}

export function mongo_db_operator() {
    return mongo_client().then(client => {
        return client.db('info-miner')
    })
}

export type MongoPageParam = {
    collection: Collection
    page?: number
    rows?: number
    filter?: any
    project?: any
    sort?: any
}

export function mongo_page(param : MongoPageParam) {
    var pager: any
    if (param.page || param.rows) {
        param.page = param.page ? Number(param.page) : 1
        param.rows = param.page ? Number(param.rows) : 20

        pager = {
            skip : (param.page - 1) * param.rows,
            limit : param.rows
        }
    }
    if (!param.page) {
        param.page = 1
    }

    var pipeline: any[] = []
    if (param.filter) {
        pipeline.push({
            $match: param.filter
        })
    }
    if (param.sort) {
        pipeline.push({
            $sort: param.sort
        })
    }
    var project: any = param.project ? param.project : {}
    project._id = false

    var facet_pipeline: any[] = [{ $project : project}]
    pipeline.push({
        $facet: {
            facet_count : [{ $count: 'count' }],
            facet_list: facet_pipeline
        }
    })
    if (pager) {
        facet_pipeline.push({$skip : pager.skip})
        facet_pipeline.push({ $limit: pager.limit})
    }
    return param.collection.aggregate(pipeline).toArray()
    .then(facets => {
      let data: any = {}
      try {
        if (facets.length == 1) {
          data.count = facets[0].facet_count[0].count
          data.list = facets[0].facet_list
        } else {
          data.count = 0
          data.list = []
        }
      }
      catch(err) {
        data.count = 0
        data.list = []
      }
      if (pager) {
        data.page = param.page
        data.rows = param.rows
        var mod = data.count % data.rows
        data.pages = ((data.count - mod) / data.rows) + (mod ? 1 : 0)
      }
      return data
    })
}