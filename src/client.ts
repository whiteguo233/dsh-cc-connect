/**
 * Minimal raw-HTTP client over a Unix domain socket, plus a management-API
 * client for a running cc-connect instance.
 *
 * cc-connect's outbound message path (agent → platform user) is served on
 * the internal Unix socket (`~/.cc-connect/run/api.sock`, POST /send); Node's
 * fetch cannot reach a Unix socket, so we speak HTTP/1.1 manually over
 * `node:net`. Discovery/status endpoints are read through the Management API
 * (TCP, `Authorization: Bearer <token>`), which fetch handles natively.
 */

import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Expand a leading `~` to the user's home directory. */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

export interface RawResponse {
  status: number
  body: string
}

/**
 * Perform one raw HTTP/1.1 request over a Unix domain socket.
 * @param socketPath - path to the listening Unix socket
 * @param method - HTTP method (POST)
 * @param path - request path (e.g. "/send")
 * @param body - optional JSON body
 */
export function httpOverUnix(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 15000,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const sock = connect(expandHome(socketPath))
    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`cc-connect: unix socket request timed out after ${timeoutMs}ms (${socketPath}${path})`))
    }, timeoutMs)

    const finish = (fn: () => void): void => { clearTimeout(timer); fn() }

    sock.on('connect', () => {
      const payload = body === undefined ? '' : JSON.stringify(body)
      const head = [
        `${method} ${path} HTTP/1.1`,
        'Host: unix',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(payload)}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n')
      sock.write(head + payload)
    })
    sock.on('data', (chunk) => { buf += chunk.toString('utf8') })
    sock.on('end', () => finish(() => resolve(parseRawHttp(buf))))
    sock.on('error', (err) => finish(() => reject(new Error(`cc-connect: unix socket ${socketPath}: ${err.message}`))))
  })
}

/** Parse a minimal HTTP/1.1 response (status line + headers + body). */
function parseRawHttp(raw: string): RawResponse {
  const idx = raw.indexOf('\r\n\r\n')
  const head = idx === -1 ? raw : raw.slice(0, idx)
  const body = idx === -1 ? '' : raw.slice(idx + 4)
  const status = Number(head.split(' ')[1] ?? 0)
  return { status, body }
}

/** One session as reported by the Management API. */
export interface CCSession {
  id: string
  session_key: string
  name: string
  platform: string
  active: boolean
  live: boolean
}

/** One project as reported by the Management API. */
export interface CCProject {
  name: string
  platform?: string
  sessions?: CCSession[]
}
/** cc-connect client combining the outbound unix-socket path and the management API. */
export interface CCConnectClient {
  /** Push a text message out to a platform session (agent → user). */
  send(project: string, sessionKey: string, message: string): Promise<{ ok: boolean; detail: string }>
  /** List projects and their sessions through the Management API. */
  list(): Promise<CCProject[]>
}

/** Config resolved by the plugin (defaults applied). */
export interface ResolvedConfig {
  socketPath: string
  defaultProject: string
  defaultSessionKey: string
  managementUrl: string
  managementToken: string
}

export function resolveConfig(raw: {
  socketPath?: string
  defaultProject?: string
  defaultSessionKey?: string
  managementUrl?: string
  managementToken?: string
}): ResolvedConfig {
  return {
    socketPath: raw.socketPath?.trim() || join(homedir(), '.cc-connect', 'run', 'api.sock'),
    defaultProject: (raw.defaultProject ?? '').trim(),
    defaultSessionKey: (raw.defaultSessionKey ?? '').trim(),
    managementUrl: (raw.managementUrl ?? '').trim().replace(/\/+$/, ''),
    managementToken: (raw.managementToken ?? '').trim(),
  }
}

export function createClient(config: ResolvedConfig): CCConnectClient {
  return {
    async send(project, sessionKey, message) {
      const resp = await httpOverUnix(config.socketPath, 'POST', '/send', {
        project,
        session_key: sessionKey,
        message,
      })
      if (resp.status === 200) {
        return { ok: true, detail: `sent to ${project} / ${sessionKey}` }
      }
      return { ok: false, detail: `cc-connect /send returned HTTP ${resp.status}: ${resp.body.trim() || 'no body'}` }
    },

    async list() {
      if (!config.managementUrl || !config.managementToken) {
        throw new Error(
          'cc-connect list requires management_url and management_token in plugin config '
          + '(cc-connect [management] enabled = true, port = 9820, token = "...")',
        )
      }
      const projects = await mgmtGet<{ projects: { name: string; platform?: string }[] }>(
        config, '/api/v1/projects',
      )
      const out: CCProject[] = []
      for (const p of projects.projects ?? []) {
        let sessions: CCSession[] = []
        try {
          const s = await mgmtGet<{ sessions: CCSession[] }>(config, `/api/v1/projects/${encodeURIComponent(p.name)}/sessions`)
          sessions = s.sessions ?? []
        } catch (err) {
          sessions = []
        }
        out.push({ name: p.name, ...(p.platform ? { platform: p.platform } : {}), sessions })
      }
      return out
    },
  }
}

async function mgmtGet<T>(config: ResolvedConfig, path: string): Promise<T> {
  const resp = await fetch(config.managementUrl + path, {
    headers: { Authorization: `Bearer ${config.managementToken}` },
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(`cc-connect management API ${path} returned HTTP ${resp.status}: ${text.slice(0, 300)}`)
  }
  let data: { ok?: boolean; data?: T } = {}
  try { data = JSON.parse(text) as { ok?: boolean; data?: T } } catch { /* non-JSON */ }
  if (data.ok === false || data.data === undefined) {
    throw new Error(`cc-connect management API ${path}: unexpected response: ${text.slice(0, 300)}`)
  }
  return data.data
}
