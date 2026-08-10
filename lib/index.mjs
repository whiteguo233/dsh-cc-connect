import z from "schemastery";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/client.ts
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
function expandHome(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Perform one raw HTTP/1.1 request over a Unix domain socket.
* @param socketPath - path to the listening Unix socket
* @param method - HTTP method (POST)
* @param path - request path (e.g. "/send")
* @param body - optional JSON body
*/
function httpOverUnix(socketPath, method, path, body, timeoutMs = 15e3) {
	return new Promise((resolve, reject) => {
		const sock = connect(expandHome(socketPath));
		let buf = "";
		const timer = setTimeout(() => {
			sock.destroy();
			reject(/* @__PURE__ */ new Error(`cc-connect: unix socket request timed out after ${timeoutMs}ms (${socketPath}${path})`));
		}, timeoutMs);
		const finish = (fn) => {
			clearTimeout(timer);
			fn();
		};
		sock.on("connect", () => {
			const payload = body === void 0 ? "" : JSON.stringify(body);
			const head = [
				`${method} ${path} HTTP/1.1`,
				"Host: unix",
				"Content-Type: application/json",
				`Content-Length: ${Buffer.byteLength(payload)}`,
				"Connection: close",
				"",
				""
			].join("\r\n");
			sock.write(head + payload);
		});
		sock.on("data", (chunk) => {
			buf += chunk.toString("utf8");
		});
		sock.on("end", () => finish(() => resolve(parseRawHttp(buf))));
		sock.on("error", (err) => finish(() => reject(/* @__PURE__ */ new Error(`cc-connect: unix socket ${socketPath}: ${err.message}`))));
	});
}
/** Parse a minimal HTTP/1.1 response (status line + headers + body). */
function parseRawHttp(raw) {
	const idx = raw.indexOf("\r\n\r\n");
	const head = idx === -1 ? raw : raw.slice(0, idx);
	const body = idx === -1 ? "" : raw.slice(idx + 4);
	return {
		status: Number(head.split(" ")[1] ?? 0),
		body
	};
}
function resolveConfig(raw) {
	return {
		socketPath: raw.socketPath?.trim() || join(homedir(), ".cc-connect", "run", "api.sock"),
		defaultProject: (raw.defaultProject ?? "").trim(),
		defaultSessionKey: (raw.defaultSessionKey ?? "").trim(),
		managementUrl: (raw.managementUrl ?? "").trim().replace(/\/+$/, ""),
		managementToken: (raw.managementToken ?? "").trim()
	};
}
function createClient(config) {
	return {
		async send(project, sessionKey, message) {
			const resp = await httpOverUnix(config.socketPath, "POST", "/send", {
				project,
				session_key: sessionKey,
				message
			});
			if (resp.status === 200) return {
				ok: true,
				detail: `sent to ${project} / ${sessionKey}`
			};
			return {
				ok: false,
				detail: `cc-connect /send returned HTTP ${resp.status}: ${resp.body.trim() || "no body"}`
			};
		},
		async list() {
			if (!config.managementUrl || !config.managementToken) throw new Error("cc-connect list requires management_url and management_token in plugin config (cc-connect [management] enabled = true, port = 9820, token = \"...\")");
			const projects = await mgmtGet(config, "/api/v1/projects");
			const out = [];
			for (const p of projects.projects ?? []) {
				let sessions = [];
				try {
					sessions = (await mgmtGet(config, `/api/v1/projects/${encodeURIComponent(p.name)}/sessions`)).sessions ?? [];
				} catch (err) {
					sessions = [];
				}
				out.push({
					name: p.name,
					...p.platform ? { platform: p.platform } : {},
					sessions
				});
			}
			return out;
		}
	};
}
async function mgmtGet(config, path) {
	const resp = await fetch(config.managementUrl + path, { headers: { Authorization: `Bearer ${config.managementToken}` } });
	const text = await resp.text();
	if (!resp.ok) throw new Error(`cc-connect management API ${path} returned HTTP ${resp.status}: ${text.slice(0, 300)}`);
	let data = {};
	try {
		data = JSON.parse(text);
	} catch {}
	if (data.ok === false || data.data === void 0) throw new Error(`cc-connect management API ${path}: unexpected response: ${text.slice(0, 300)}`);
	return data.data;
}
//#endregion
//#region src/tools.ts
/** Build the send tool bound to the configured client. */
function sendTool(client, config) {
	return {
		name: "cc_connect_send",
		description: "Send a text message from dsh to a cc-connect platform session (Feishu/WeChat/Telegram/etc.) — the agent-to-user direction. Use this to push progress updates, final results, or notifications to the user's IM chat while working. The message is delivered as a bot message in the bound chat. Use cc_connect_list first to discover valid project and session_key values.",
		parameters: {
			message: {
				type: "string",
				required: true,
				description: "The message text to deliver to the chat."
			},
			project: {
				type: "string",
				required: false,
				description: "cc-connect project name. Defaults to the configured default_project."
			},
			session_key: {
				type: "string",
				required: false,
				description: "cc-connect session key of the target chat (e.g. \"feishu:oc_xxx:ou_xxx\"). Defaults to the configured default_session_key."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						description: "Whether the message was accepted by cc-connect."
					},
					detail: {
						type: "string",
						description: "Delivery target or the error message."
					}
				},
				required: ["ok", "detail"]
			},
			render(_args, value) {
				const v = value;
				return [{
					type: "text",
					text: v.ok ? `📤 cc-connect send OK: ${v.detail}` : `❌ cc-connect send failed: ${v.detail}`
				}];
			}
		},
		async execute(args) {
			const { message, project, session_key } = args;
			const targetProject = project?.trim() || config.defaultProject;
			const targetKey = session_key?.trim() || config.defaultSessionKey;
			if (!targetProject) return {
				ok: false,
				detail: "no project: pass `project` or set default_project in the cc-connect plugin config"
			};
			if (!targetKey) return {
				ok: false,
				detail: "no session_key: pass `session_key` or set default_session_key in the cc-connect plugin config"
			};
			try {
				return await client.send(targetProject, targetKey, message);
			} catch (err) {
				return {
					ok: false,
					detail: err instanceof Error ? err.message : String(err)
				};
			}
		}
	};
}
/** Build the list tool bound to the configured client. */
function listTool(client) {
	return {
		name: "cc_connect_list",
		description: "List cc-connect projects and their sessions (IM chats). Use it to discover valid project names and session_key values before calling cc_connect_send. Requires the management API to be configured (management_url + management_token plugin config).",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean" },
					detail: {
						type: "string",
						description: "Error message when ok is false."
					},
					projects: {
						type: "array",
						description: "Projects with their sessions, when ok is true.",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								platform: { type: "string" },
								sessions: {
									type: "array",
									items: {
										type: "object",
										additionalProperties: false,
										properties: {
											session_key: { type: "string" },
											name: { type: "string" },
											platform: { type: "string" },
											active: { type: "boolean" },
											live: { type: "boolean" }
										},
										required: ["session_key"]
									}
								}
							},
							required: ["name"]
						}
					}
				},
				required: ["ok"]
			},
			render(_args, value) {
				const v = value;
				if (!v.ok) return [{
					type: "text",
					text: `❌ cc-connect list failed: ${v.detail ?? "unknown"}`
				}];
				const lines = ["📡 cc-connect projects:"];
				for (const p of v.projects ?? []) {
					lines.push(`- ${p.name}${p.platform ? ` (${p.platform})` : ""}`);
					for (const s of p.sessions ?? []) {
						const name = s.name || "(unnamed)";
						lines.push(`    ${s.session_key} — ${name}${s.live ? " [live]" : ""}`);
					}
				}
				return [{
					type: "text",
					text: lines.join("\n")
				}];
			}
		},
		async execute() {
			try {
				return {
					ok: true,
					projects: await client.list()
				};
			} catch (err) {
				return {
					ok: false,
					detail: err instanceof Error ? err.message : String(err)
				};
			}
		}
	};
}
//#endregion
//#region src/index.ts
/** Host-side plugin identity used by the composition row. */
const name = "cc-connect";
/** Services required by this plugin. */
const inject = ["tools"];
/** Schemastery runtime schema for {@link Config}. */
const Config = z.object({
	socketPath: z.string().default(""),
	defaultProject: z.string().default(""),
	defaultSessionKey: z.string().default(""),
	managementUrl: z.string().default(""),
	managementToken: z.string().default("")
});
/** Mount the cc-connect bridge tools. */
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	const client = createClient(resolved);
	ctx.tools.register(sendTool(client, resolved));
	ctx.tools.register(listTool(client));
}
//#endregion
export { Config, apply, inject, name };
