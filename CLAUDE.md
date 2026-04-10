# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QQ channel plugin for Claude Code — enables receiving and replying to QQ messages via NapCatQQ (OneBot 11 protocol). Uses HTTP event post for incoming messages, no WebSocket required.

## Development Commands

```bash
# Run the server
bun start
# or
bun server.ts
```

## Architecture

Single-file MCP server (`server.ts`) that combines:
- **MCP Server** — StdioServerTransport for Claude Code communication
- **HTTP Event Server** — Bun.serve on port 6099 for NapCatQQ event callbacks

```
NapCatQQ (:3000) ──HTTP POST events──► server.ts (:6099)
                ◄──HTTP API calls──
```

## State Storage

All state lives in `~/.claude/channels/qq/`:
- `config.json` — NapCatQQ connection (httpUrl, accessToken, listenPort)
- `access.json` — Access control (dmPolicy, allowFrom, pending pairings)
- `approved/` — Directory-based approval signaling to running server

## Key Patterns

**Access Control Flow:**
1. Incoming message → `gate(senderId)` checks access.json
2. Not allowed → generate pairing code, reply with instructions
3. User runs `/qq:access pair <code>` in terminal
4. Skill creates file in `approved/` directory
5. Server polls and detects approval (every 5s)

**Message Chunking:**
Long messages split at paragraph/line/space boundaries (default 2000 chars).

**Security:**
- HTTP server binds to 127.0.0.1 only
- Config files use mode 0o600
- `assertSendable()` blocks sending channel state files
- `assertAllowedUser()` validates outbound recipients

## Skills

- `/qq:configure` — Setup NapCatQQ connection, test connectivity
- `/qq:access` — Manage pairings, allowlists, DM policy

## OneBot 11 API

Used endpoints:
- `POST /send_private_msg` — Send message to user
- `POST /get_login_info` — Test connection (used by /qq:configure test)
