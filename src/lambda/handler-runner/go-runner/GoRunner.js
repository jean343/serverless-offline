import { join, dirname } from 'path'
import { spawn } from 'child_process'
import chokidar from 'chokidar'
import { Server } from './server'

// https://github.com/serverless-stack/serverless-stack/blob/master/packages/core/src/runtime/handler/go.ts
export default class GoRunner {
  #env = null
  #functionKey = null
  #codeDir = null
  #handlerName = null
  #handlerPath = null
  static server = false
  #watcher = null
  #command = ''

  constructor(funOptions, env, v3Utils) {
    const { functionKey, codeDir, handlerName, handlerPath, binDir } =
      funOptions

    this.#functionKey = functionKey
    this.#env = env
    this.#codeDir = codeDir
    this.#handlerName = handlerName
    this.#handlerPath = handlerPath
    this.#command = join(binDir, 'out.exe')
    if (!GoRunner.server) {
      GoRunner.server = new Server({ port: 5001 })
      GoRunner.server.listen()
    }

    if (v3Utils) {
      this.log = v3Utils.log
      this.progress = v3Utils.progress
      this.writeText = v3Utils.writeText
      this.v3Utils = v3Utils
    }

    const watchPath = join(dirname(this.#handlerPath), '**/*.go')
    this.#watcher = chokidar
      .watch(watchPath, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        disableGlobbing: false,
        awaitWriteFinish: {
          pollInterval: 100,
          stabilityThreshold: 20,
        },
      })
      .on('all', this.cleanup)
      .on('error', (error) => console.info(`Watch ${error}`))
      .on('ready', () => {
        console.debug(`Watcher ready...`)
      })
  }

  cleanup = async () => {
    return GoRunner.server.setWarm(this.#functionKey, async () => {
      await GoRunner.server.drain({ id: this.#functionKey })
      await this.build()
    })
  }

  runAsync(cwd, cmd) {
    console.log(cmd)
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

  build = () => {
    return this.runAsync(this.#codeDir, {
      command: 'go',
      args: [
        'build',
        '-ldflags',
        '-s -w',
        '-o',
        this.#command,
        `${this.#handlerPath}.${this.#handlerName}`,
      ],
      env: this.#env,
    })
  }

  resolve = () => {
    return {
      run: {
        command: this.#command,
        args: [],
        env: {},
      },
    }
  }

  async run(event, context) {
    const { data } = await GoRunner.server.trigger({
      function: {
        build: this.build,
        resolve: this.resolve,
        id: this.#functionKey,
      },
      payload: { event, context, deadline: new Date().getTime() + 900000 },
    })
    return data
  }
}
