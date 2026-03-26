# Claude Plugin QQ - 设计文档

> 创建日期: 2026-03-26

## 概述

Claude Plugin QQ 是一个让 Claude Code 能通过手机 QQ 远程控制的插件，基于 NapCatQQ 框架实现。

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| QQ 协议端 | NapCatQQ | 活跃维护，支持 OneBot 11 标准 |
| 连接方式 | HTTP 事件上报 | 架构简单，与微信插件一致 |
| 运行时 | Bun | 与微信插件保持一致 |
| 协议 | OneBot 11 | 标准化接口，生态丰富 |

## 架构设计

```
┌─────────────────┐    HTTP POST 事件上报     ┌─────────────────┐
│   NapCatQQ      │ ───────────────────────► │   QQ 插件        │
│  (协议端)        │                          │  (MCP Server)    │
│   :3000         │ ◄─────────────────────── │   :6099         │
│                 │     HTTP API 调用         │                 │
└─────────────────┘                          └─────────────────┘
```

## 项目结构

```
claude-plugin-qq/
├── .claude-plugin/
│   └── plugin.json          # 插件元信息
├── skills/
│   ├── configure/
│   │   └── SKILL.md         # /qq:configure - 配置连接
│   └── access/
│       └── SKILL.md         # /qq:access - 访问控制
├── server.ts                # MCP 服务器 + HTTP 事件服务器
├── package.json
├── .mcp.json
├── .gitignore
└── README.md
```

## 状态存储

路径: `~/.claude/channels/qq/`

### config.json - 连接配置

```json
{
  "httpUrl": "http://localhost:3000",
  "accessToken": "可选的access_token",
  "listenPort": 6099
}
```

### access.json - 访问控制

```json
{
  "dmPolicy": "pairing",
  "allowFrom": ["123456789"],
  "pending": {
    "abc123": {
      "senderId": "987654321",
      "createdAt": 1711478400000,
      "expiresAt": 1711482000000,
      "replies": 1
    }
  },
  "ackText": "收到",
  "textChunkLimit": 2000
}
```

## 核心流程

### 1. 启动流程

```
server.ts 启动
    │
    ├── 读取 ~/.claude/channels/qq/config.json
    │   └── 若不存在，提示运行 /qq:configure
    │
    ├── 启动 HTTP 服务器监听事件 (端口 6099)
    │
    └── 连接 MCP StdioTransport
```

### 2. 消息接收流程

```
NapCatQQ 发送 HTTP POST 到 /onebot/event
    │
    ├── 解析事件类型
    │   └── 仅处理 private_message 类型
    │
    ├── 访问控制 gate(userId)
    │   ├── drop → 忽略
    │   ├── pair → 返回配对码
    │   └── deliver → 继续
    │
    └── 发送 MCP 通知到 Claude Code
        └── notifications/claude/channel
```

### 3. 消息发送流程

```
Claude 调用 reply tool
    │
    ├── 验证用户白名单
    │
    ├── 文本分块 (超过限制时)
    │
    └── POST 到 NapCatQQ API
        └── /send_private_msg
```

## OneBot 11 API 使用

### 发送私聊消息

```http
POST http://localhost:3000/send_private_msg
Content-Type: application/json
Authorization: Bearer {access_token}

{
  "user_id": "123456789",
  "message": "回复内容"
}
```

### 接收事件格式

```json
{
  "time": 1711478400,
  "self_id": 12345678,
  "post_type": "message",
  "message_type": "private",
  "sub_type": "friend",
  "user_id": 987654321,
  "message_id": "xxx",
  "message": "用户消息内容",
  "raw_message": "用户消息内容",
  "font": 0,
  "sender": {
    "user_id": 987654321,
    "nickname": "发送者昵称",
    "sex": "unknown",
    "age": 0
  }
}
```

## 访问控制

### 策略模式

| 模式 | 说明 |
|------|------|
| `pairing` | 默认模式，新用户需配对验证 |
| `allowlist` | 仅白名单用户可访问 |
| `disabled` | 禁用所有私聊 |

### 配对流程

```
1. 用户发送消息给机器人
2. 检查用户是否在白名单
3. 不在白名单 → 生成 6 位配对码
4. 机器人回复配对码和使用说明
5. 用户在终端运行 /qq:access pair <code>
6. 用户加入白名单，后续消息正常处理
```

## 技能设计

### /qq:configure - 配置连接

| 命令 | 功能 |
|------|------|
| 无参数 | 显示当前配置状态 |
| `setup <httpUrl> [accessToken]` | 配置 NapCatQQ 连接 |
| `test` | 测试连接是否正常 |
| `port <port>` | 设置事件监听端口 |
| `clear` | 清除配置 |

### /qq:access - 访问控制

| 命令 | 功能 |
|------|------|
| 无参数 | 显示当前访问控制状态 |
| `pair <code>` | 批准配对 |
| `deny <code>` | 拒绝配对 |
| `allow <qq号>` | 直接添加白名单 |
| `remove <qq号>` | 移除白名单 |
| `policy <mode>` | 设置策略 (pairing/allowlist/disabled) |
| `set <key> <value>` | 设置配置 (ackText/textChunkLimit) |

## 与微信插件对比

| 对比项 | 微信插件 | QQ 插件 |
|--------|---------|---------|
| 协议端 | 微信 iLink Bot | NapCatQQ |
| 消息接收 | HTTP 长轮询 | HTTP POST 事件上报 |
| 登录方式 | 扫码获取 token | NapCatQQ WebUI 扫码 |
| 回复凭证 | 需要 context_token | 不需要 |
| 用户 ID | ilink_user_id | QQ 号 (user_id) |
| 发送 API | ilink/bot/sendmessage | send_private_msg |

## 安全考虑

1. **本地监听**: HTTP 服务器仅监听 localhost，不接受外部连接
2. **访问控制**: 默认启用配对验证，防止未授权访问
3. **敏感文件**: config.json 和 access.json 权限设为 0600
4. **命令注入防护**: 拒绝处理文件路径相关的请求

## 前置要求

1. **NapCatQQ** 需要先安装并运行
2. **Bun** 运行时
3. **Claude Code** v2.1.80+

## NapCatQQ 配置要求

在 NapCatQQ 的配置中需要启用：

```json
{
  "http": {
    "enable": true,
    "host": "0.0.0.0",
    "port": 3000,
    "secret": "your_access_token"
  },
  "post": {
    "enable": true,
    "urls": [
      "http://127.0.0.1:6099/onebot/event"
    ]
  }
}
```

## 后续扩展

基础版完成后可扩展：
- 群聊支持
- 图片/文件处理
- 消息撤回
- @提及处理
