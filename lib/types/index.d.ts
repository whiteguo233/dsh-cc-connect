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
import type { Context } from 'cordis';
import z from 'schemastery';
/** Host-side plugin identity used by the composition row. */
export declare const name = "cc-connect";
/** Services required by this plugin. */
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /** Path to cc-connect's internal API unix socket (default ~/.cc-connect/run/api.sock). */
    socketPath?: string;
    /** Default project used by cc_connect_send when the model omits `project`. */
    defaultProject?: string;
    /** Default session key used by cc_connect_send when the model omits `session_key`. */
    defaultSessionKey?: string;
    /** cc-connect Management API base URL, e.g. http://127.0.0.1:9820 (required for cc_connect_list). */
    managementUrl?: string;
    /** cc-connect Management API token (see [management] token in config.toml). */
    managementToken?: string;
}
/** Schemastery runtime schema for {@link Config}. */
export declare const Config: z<Config>;
/** Mount the cc-connect bridge tools. */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map