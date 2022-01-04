import express from 'express'
import spawn from 'cross-spawn'
import { v4 } from 'uuid'
import https from 'https'
import url from 'url'

const API_VERSION = '2018-06-01'

export class Server {
  constructor(opts) {
    this.pools = {}
    this.lastRequest = {}
    this.warm = {}
    this.app = express()
    this.app.use(
      express.json({
        strict: false,
        type: ['application/json', 'application/*+json'],
        limit: '10mb',
      }),
    )
    this.opts = opts
    this.app.post(
      `/:proc/:fun/${API_VERSION}/runtime/init/error`,
      async (_req, res) => {
        res.json('ok')
      },
    )
    this.app.get(
      `/:proc/:fun/${API_VERSION}/runtime/invocation/next`,
      async (req, res) => {
        console.debug('Worker waiting for function', req.params.fun)
        const payload = await this.next(req.params.proc, req.params.fun)
        console.debug(
          'Sending next payload',
          payload.context.awsRequestId,
          req.params.fun,
          payload.event,
        )
        res.set({
          'Lambda-Runtime-Aws-Request-Id': payload.context.awsRequestId,
          'Lambda-Runtime-Deadline-Ms': payload.deadline,
          'Lambda-Runtime-Invoked-Function-Arn':
            payload.context.invokedFunctionArn,
          'Lambda-Runtime-Client-Context': JSON.stringify(
            payload.context.identity || {},
          ),
          'Lambda-Runtime-Cognito-Identity': JSON.stringify(
            payload.context.clientContext || {},
          ),
        })
        this.lastRequest[req.params.proc] = payload.context.awsRequestId
        res.json(payload.event)
      },
    )
    this.app.post(
      `/:proc/:fun/${API_VERSION}/runtime/invocation/:awsRequestId/response`,
      (req, res) => {
        console.debug(
          'Received response for',
          req.params.awsRequestId,
          req.params.fun,
        )
        this.response(req.params.fun, req.params.awsRequestId, {
          type: 'success',
          data: req.body,
        })
        res.status(202).send()
      },
    )
    this.app.post(
      `/:proc/:fun/${API_VERSION}/runtime/invocation/:awsRequestId/error`,
      (req, res) => {
        console.debug(
          'Received error for',
          req.params.awsRequestId,
          req.params.fun,
        )
        this.response(req.params.fun, req.params.awsRequestId, {
          type: 'failure',
          error: {
            errorType: req.body.errorType,
            errorMessage: req.body.errorMessage,
            stackTrace: req.body.trace,
          },
        })
        res.status(202).send()
      },
    )
    this.app.all(
      `/proxy*`,
      express.raw({
        type: '*/*',
        limit: '1024mb',
      }),
      (req, res) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.header(
          'Access-Control-Allow-Methods',
          'GET, PUT, PATCH, POST, DELETE',
        )
        res.header(
          'Access-Control-Allow-Headers',
          req.header('access-control-request-headers'),
        )
        if (req.method === 'OPTIONS') return res.send()
        const u = new url.URL(req.url.substring(7))
        const forward = https.request(
          u,
          {
            headers: { ...req.headers, host: u.hostname },
            method: req.method,
          },
          (proxied) => {
            for (const [key, value] of Object.entries(proxied.headers)) {
              res.header(key, value)
            }
            proxied.pipe(res)
          },
        )
        if (
          req.method !== 'GET' &&
          req.method !== 'DELETE' &&
          req.method !== 'HEAD'
        )
          forward.write(req.body)
        forward.end()
      },
    )
  }
  listen() {
    console.debug('Starting runtime server on port:', this.opts.port)
    this.app.listen({
      port: this.opts.port,
    })
  }
  pool(fun) {
    const result = this.pools[fun] || {
      pending: [],
      waiting: [],
      processes: [],
      requests: {},
      working: {},
    }
    this.pools[fun] = result
    return result
  }
  async next(proc, fun) {
    const pool = this.pool(fun)
    // Process pending payloads if any
    const pending = pool.pending.pop()
    if (pending) return pending
    return new Promise((resolve) => {
      pool.waiting[proc] = resolve
    })
  }
  async drain(opts) {
    const fun = Server.generateFunctionID(opts)
    console.debug('Draining function', fun)
    const pool = this.pool(fun)
    for (const proc of pool.processes) {
      proc.kill()
    }
    pool.waiting = {}
    pool.processes = []
  }
  static generateFunctionID(opts) {
    return opts.id
  }
  response(fun, request, response) {
    const pool = this.pool(fun)
    const r = pool.requests[request]
    if (!r) return
    delete pool.requests[request]
    r(response)
  }
  isWarm(id) {
    return this.warm[id]
  }
  async trigger(opts) {
    console.debug('Triggering', opts.function)
    const pool = this.pool(opts.function.id)
    // Check if invoked before
    if (!this.isWarm(opts.function.id)) {
      console.debug('First build...')
      const results = await opts.function.build()
      if (results && results.length > 0) {
        return {
          type: 'failure',
          error: {
            errorType: 'build_failure',
            errorMessage: `The function ${opts.function.handler} failed to build`,
            stackTrace: [],
          },
        }
      }
      this.warm[opts.function.id] = true
      console.debug('First build finished')
    }
    return new Promise((resolve) => {
      pool.requests[opts.payload.context.awsRequestId] = resolve
      const [key] = Object.keys(pool.waiting)
      if (key) {
        const w = pool.waiting[key]
        delete pool.waiting[key]
        w(opts.payload)
        return
      }
      // Spawn new worker if one not immediately available
      pool.pending.push(opts.payload)
      const id = v4()
      this.lastRequest[id] = opts.payload.context.awsRequestId
      const instructions = opts.function.resolve(opts.function.runtime)
      const api = `127.0.0.1:${this.opts.port}/${id}/${opts.function.id}`
      const env = {
        ...opts.env,
        ...instructions.run.env,
        AWS_LAMBDA_RUNTIME_API: api,
        IS_LOCAL: 'true',
      }
      console.debug('Spawning', instructions.run)
      const proc = spawn(instructions.run.command, instructions.run.args, {
        env,
      })
      proc.stdout.on('data', (d) => console.log(d.toString()))
      proc.stderr.on('data', (d) => console.error(d.toString()))
      proc.on('exit', () => {
        pool.processes = pool.processes.filter((p) => p !== proc)
        delete pool.waiting[id]
      })
      pool.processes.push(proc)
    })
  }
}
