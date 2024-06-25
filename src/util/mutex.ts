export class Mutex<Type> {
    owners: ((obj: void) => void)[] = []

    do(callback : () => any) : Promise<any> {
        return new Promise<void>(resolve => {
            if (!this.owners.length) {
                resolve()
            }
            this.owners.push(resolve)
        })
        .then(() => {
            return callback()
        })
        .finally(() =>{
            this.owners.shift()
            if (this.owners.length) {
                this.owners[0]()
            }
        })
    }
}