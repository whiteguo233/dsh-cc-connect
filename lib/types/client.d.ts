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
/** Expand a leading `~` to the user's home directory. */
export declare function expandHome(path: string): string;
export interface RawResponse {
    status: number;
    body: string;
}
/**
 * Perform one raw HTTP/1.1 request over a Unix domain socket.
 * @param socketPath - path to the listening Unix socket
 * @param method - HTTP method (POST)
 * @param path - request path (e.g. "/send")
 * @param body - optional JSON body
 */
export declare function httpOverUnix(socketPath: string, method: string, path: string, body?: unknown, timeoutMs?: number): Promise<RawResponse>;
/** One session as reported by the Management API. */
export interface CCSession {
    id: string;
    session_key: string;
    name: string;
    platform: string;
    active: boolean;
    live: boolean;
}
/** One project as reported by the Management API. */
export interface CCProject {
    name: string;
    platform?: string;
    sessions?: CCSession[];
}
/** cc-connect client combining the outbound unix-socket path and the management API. */
export interface CCConnectClient {
    /** Push a text message out to a platform session (agent → user). */
    send(project: string, sessionKey: string, message: string): Promise<{
        ok: boolean;
        detail: string;
    }>;
    /** List projects and their sessions through the Management API. */
    list(): Promise<CCProject[]>;
}
/** Config resolved by the plugin (defaults applied). */
export interface ResolvedConfig {
    socketPath: string;
    defaultProject: string;
    defaultSessionKey: string;
    managementUrl: string;
    managementToken: string;
}
export declare function resolveConfig(raw: {
    socketPath?: string;
    defaultProject?: string;
    defaultSessionKey?: string;
    managementUrl?: string;
    managementToken?: string;
}): ResolvedConfig;
export declare function createClient(config: ResolvedConfig): CCConnectClient;
//# sourceMappingURL=client.d.ts.map