import { MongoClient} from 'mongodb'

var mongo_global: MongoClient

export function mongo_client() {
    return new Promise<MongoClient>((resolve, reject) => {
        if (mongo_global) {
            resolve(mongo_global)
        } else {
            MongoClient.connect("mongodb://info-miner-admin:info-miner@localhost:27017/?authSource=info-miner").then(client => {
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