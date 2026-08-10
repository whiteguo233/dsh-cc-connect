import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, httpOverUnix, resolveConfig } from '../src/client.ts'

/** A minimal HTTP/1.1 request parsed from a raw unix-socket stream. */
interface RawRequest {
  method: string
  path: string
  body: string
}

function parseRawRequest(raw: string): RawRequest {
  const idx = raw.indexOf('\r\n\r\n')
  const head = idx === -1 ? raw : raw.slice(0, idx)
  const body = idx === -1 ? '' : raw.slice(idx + 4)
  const lines = head.split('\r\n')
  const [method, path] = lines[0]?.split(' ') ?? ['', '']
  return { method: method ?? '', path: path ?? '', body }
}

describe('httpOverUnix + client', () => {
  let dir: string
  let sockPath: string
  let server: Server
  let lastRequest: RawRequest | null = null

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-cc-connect-test-'))
    sockPath = join(dir, 'api.sock')
    server = createServer((socket) => {
      let buf = ''
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        if (buf.includes('\r\n\r\n')) {
          lastRequest = parseRawRequest(buf)
          socket.end(
            'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 24\r\nConnection: close\r\n\r\n'
            + JSON.stringify({ status: 'ok' }),
          )
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(sockPath, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sends a raw HTTP POST over the unix socket', async () => {
    const resp = await httpOverUnix(sockPath, 'POST', '/send', { message: 'hi' })
    expect(resp.status).toBe(200)
    expect(JSON.parse(resp.body)).toEqual({ status: 'ok' })
    expect(lastRequest?.method).toBe('POST')
    expect(lastRequest?.path).toBe('/send')
    expect(JSON.parse(lastRequest?.body ?? '{}')).toEqual({ message: 'hi' })
  })

  it('client.send posts project/session_key/message', async () => {
    const cfg = resolveConfig({ socketPath: sockPath })
    const client = createClient(cfg)
    const result = await client.send('proj-a', 'feishu:oc_1:ou_2', 'hello from dsh')
    expect(result.ok).toBe(true)
    expect(JSON.parse(lastRequest?.body ?? '{}')).toEqual({
      project: 'proj-a',
      session_key: 'feishu:oc_1:ou_2',
      message: 'hello from dsh',
    })
  })

  it('defaults socketPath to ~/.cc-connect/run/api.sock when unset', () => {
    const cfg = resolveConfig({})
    expect(cfg.socketPath).toContain('.cc-connect/run/api.sock')
  })

  it('client.list reads projects and sessions from the management API', async () => {
    const { createServer: createHttpServer } = await import('node:http')
    const http = createHttpServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/v1/projects') {
        res.end(JSON.stringify({ ok: true, data: { projects: [{ name: 'proj-a', platform: 'feishu' }] } }))
        return
      }
      if (req.url === '/api/v1/projects/proj-a/sessions') {
        res.end(JSON.stringify({
          ok: true,
          data: {
            sessions: [{
              id: 's1', session_key: 'feishu:oc_1:ou_2', name: 'work',
              platform: 'feishu', active: true, live: true,
            }],
          },
        }))
        return
      }
      res.statusCode = 404
      res.end('not found')
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    try {
      const port = (http.address() as { port: number }).port
      const cfg = resolveConfig({ managementUrl: `http://127.0.0.1:${port}`, managementToken: 'tok' })
      const client = createClient(cfg)
      const projects = await client.list()
      expect(projects).toHaveLength(1)
      expect(projects[0]?.name).toBe('proj-a')
      expect(projects[0]?.sessions?.[0]?.session_key).toBe('feishu:oc_1:ou_2')
      expect(projects[0]?.sessions?.[0]?.live).toBe(true)
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  })

  it('client.list fails with a clear error when management config is missing', async () => {
    const cfg = resolveConfig({})
    const client = createClient(cfg)
    await expect(client.list()).rejects.toThrow(/management_url/)
  })
})
