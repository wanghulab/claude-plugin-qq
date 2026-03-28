# claude-channel-qq

[English](#english) | [中文](#中文)

---

<a name="english"></a>

## English

QQ channel plugin for [Claude Code](https://claude.com/claude-code) — receive and reply to QQ messages directly in your terminal.

Uses [NapCatQQ](https://github.com/NapNeko/NapCatQQ) with OneBot 11 protocol. HTTP event post — no WebSocket or public webhook needed.

### Prerequisites

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh) runtime
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) installed and running

### Install

```bash
# Add the marketplace (one-time)
claude plugin marketplace add claude-channel-qq

# Install the plugin
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

#### Check status

```
/qq:configure
```

#### Test connection

```
/qq:configure test
```

### Start with channels

```bash
claude --dangerously-load-development-channels plugin:qq@claude-channel-qq
```

> The `--dangerously-load-development-channels` flag is required during the [channels research preview](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview) for non-official plugins.

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
1. Listens for HTTP POST events from NapCatQQ (port 6099)
2. Processes incoming private messages
3. Forwards allowed messages to your Claude Code session
4. Sends replies back through NapCatQQ's HTTP API

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

### Comparison with WeChat Plugin

| Feature | WeChat Plugin | QQ Plugin |
|---------|---------------|-----------|
| Protocol | iLink Bot API | OneBot 11 |
| Message receive | HTTP long-poll | HTTP POST event |
| Login | QR scan for token | NapCatQQ WebUI |
| Reply token | context_token required | Not needed |
| User ID | ilink_user_id | QQ number |

---

<a name="中文"></a>

## 中文

[Claude Code](https://claude.com/claude-code) 的 QQ 频道插件 — 在终端中直接接收和回复 QQ 消息。

使用 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 基于 OneBot 11 协议。采用 HTTP 事件上报方式 — 无需 WebSocket 或公网 Webhook。

### 前置要求

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh) 运行时
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 已安装并运行

### 安装

```bash
# 添加插件市场（首次使用）
claude plugin marketplace add claude-channel-qq

# 安装插件
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

#### 查看状态

```
/qq:configure
```

#### 测试连接

```
/qq:configure test
```

### 启用频道

```bash
claude --dangerously-load-development-channels plugin:qq@claude-channel-qq
```

> `--dangerously-load-development-channels` 参数在[频道研究预览期](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview)是必需的。

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
1. 监听来自 NapCatQQ 的 HTTP POST 事件（端口 6099）
2. 处理接收到的私聊消息
3. 将允许的消息转发到 Claude Code 会话
4. 通过 NapCatQQ 的 HTTP API 发送回复

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

### 与微信插件对比

| 特性 | 微信插件 | QQ 插件 |
|------|---------|---------|
| 协议 | iLink Bot API | OneBot 11 |
| 消息接收 | HTTP 长轮询 | HTTP POST 事件上报 |
| 登录方式 | 扫码获取 token | NapCatQQ WebUI 扫码 |
| 回复凭证 | 需要 context_token | 不需要 |
| 用户 ID | ilink_user_id | QQ 号 |

### License

MIT
