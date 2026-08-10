# dsh-cc-connect

通过 cc-connect 远程使用 dsh —— dsh（DeepSeek Harness）与 [cc-connect](https://github.com/chenhg5/cc-connect) 的双向桥接：

| 方向 | 实现 | 位置 |
|---|---|---|
| **IM → dsh**（飞书/微信/Telegram 消息进入 dsh 会话） | cc-connect 的 `dsh` agent 适配器（Go） | [`go/`](./go/) |
| **dsh → IM**（dsh 会话主动推送消息到飞书等） | dsh 插件 `@dsh-external/cc-connect`（Cordis，两个工具） | 本仓库根目录 |

```
飞书/微信/… ──IM 消息──▶ cc-connect ──dsh agent(Go, go/)──▶ dsh RPC API ──▶ dsh 会话
     ▲                                                                        │
     └──────────── cc_connect_send 工具（dsh 插件）◀─────────────────────────┘
```

- **入站**：cc-connect 项目配置 `type = "dsh"` 后，飞书等平台的消息由 cc-connect 转发到本机 `dsh web` 服务器（`POST /api/session.prompt` + WebSocket 事件流），每个项目一个 dsh 会话、自动续聊、流式回复、审批/问答卡回传。见 [`go/README.md`](./go/README.md)。
- **出站**：dsh 插件注册 `cc_connect_send` / `cc_connect_list` 工具，让 dsh 的 agent 主动把消息推送到 cc-connect 的任意平台会话（走 cc-connect 内部 unix socket `/send`），以及通过管理 API 列出项目/会话。

---

## 仓库结构

```
├── package.json          # dsh 插件 @dsh-external/cc-connect（仓库根）
├── src/                  # 插件源码（Cordis + schemastery）
├── tests/                # vitest 单元测试
├── lib/                  # 构建产物（已提交，dsh plugin add 直接使用）
├── cordis.yml            # 组合插入片段示例
└── go/                   # cc-connect 侧 dsh agent 的独立 Go module
    └── dsh/              #   package dsh（client / session / agent / aggregator）
```

---

## 一、cc-connect 侧：把 dsh 接入为 agent（入站）

独立 Go module：`github.com/dsh-external/dsh-cc-connect/go`，实现 cc-connect 的 `core.Agent` / `core.AgentSession`，依赖 `github.com/chenhg5/cc-connect/core`。

### 接入方式

**方式 A：直接内嵌（推荐，最简单）**——把 `go/dsh/` 拷入 cc-connect 仓库 `agent/dsh/`，并在 `cmd/cc-connect/plugin_agent_dsh.go` 引用：

```go
//go:build !no_dsh

package main

import _ "github.com/chenhg5/cc-connect/agent/dsh"
```

**方式 B：作为外部 module 引用**：

```bash
# cc-connect 仓库内
go mod edit -require=github.com/dsh-external/dsh-cc-connect/go@latest
go mod edit -replace=github.com/dsh-external/dsh-cc-connect/go=../dsh-cc-connect/go   # 本地开发
GOPRIVATE=github.com/dsh-external/* go mod tidy
```

```go
//go:build !no_dsh

package main

import _ "github.com/dsh-external/dsh-cc-connect/go/dsh"
```

### 配置（config.toml）

**推荐开全局富卡片模式**（Card 2.0，200ms 节流打字机 + 工具步骤/思考折叠；不支持的平台自动回退 legacy，无副作用）：

```toml
[display]
  card_mode = "rich"   # 全局默认富卡片（只对支持的平台生效）
```

```toml
[[projects]]
  name = "dsh-proj"

  [projects.agent]
    type = "dsh"

    [projects.agent.options]
      work_dir = "/path/to/your/project"   # dsh 会话的工作目录（必须绝对路径）
      base_url = "http://127.0.0.1:3080"   # dsh web 服务地址（默认）
      # agent_preset = "standard"          # 可选：dsh agent preset
      # model = "deepseek/deepseek-chat"   # 可选："provider/model" 覆盖
      # timeout_mins = 30                  # 可选：单轮超时（0 = 不限）

  [[projects.platforms]]
    type = "feishu"                        # 或 telegram / weixin / ...
    [projects.platforms.options]
      app_id = "cli_xxx"
      app_secret = "xxx"
```

> 只想单个项目开富卡片，把 `card_mode` 放进该项目的 `[projects.display]` 即可（项目级优先于全局）。

**前置条件**：本机运行 `dsh web`（默认 127.0.0.1:3080）；会话以 `work_dir` 为 cwd 创建，自动续聊。详见 [`go/README.md`](./go/README.md)（含能力清单：流式、审批、AskUserQuestion、/stop、/model、/list、超时看门狗、doctor 检查、CC_PROJECT/CC_SESSION_KEY 注入）。

---

## 二、dsh 侧插件：cc_connect_send / cc_connect_list（出站）

### 安装

```bash
dsh plugin --profile web add git+ssh://git@github.com:dsh-external/dsh-cc-connect.git
```

在 `~/.dsh/profiles/web/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: cc-connect
      name: '@dsh-external/cc-connect'
      config:
        defaultProject: 'dsh-proj'
        defaultSessionKey: 'feishu:oc_xxx:ou_xxx'
        managementUrl: 'http://127.0.0.1:9820'
        managementToken: '你的-management-token'
```

（等价片段已放在仓库根 `cordis.yml`。）

### 配置字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `socketPath` | 否 | cc-connect 内部 API unix socket，默认 `~/.cc-connect/run/api.sock` |
| `defaultProject` | 否 | `cc_connect_send` 缺省项目名 |
| `defaultSessionKey` | 否 | `cc_connect_send` 缺省会话 key |
| `managementUrl` | 否* | cc-connect 管理 API 地址（如 `http://127.0.0.1:9820`），`cc_connect_list` 需要 |
| `managementToken` | 否* | 管理 API token（cc-connect `[management]` 段的 `token`） |

\* `cc_connect_send` 不需要管理 API；`cc_connect_list` 需要 `managementUrl` + `managementToken`。

### 工具

- **`cc_connect_send`**：`message`（必填）、`project`、`session_key`（后两者可省略用默认值）。把文本作为机器人消息推送到 cc-connect 对应平台的聊天会话（走 unix socket `POST /send`）。适合把 dsh 的进度/结果/通知推给飞书、微信等。
- **`cc_connect_list`**：列出 cc-connect 项目及其会话（platform / session_key / live 状态），方便模型发现可用的发送目标。

---

## 开发

```bash
# Go module（入站适配器）
cd go && go build ./... && go test ./dsh/ -race

# dsh 插件
pnpm install            # 依赖 @deepseek-ai/dsh-tools 等 peer 包需先装好 dsh 环境
pnpm build              # tsc（类型到 lib/types）+ tsdown（打包到 lib/index.mjs）
pnpm test               # vitest
```

## License

BSD-3-Clause，与 dsh-external 组织其它仓库一致。
