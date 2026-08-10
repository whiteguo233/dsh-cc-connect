/**
 * Model-facing tools bridging dsh sessions to a running cc-connect instance.
 *
 * - `cc_connect_send`: push a text message OUT to a cc-connect platform
 *   session (agent → user), e.g. notify a Feishu/WeChat chat of progress or
 *   results while working inside dsh.
 * - `cc_connect_list`: list cc-connect projects and their sessions so the
 *   model can discover valid `project` / `session_key` targets.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { CCConnectClient, ResolvedConfig } from './client.ts';
/** Build the send tool bound to the configured client. */
export declare function sendTool(client: CCConnectClient, config: ResolvedConfig): ToolDefinition;
/** Build the list tool bound to the configured client. */
export declare function listTool(client: CCConnectClient): ToolDefinition;
//# sourceMappingURL=tools.d.ts.map