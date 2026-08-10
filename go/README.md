# dsh-cc-connect — cc-connect 侧 dsh agent（入站桥接）

`package dsh` 是 cc-connect 的 agent 适配器：把**正在运行的 dsh web 服务器**接入 cc-connect，让飞书/微信/Telegram 等平台的消息直达 dsh 会话。

```
IM 消息 ─▶ cc-connect 引擎 ─▶ 本适配器 ─▶ dsh web RPC API ─▶ dsh 会话（work_dir 为 cwd）
                ▲                    │        (127.0.0.1:3080)
                └── 流式事件/审批/问答 ┘   WebSocket /api/events.mux
```

## 能力

- **会话**：`POST /api/session.create`，以项目 `work_dir` 为 cwd；同一 session id 幂等复用 → cc-connect 重启后自动续聊。
- **发消息**：`POST /api/session.prompt`（文字 + 图片 base64；文件落盘 `.cc-connect/attachments` 并引用路径）。
- **流式输出**：`GET /api/events.mux`（WebSocket）→ 文本/思考增量、工具调用与结果、token 用量。
- **增量聚合**：dsh 逐 token 流式输出，适配器合并成句子级 chunk（≥40 字符或句末标点或 500ms 兜底）再交给引擎，避免飞书上逐词蹦字。
- **权限审批**：`approval/requested` → `EventPermissionRequest`（飞书 Allow/Deny 按钮）→ `POST /api/respond`。
- **AskUserQuestion**：`question/requested` → 问答卡 → 答案映射回 option label / custom 文本。
- **/stop**：`AgentSessionCanceller` → `session.cancel`（会话保留，下条消息继续）。
- **/model**：`session.models` / `session.selectModel`（配置 `model = "provider/model"` 或运行时切换）。
- **/list**：`session.list` 按 cwd 过滤 + 标题摘要；会话 id 跨项目校验（`SessionIDValidator`）。
- **超时看门狗**：`timeout_mins` 单轮超时自动 `session.cancel`。
- **cc-connect CLI 环境注入**：`CC_PROJECT` / `CC_SESSION_KEY` / `CC_DATA_DIR` 在新建会话首条消息注入，cron/timer/relay 可用（dsh 服务进程 PATH 需含 cc-connect）。
- **doctor**：`cc-connect doctor` 检查 dsh web 服务器可达性。
- **MemoryFile**：`ProjectMemoryFile() = <work_dir>/AGENTS.md`（dsh 原生读取），cc-connect 的 relay/cron 指令块自动落入模型上下文。

## 实现说明

| 文件 | 内容 |
|---|---|
| `client.go` | dsh RPC 客户端：unary `POST /api/<method>`、`POST /api/respond`、WebSocket mux 流解析（wire 类型对齐 `packages/host/apiproxy`） |
| `session.go` | `core.AgentSession`：事件映射（turn/chunk/tool/approval/question）、pending 表、看门狗、env bootstrap |
| `dsh.go` | `core.Agent` + 可选接口（ModelSwitcher / SessionIDValidator / MemoryFileProvider / SessionEnvInjector / AgentDoctorInfo / DoctorChecker） |
| `aggregator.go` | 逐 token 增量 → 句子级 chunk 的合并器 |

## 测试

```bash
go test ./dsh/ -race          # mock dsh 服务器（httptest + gorilla/websocket）13+ 用例
go test -tags smoke ./dsh/ -run TestSmoke_RoundTrip -v   # 对真实 dsh web 的端到端冒烟
```

## 配置

见仓库根 README「一、cc-connect 侧」；完整字段：`base_url` / `work_dir` / `agent_preset` / `model` / `timeout_mins`。

## 已知限制

- 需本机运行 `dsh web`；服务不可达时会话报错并给出启动提示。
- `/delete`（SessionDeleter）未实现 —— dsh 会话在 dsh Web GUI 中管理。
- `filter_external_sessions` 不区分 web GUI 与 cc-connect 创建的会话。
