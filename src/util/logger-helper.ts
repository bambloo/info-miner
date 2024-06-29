import fs, { WriteStream, write } from 'fs'
import path from 'path'

class TimeExplainer {
    toString() {
        return `[${new Date().toISOString()}]`
    }
}
var explainer = new TimeExplainer()
export const logout = console.log.bind(console, '%s', explainer)
export const errout = console.error.bind(console, "%s", explainer)

type ConsoleLogType = 'log' | 'info' | 'warn' | 'error'
var writers = {
    log: {
        func : console.log.bind(console)
    },
    info: {
        func : console.info.bind(console)
    },
    warn: {
        func : console.warn.bind(console)
    },
    error: {
        func : console.error.bind(console)
    },
}

export type LoggerParams = {
    base : string,
    maxsize ?: number,
    minsize ?: number,
    interval ?: number,
    latency ?: number,
}

function stringify(obj: any) {
    if (typeof(obj) == 'object') {
        var msg = JSON.stringify(obj, null, 2)
    } else {
        var msg = `${obj}`
    }
    msg = msg.replaceAll('\n', '\n[    -  -  T  :  :  .    ]')
    return `[${new Date().toISOString()}]${msg}`
}

function hook_stream(stream: NodeJS.WriteStream, cb : (chunk : any) => void) {
    var old_writer = stream._write.bind(stream)
    stream._write = (chunk: any, encoding: BufferEncoding, callback: any) => {
        cb(chunk)
        return old_writer.apply(stream, [chunk, encoding, callback])
    }
}

class WriteStreamProxy {
    _writer ?: (chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) => void

}

var current_stdout_file : WriteStream
var current_stderr_file : WriteStream

var current_stdout_file_length = 0
var current_stderr_file_length = 0

var base = ''
var maxsize = 1024 * 1024
var minsize = 128 * 1024
var interval = 24 * 60 * 60 * 1000
var latency = 3 * 1000

var latency_checker: NodeJS.Timeout
var timeout_checker: NodeJS.Timeout

var latency_checking = false
var need_switch = false

function switch_file() {
    if (current_stderr_file) {
        current_stderr_file.close()
    }
    if (current_stdout_file) {
        current_stdout_file.close()
    }

    var time = new Date().toISOString().replaceAll(':', "")
    
    current_stderr_file = fs.createWriteStream(path.join(base, `${time}-err.log`))
    current_stdout_file = fs.createWriteStream(path.join(base, `${time}-out.log`))

    current_stdout_file_length = 0
    current_stderr_file_length = 0

    if (timeout_checker) {
        clearTimeout(timeout_checker)
    }

    timeout_checker = setTimeout(() => {
        if (current_stderr_file_length > minsize || current_stdout_file_length > minsize) {
            if (latency_checking) {
                need_switch = true
            }
        }
    }, interval)

    need_switch = false
}

export function proxy_console(params : LoggerParams) {
    base = params.base
    maxsize = params.maxsize || 1024 * 1024
    minsize = params.minsize || 128 * 1024
    interval = params.interval || 24 * 60 * 60 * 1000
    latency = params.latency || 3 * 1000
    
    fs.mkdirSync(base, { recursive : true })
    // for (let key in writers) {
    //     console[key as ConsoleLogType] = ((message?: any, ...optionalParams: any[]) => {
    //         return writers[key as ConsoleLogType].func.apply(console, [stringify(message), ...optionalParams])
    //    }) as any
    // }

    latency_checker = setTimeout(() => {
        if (current_stderr_file_length > maxsize || current_stdout_file_length > maxsize || need_switch) {
            switch_file()
        }
        latency_checking = false
    }, latency)

    hook_stream(process.stdout, (chunk: string) => {
        latency_checking = true
        latency_checker.refresh()
        current_stdout_file_length += chunk.length
        current_stdout_file.write(chunk)
    })
    hook_stream(process.stderr, chunk => {
        latency_checking = true
        latency_checker.refresh()
        current_stderr_file_length += chunk.length
        current_stderr_file.write(chunk)
    })

    switch_file()
}

