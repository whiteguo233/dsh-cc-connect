/**
 * dsh-cc-connect — bridge a running cc-connect instance into DeepSeek Harness.
 *
 * Registers two model-facing tools:
 * - `cc_connect_send`  — push text OUT to a cc-connect platform session
 *                        (Feishu/WeChat/Telegram/…) via the internal unix socket.
 * - `cc_connect_list`  — list cc-connect projects/sessions via the Management API.
 *
 * Direction note: the inbound half of the bridge (IM message → dsh session)
 * is provided by the cc-connect-side agent adapter in `go/` of this repo
 * (project agent type "dsh"); this plugin covers the dsh-initiated direction
 * and session discovery.
 */

import type { Context } from 'cordis'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import { createClient, resolveConfig } from './client.ts'
import { listTool, sendTool } from './tools.ts'

/** Host-side plugin identity used by the composition row. */
export const name = 'cc-connect'

/** Services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /** Path to cc-connect's internal API unix socket (default ~/.cc-connect/run/api.sock). */
  socketPath?: string
  /** Default project used by cc_connect_send when the model omits `project`. */
  defaultProject?: string
  /** Default session key used by cc_connect_send when the model omits `session_key`. */
  defaultSessionKey?: string
  /** cc-connect Management API base URL, e.g. http://127.0.0.1:9820 (required for cc_connect_list). */
  managementUrl?: string
  /** cc-connect Management API token (see [management] token in config.toml). */
  managementToken?: string
}

/** Schemastery runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  socketPath: z.string().default(''),
  defaultProject: z.string().default(''),
  defaultSessionKey: z.string().default(''),
  managementUrl: z.string().default(''),
  managementToken: z.string().default(''),
})

/** Mount the cc-connect bridge tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const client = createClient(resolved)
  ctx.tools.register(sendTool(client, resolved))
  ctx.tools.register(listTool(client))
}
