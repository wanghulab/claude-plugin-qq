# claude-channel-qq

[English](#english) | [中文](#中文)

---

<a name="english"></a>

## English

QQ channel plugin for [Claude Code](https://claude.com/claude-code) — receive and reply to QQ messages directly in your terminal.

Uses [NapCatQQ](https://github.com/NapNeko/NapCatQQ) with OneBot 11 protocol. HTTP event post — no WebSocket or public webhook needed.

### Features

- **Automatic message polling** via Stop hook — messages are injected into context automatically
- **Remote command execution** — send `/cmd <command>` from QQ to execute commands on the host
- **Access control** — pairing mode, allowlist, or disabled
- **Message chunking** — long replies split at paragraph/line/space boundaries
- **Dangerous command filtering** — blocks `rm -rf`, `drop table`, `git push --force`, etc.
- **MCP tools** — `check_messages` and `reply` for manual control

### Prerequisites

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh) runtime
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) installed and running

### Install

```bash
# 1. Add the marketplace
claude plugin marketplace add wanghulab/claude-plugin-qq

# 2. Install the plugin
claude plugin install qq@claude-channel-qq
```

### NapCatQQ Configuration

Before using this plugin, configure NapCatQQ:

1. **Download and run NapCatQQ** from [Releases](https://github.com/NapNeko/NapCatQQ/releases)
2. **Login via WebUI** (usually at http://localhost:6099)
3. **Enable HTTP service** in NapCatQQ config:
   ```json
   {
     "http": {
       "enable": true,
       "host": "0.0.0.0",
       "port": 3000,
       "secret": ""
     }
   }
   ```
4. **Enable HTTP event post**:
   ```json
   {
     "post": {
       "enable": true,
       "urls": [
         "http://127.0.0.1:6099/onebot/event"
       ]
     }
   }
   ```

### Configure

#### Setup connection

In Claude Code, run:

```
/qq:configure setup http://localhost:3000
```

If NapCatQQ has access_token configured:

```
/qq:configure setup http://localhost:3000 your_token_here
```

#### Custom listen port

```
/qq:configure port 6199
```

#### Check status

```
/qq:configure
```

#### Test connection

```
/qq:configure test
```

### Usage Modes

#### Mode 1: Auto-Reply Background Script (Recommended)

A standalone background script that polls for new messages and replies using an LLM API — no Claude Code session required.

**1. Configure LLM API** — create `~/.claude/channels/qq/api.json`:

```json
{
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4/",
  "key": "your-api-key-here",
  "model": "glm-5.1"
}
```

Supports any OpenAI-compatible API (Anthropic, OpenAI, DeepSeek, GLM, etc.).

**2. Start the script:**

```bash
cd <plugin-directory>
bun auto-reply.ts
```

The script:
- Polls `/pending-messages` every 10 seconds
- Calls the LLM API to generate replies
- Sends replies via NapCatQQ HTTP API
- Handles message chunking for long replies

**3. Run as background process:**

```bash
nohup bun auto-reply.ts > /tmp/auto-reply.log 2>&1 &
```

#### Mode 2: Claude Code Session (with cron + Stop Hook)

When a Claude Code session is active, two mechanisms provide automatic QQ message handling:

- **Stop Hook (asyncRewake):** After each Claude response, checks for pending messages. If found, auto-wakes Claude to process them.
- **Cron Task (1-minute interval):** Periodic fallback that checks pending messages when the session is idle.

The cron task prompt instructs Claude to:
1. Fetch pending messages via `/pending-messages`
2. Search the web for relevant information
3. Generate a helpful reply
4. Send the reply and delete the processed message

> Note: Cron tasks are persistent (survive session restarts) but require Claude Code to be running.

#### Mode 3: Manual Polling

Use the `check_messages` MCP tool to manually poll for messages.

#### Mode 4: Channel Mode (Requires Channels feature)

If you have access to the Channels feature (research preview):

```bash
claude --dangerously-load-development-channels plugin:qq@github:wanghulab/claude-plugin-qq
```

> The `--dangerously-load-development-channels` flag is required during the [channels research preview](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview) for non-official plugins.

### Remote Commands

Send `/cmd <command>` from QQ to execute a command on the host machine:

```
You (on QQ): /cmd ls -la
Bot: ✅ 命令已接收，正在执行: ls -la
Bot: <command output>
```

**Dangerous commands are blocked:** `rm -rf`, `del`, `format`, `shutdown`, `reboot`, `drop table`, `truncate table`, `git push --force`, `git reset --hard`.

Commands are processed by a scheduled cron job that runs every minute.

### Pair your QQ account

1. Send a message to the bot on QQ — it replies with a pairing code
2. In Claude Code, run `/qq:access pair <code>` to approve

### Skills

| Skill | Description |
|---|---|
| `/qq:configure` | Setup NapCatQQ connection, check channel status |
| `/qq:access` | Manage pairing, allowlists, DM policy |

### How it works

The plugin runs a local MCP server that:
1. Listens for HTTP POST events from NapCatQQ (default port 6099, configurable)
2. Processes incoming private messages through access control
3. Stores approved messages in an in-memory queue (max 100)
4. Sends replies back through NapCatQQ's HTTP API
5. Provides HTTP endpoints for polling and command management

**HTTP Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/has-messages` | GET | Check if messages exist (does not drain queue) |
| `/messages` | GET | Fetch and drain message queue |
| `/pending-messages` | GET | List pending auto-reply messages |
| `/pending-messages/<file>` | DELETE | Delete a processed pending message |
| `/commands` | GET | List pending remote commands |
| `/commands/<file>` | DELETE | Delete a processed command |
| `/onebot/event` | POST | Receive OneBot 11 events from NapCatQQ |

No public URL or WebSocket needed — everything runs locally.

### Access Control

| Policy | Description |
|--------|-------------|
| `pairing` | Default. New users must pair with a code |
| `allowlist` | Only whitelisted QQ numbers can message |
| `disabled` | Disable all private messages |

#### Commands

```
/qq:access                    # Show status
/qq:access pair <code>        # Approve pairing
/qq:access deny <code>        # Deny pairing
/qq:access allow <qq_number>  # Add to whitelist
/qq:access remove <qq_number> # Remove from whitelist
/qq:access policy <mode>      # Set policy
```

### Architecture

```
NapCatQQ (:3000) ──HTTP POST events──► server.ts (:6199)
                ◄──HTTP API calls────
                      │
                      ├── MCP Server (stdio) ──► Claude Code
                      ├── auto-reply.ts ──► LLM API ──► Auto-reply (independent)
                      ├── Stop Hook (asyncRewake) ──► Wake Claude on new messages
                      ├── Cron Task (1min) ──► Fallback auto-reply
                      ├── Message Queue (in-memory, polling mode)
                      └── Remote Commands (/cmd prefix)
```

### Security

- HTTP server binds to `127.0.0.1` only
- Config files use mode `0o600`
- `assertSendable()` blocks sending channel state files
- `assertAllowedUser()` validates outbound recipients
- Dangerous command patterns are filtered

### Comparison with WeChat Plugin

| Feature | WeChat Plugin | QQ Plugin |
|---------|---------------|-----------|
| Protocol | iLink Bot API | OneBot 11 |
| Message receive | HTTP long-poll | HTTP POST event |
| Login | QR scan for token | NapCatQQ WebUI |
| Reply token | context_token required | Not needed |
| User ID | ilink_user_id | QQ number |
| Remote commands | No | Yes (/cmd prefix) |
| Auto-polling | No | Yes (Stop hook) |

---

<a name="中文"></a>

## 中文

[Claude Code](https://claude.com/claude-code) 的 QQ 频道插件 — 在终端中直接接收和回复 QQ 消息。

使用 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 基于 OneBot 11 协议。采用 HTTP 事件上报方式 — 无需 WebSocket 或公网 Webhook。

### 功能特性

- **自动消息轮询** — 通过 Stop Hook 自动检测并注入新消息到会话
- **远程命令执行** — 在 QQ 中发送 `/cmd <命令>` 远程执行主机命令
- **访问控制** — 配对模式、白名单模式或禁用
- **消息分块** — 长回复按段落/行/空格边界拆分
- **危险命令过滤** — 拦截 `rm -rf`、`drop table`、`git push --force` 等
- **MCP 工具** — `check_messages` 和 `reply` 提供手动控制

### 前置要求

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh) 运行时
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 已安装并运行

### 安装

```bash
# 1. 添加市场
claude plugin marketplace add wanghulab/claude-plugin-qq

# 2. 安装插件
claude plugin install qq@claude-channel-qq
```

### NapCatQQ 配置

使用本插件前，需要配置 NapCatQQ：

1. **下载并运行 NapCatQQ** - 从 [Releases](https://github.com/NapNeko/NapCatQQ/releases) 下载
2. **通过 WebUI 登录** - 通常在 http://localhost:6099
3. **启用 HTTP 服务** - 在 NapCatQQ 配置中：
   ```json
   {
     "http": {
       "enable": true,
       "host": "0.0.0.0",
       "port": 3000,
       "secret": ""
     }
   }
   ```
4. **启用 HTTP 事件上报**：
   ```json
   {
     "post": {
       "enable": true,
       "urls": [
         "http://127.0.0.1:6099/onebot/event"
       ]
     }
   }
   ```

### 配置插件

#### 设置连接

在 Claude Code 中运行：

```
/qq:configure setup http://localhost:3000
```

如果 NapCatQQ 配置了 access_token：

```
/qq:configure setup http://localhost:3000 你的_token
```

#### 自定义监听端口

```
/qq:configure port 6199
```

#### 查看状态

```
/qq:configure
```

#### 测试连接

```
/qq:configure test
```

### 使用模式

#### 模式 1：自动回复后台脚本（推荐）

独立后台脚本，通过 LLM API 自动回复 QQ 消息，无需 Claude Code 会话。

**1. 配置 LLM API** — 创建 `~/.claude/channels/qq/api.json`：

```json
{
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4/",
  "key": "your-api-key-here",
  "model": "glm-5.1"
}
```

支持任何 OpenAI 兼容 API（Anthropic、OpenAI、DeepSeek、GLM 等）。

**2. 启动脚本：**

```bash
cd <插件目录>
bun auto-reply.ts
```

脚本工作流程：
- 每 10 秒轮询 `/pending-messages` 端点
- 调用 LLM API 生成回复
- 通过 NapCatQQ HTTP API 发送回复
- 自动处理长消息分块

**3. 后台运行：**

```bash
nohup bun auto-reply.ts > /tmp/auto-reply.log 2>&1 &
```

#### 模式 2：Claude Code 会话（cron + Stop Hook）

当 Claude Code 会话处于活跃状态时，两个机制提供自动 QQ 消息处理：

- **Stop Hook (asyncRewake)：** 每次 Claude 回复后检查待处理消息，发现消息时自动唤醒 Claude 处理
- **Cron 定时任务（1分钟间隔）：** 会话空闲时的兜底检查，持久化配置，重启不丢失

> 注意：Cron 任务需要 Claude Code 处于运行状态。

#### 模式 3：手动轮询

使用 `check_messages` MCP 工具手动轮询消息。

#### 模式 4：频道模式（需要 Channels 功能）

如果你有 Channels 功能访问权限（研究预览）：

```bash
claude --dangerously-load-development-channels plugin:qq@github:wanghulab/claude-plugin-qq
```

### 远程命令

在 QQ 中发送 `/cmd <命令>` 来远程执行主机上的命令：

```
你 (在QQ): /cmd ls -la
机器人: ✅ 命令已接收，正在执行: ls -la
机器人: <命令输出>
```

**危险命令会被拦截：** `rm -rf`、`del`、`format`、`shutdown`、`reboot`、`drop table`、`truncate table`、`git push --force`、`git reset --hard`。

命令由定时任务（每分钟）处理。

### 配对 QQ 账号

1. 在 QQ 上给机器人发送消息 — 它会回复一个配对码
2. 在 Claude Code 中运行 `/qq:access pair <配对码>` 完成配对

### 技能列表

| 技能 | 说明 |
|---|---|
| `/qq:configure` | 设置 NapCatQQ 连接、检查频道状态 |
| `/qq:access` | 管理配对、白名单、私聊策略 |

### 工作原理

插件运行一个本地 MCP 服务器：
1. 监听来自 NapCatQQ 的 HTTP POST 事件（默认端口 6099，可配置）
2. 通过访问控制处理接收到的私聊消息
3. 将允许的消息存入内存队列（最多 100 条）
4. 通过 NapCatQQ 的 HTTP API 发送回复
5. 提供轮询和命令管理的 HTTP 端点

**HTTP 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/has-messages` | GET | 检查是否有消息（不清空队列） |
| `/messages` | GET | 获取并清空消息队列 |
| `/pending-messages` | GET | 列出待自动回复的消息 |
| `/pending-messages/<file>` | DELETE | 删除已处理的待回复消息 |
| `/commands` | GET | 列出待处理的远程命令 |
| `/commands/<file>` | DELETE | 删除已处理的命令 |
| `/onebot/event` | POST | 接收 NapCatQQ 的 OneBot 11 事件 |

无需公网地址或 WebSocket — 所有操作都在本地运行。

### 访问控制

| 策略 | 说明 |
|--------|-------------|
| `pairing` | 默认策略。新用户需要配对验证 |
| `allowlist` | 仅白名单中的 QQ 号可以发消息 |
| `disabled` | 禁用所有私聊消息 |

#### 命令

```
/qq:access                    # 查看状态
/qq:access pair <配对码>      # 批准配对
/qq:access deny <配对码>      # 拒绝配对
/qq:access allow <QQ号>       # 添加到白名单
/qq:access remove <QQ号>      # 从白名单移除
/qq:access policy <策略>      # 设置策略
```

### 架构图

```
NapCatQQ (:3000) ──HTTP POST 事件上报──► server.ts (:6199)
                ◄──HTTP API 调用────────
                      │
                      ├── MCP Server (stdio) ──► Claude Code
                      ├── auto-reply.ts ──► LLM API ──► 独立自动回复
                      ├── Stop Hook (asyncRewake) ──► 有新消息时唤醒 Claude
                      ├── Cron 定时任务 (1分钟) ──► 兜底自动回复
                      ├── 消息队列 (内存，轮询模式)
                      └── 远程命令 (/cmd 前缀)
```

### 安全

- HTTP 服务器仅绑定 `127.0.0.1`
- 配置文件权限为 `0o600`
- `assertSendable()` 阻止发送频道状态文件
- `assertAllowedUser()` 验证出站接收者
- 危险命令模式会被过滤

### 与微信插件对比

| 特性 | 微信插件 | QQ 插件 |
|------|---------|---------|
| 协议 | iLink Bot API | OneBot 11 |
| 消息接收 | HTTP 长轮询 | HTTP POST 事件上报 |
| 登录方式 | 扫码获取 token | NapCatQQ WebUI 扫码 |
| 回复凭证 | 需要 context_token | 不需要 |
| 用户 ID | ilink_user_id | QQ 号 |
| 远程命令 | 不支持 | 支持 (/cmd 前缀) |
| 自动轮询 | 不支持 | 支持 (Stop hook) |

### License

MIT
