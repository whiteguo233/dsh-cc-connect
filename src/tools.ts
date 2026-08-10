/**
 * Model-facing tools bridging dsh sessions to a running cc-connect instance.
 *
 * - `cc_connect_send`: push a text message OUT to a cc-connect platform
 *   session (agent → user), e.g. notify a Feishu/WeChat chat of progress or
 *   results while working inside dsh.
 * - `cc_connect_list`: list cc-connect projects and their sessions so the
 *   model can discover valid `project` / `session_key` targets.
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CCConnectClient, ResolvedConfig } from './client.ts'

/** Build the send tool bound to the configured client. */
export function sendTool(client: CCConnectClient, config: ResolvedConfig): ToolDefinition {
  return {
    name: 'cc_connect_send',
    description:
      'Send a text message from dsh to a cc-connect platform session (Feishu/WeChat/Telegram/etc.) '
      + '— the agent-to-user direction. Use this to push progress updates, final results, or '
      + 'notifications to the user\'s IM chat while working. '
      + 'The message is delivered as a bot message in the bound chat. '
      + 'Use cc_connect_list first to discover valid project and session_key values.',
    parameters: {
      message: { type: 'string', required: true, description: 'The message text to deliver to the chat.' },
      project: {
        type: 'string', required: false,
        description: 'cc-connect project name. Defaults to the configured default_project.',
      },
      session_key: {
        type: 'string', required: false,
        description: 'cc-connect session key of the target chat (e.g. "feishu:oc_xxx:ou_xxx"). Defaults to the configured default_session_key.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', description: 'Whether the message was accepted by cc-connect.' },
          detail: { type: 'string', description: 'Delivery target or the error message.' },
        },
        required: ['ok', 'detail'],
      },
      render(_args, value) {
        const v = value as { ok: boolean; detail: string }
        return [{ type: 'text', text: v.ok ? `📤 cc-connect send OK: ${v.detail}` : `❌ cc-connect send failed: ${v.detail}` }]
      },
    },
    async execute(args) {
      const { message, project, session_key } = args as { message: string; project?: string; session_key?: string }
      const targetProject = project?.trim() || config.defaultProject
      const targetKey = session_key?.trim() || config.defaultSessionKey
      if (!targetProject) {
        return { ok: false, detail: 'no project: pass `project` or set default_project in the cc-connect plugin config' }
      }
      if (!targetKey) {
        return { ok: false, detail: 'no session_key: pass `session_key` or set default_session_key in the cc-connect plugin config' }
      }
      try {
        return await client.send(targetProject, targetKey, message)
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

/** Build the list tool bound to the configured client. */
export function listTool(client: CCConnectClient): ToolDefinition {
  return {
    name: 'cc_connect_list',
    description:
      'List cc-connect projects and their sessions (IM chats). Use it to discover valid project '
      + 'names and session_key values before calling cc_connect_send. Requires the management API '
      + 'to be configured (management_url + management_token plugin config).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          detail: { type: 'string', description: 'Error message when ok is false.' },
          projects: {
            type: 'array',
            description: 'Projects with their sessions, when ok is true.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                platform: { type: 'string' },
                sessions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      session_key: { type: 'string' },
                      name: { type: 'string' },
                      platform: { type: 'string' },
                      active: { type: 'boolean' },
                      live: { type: 'boolean' },
                    },
                    required: ['session_key'],
                  },
                },
              },
              required: ['name'],
            },
          },
        },
        required: ['ok'],
      },
      render(_args, value) {
        const v = value as { ok: boolean; detail?: string; projects?: { name: string; platform?: string; sessions?: { session_key: string; name: string; active: boolean; live: boolean }[] }[] }
        if (!v.ok) return [{ type: 'text', text: `❌ cc-connect list failed: ${v.detail ?? 'unknown'}` }]
        const lines = ['📡 cc-connect projects:']
        for (const p of v.projects ?? []) {
          lines.push(`- ${p.name}${p.platform ? ` (${p.platform})` : ''}`)
          for (const s of p.sessions ?? []) {
            const name = s.name || '(unnamed)'
            lines.push(`    ${s.session_key} — ${name}${s.live ? ' [live]' : ''}`)
          }
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() {
      try {
        const projects = await client.list()
        return { ok: true, projects }
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
