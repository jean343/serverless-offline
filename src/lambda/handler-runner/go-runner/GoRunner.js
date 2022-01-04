import { EOL, platform } from 'os'
import { spawn } from 'child_process'
import { Server } from './server'

const { parse, stringify } = JSON
const { cwd } = process
const { has } = Reflect

export default class GoRunner {
  #env = null
  #codeDir = null
  #handlerName = null
  #handlerPath = null
  #runtime = null
  #allowCache = false
  #server = false

  constructor(funOptions, env, allowCache, v3Utils) {
    console.log(funOptions)
    const { codeDir, handlerName, handlerPath, runtime } = funOptions

    this.#env = env
    this.#codeDir = codeDir
    this.#handlerName = handlerName
    this.#handlerPath = handlerPath
    this.#runtime = platform() === 'win32' ? 'python.exe' : runtime
    this.#allowCache = allowCache
    this.#server = new Server({
      port: 5001,
      function: {
        id: '',
        handler: '',
      },
    })
    this.#server.listen()

    if (v3Utils) {
      this.log = v3Utils.log
      this.progress = v3Utils.progress
      this.writeText = v3Utils.writeText
      this.v3Utils = v3Utils
    }

    // if (process.env.VIRTUAL_ENV) {
    //   const runtimeDir = platform() === 'win32' ? 'Scripts' : 'bin'
    //   process.env.PATH = [
    //     join(process.env.VIRTUAL_ENV, runtimeDir),
    //     delimiter,
    //     process.env.PATH,
    //   ].join('')
    // }

    // const [pythonExecutable] = this.#runtime.split('.')

    // this.handlerProcess = spawn(
    //   pythonExecutable,
    //   [
    //     '-u',
    //     resolve(__dirname, 'invoke.py'),
    //     relative(cwd(), this.#handlerPath),
    //     this.#handlerName,
    //   ],
    //   {
    //     env: extend(process.env, this.#env),
    //     shell: true,
    //   },
    // )
    //
    // this.handlerProcess.stdout.readline = readline.createInterface({
    //   input: this.handlerProcess.stdout,
    // })
  }

  // () => void
  cleanup() {
    // this.handlerProcess.kill()
  }

  _parsePayload(value) {
    let payload

    for (const item of value.split(EOL)) {
      let json

      // first check if it's JSON
      try {
        json = parse(item)
        // nope, it's not JSON
      } catch (err) {
        // no-op
      }

      // now let's see if we have a property __offline_payload__
      if (
        json &&
        typeof json === 'object' &&
        has(json, '__offline_payload__')
      ) {
        payload = json.__offline_payload__
        // everything else is print(), logging, ...
      } else if (this.log) {
        this.log.notice(item)
      } else {
        console.log(item)
      }
    }

    return payload
  }

  runAsync(cwd, cmd) {
    const proc = spawn(cmd.command, cmd.args, {
      env: {
        ...cmd.env,
        ...process.env,
      },
      cwd,
    })
    return new Promise((resolve, reject) => {
      let buffer = ''
      proc.stdout?.on('data', (data) => (buffer += data))
      proc.stderr?.on('data', (data) => (buffer += data))
      proc.on('exit', () => {
        if (proc.exitCode === 0) resolve()
        if (proc.exitCode !== 0) {
          reject(buffer)
        }
      })
    })
  }

  // invokeLocalPython, loosely based on:
  // https://github.com/serverless/serverless/blob/v1.50.0/lib/plugins/aws/invokeLocal/index.js#L410
  // invoke.py, based on:
  // https://github.com/serverless/serverless/blob/v1.50.0/lib/plugins/aws/invokeLocal/invoke.py
  async run(event, context) {
    // console.log('event', event)
    // console.log('context', context)
    // return new Promise(async (accept, reject) => {
    const inputEvent = stringify({
      context,
      event,
      allowCache: this.#allowCache,
    })

    // const artifact = State.Function.artifactsPath(opts.root, opts.id);
    // const target = path.join(artifact, "handler");

    // const full = path.join(opts.srcPath, opts.handler);
    // const isDir = fs.lstatSync(full).isDirectory();
    // const input = isDir ? path.join(opts.handler, "main.go") : opts.handler;
    const build = {
      command: 'go',
      args: [
        'build',
        '-ldflags',
        '-s -w',
        '-o',
        'D:\\Sites\\serverless-offline\\src\\lambda\\handler-runner\\go-runner\\out.exe',
        `${this.#handlerPath}.${this.#handlerName}`,
      ],
      env: {},
    }
    // await this.runAsync(this.#codeDir, build)

    // console.log(
    //   await this.runAsync(this.#codeDir, {
    //     command:
    //       'D:\\Sites\\serverless-offline\\src\\lambda\\handler-runner\\go-runner\\out.exe',
    //     args: [],
    //     env: {
    //       // _LAMBDA_SERVER_PORT
    //       AWS_LAMBDA_RUNTIME_API: 'localhost:5001',
    //     },
    //   }),
    // )

    return await this.#server.trigger({
      function: {
        build: () => {},
        resolve: (runtime) => {
          return {
            run: {
              command:'D:\\Sites\\serverless-offline\\src\\lambda\\handler-runner\\go-runner\\out.exe',
              args:[],
              env: {}
            }
          }
        },
        id: 'jpid',
        handler: '',
      },
      payload: { event,context ,deadline:new Date().getTime()+900000},
    })

    // const onErr = (data) => {
    //   // TODO
    //
    //   if (this.log) {
    //     this.log.notice(data.toString())
    //   } else {
    //     console.log(data.toString())
    //   }
    // }
    //
    // const onLine = (line) => {
    //   try {
    //     const parsed = this._parsePayload(line.toString())
    //     if (parsed) {
    //       this.handlerProcess.stdout.readline.removeListener('line', onLine)
    //       this.handlerProcess.stderr.removeListener('data', onErr)
    // return accept({})
    //     }
    //     return null
    //   } catch (err) {
    //     return reject(err)
    //   }
    // }
    //
    // this.handlerProcess.stdout.readline.on('line', onLine)
    // this.handlerProcess.stderr.on('data', onErr)
    //
    // process.nextTick(() => {
    //   this.handlerProcess.stdin.write(input)
    //   this.handlerProcess.stdin.write('\n')
    // })
    // })
  }
}
