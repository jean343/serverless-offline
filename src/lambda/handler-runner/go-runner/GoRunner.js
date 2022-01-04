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

  async run(event, context) {
    const inputEvent = stringify({
      context,
      event,
      allowCache: this.#allowCache,
    })

    const { data } = await this.#server.trigger({
      function: {
        build: () => {
          return this.runAsync(this.#codeDir, {
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
          })
        },
        resolve: (runtime) => {
          return {
            run: {
              command:
                'D:\\Sites\\serverless-offline\\src\\lambda\\handler-runner\\go-runner\\out.exe',
              args: [],
              env: {},
            },
          }
        },
        id: 'id',
        handler: '',
      },
      payload: { event, context, deadline: new Date().getTime() + 900000 },
    })
    return data
  }
}
