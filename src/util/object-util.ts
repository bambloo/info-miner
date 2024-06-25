export type DataSubObject = {
    [key: string] : DataSubObject
} | string | number | object | null | boolean | []

export type DataObject = {
    [key: string] : DataSubObject
} 

export function assign_keys(dest: DataObject, src: DataObject, map: Object | string[]) {
    var key_list: string[]
    if (!Array.isArray(map)) {
        key_list = []
        for (let key in map) {
            key_list.push(key)
        }
    } else {
        key_list = map
    }

    for (var key of key_list) {
        dest[key] = src[key]
    }
}

export function assign_keys_nonnull(dest: DataObject, src: DataObject, map: Object | string[]) {
    var key_list: string[]
    if (!Array.isArray(map)) {
        if (!Array.isArray(map)) {
            key_list = []
            for (let key in map) {
                key_list.push(key)
            }
        } else {
            key_list = map
        }
    } else {
        key_list = map
    }

    for (var key of key_list) {
        if (src[key]) {
            dest[key] = src[key]
        }
    }
}

export function deep_copy<DataType>(obj : DataType, skip_empty : boolean): DataType {
    if (Array.isArray(obj)) {
        let ret = new Array(obj.length)
        for (let i = 0; i < obj.length; i++) {
            ret[i] = deep_copy(obj[i], skip_empty)
        }
        return ret as any
    } else if (typeof (obj) == 'object') {
        let ret: { [key: string] : any} = {}
        for (let key in obj) {
            if (!skip_empty || obj[key] != null ) {
                ret[key] = deep_copy(obj[key] as any, skip_empty)
            }
        }
        return ret as any
    } else {
        return obj
    }
}

export function map_object(dst: DataObject, src: DataObject, skip_empty: boolean) {
    for (let key in src) {
        let src_item = src[key]
        if (Array.isArray(src_item)) {
            dst[key] = deep_copy(src_item, skip_empty)
        } else if (typeof(src_item) == 'object') {
            map_object(dst[key] as DataObject, src_item as DataObject, skip_empty)
        } else {
            if (skip_empty && src_item == null) {
                continue
            }
            dst[key] = src_item            
        }
    }
}


// export function deep_copy<DataType = DataSubObject>(dst: DataType, src: DataType) {
//     if (Array.isArray(src) && Array.isArray(dst)) {
//         dst.length = src.length
//         for (var i = 0; i < src.length; i++) {
            
//         }
//     } else if (typeof(src) == 'object' && typeof(dst) == 'object'){

//     }
//     for (var key in src) {
//         var src_item = src[key]
//         if (Array.isArray(src_item)) {
//             var res = []
//             for (var i of src_item) {
//                 if (typeof(i) == 'object') {
                    
//                 }
//             }
//         } else if (typeof(src_item) == 'object') {
//             var dst_item = {} as DataObject
//             map_object(dst_item, src_item as DataObject)
//             dst[key] = dst_item
//         } else {
//             dst[key] = src[key]
//         }
//     }
// }
