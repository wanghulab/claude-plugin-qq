---
name: configure
description: Set up the QQ channel — configure NapCatQQ connection, check status. Use when the user asks to configure QQ, setup connection, or check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(bun *)
  - Bash(curl *)
---

# /qq:configure — QQ Channel Setup

Manages NapCatQQ connection configuration. Config lives in
`~/.claude/channels/qq/config.json`.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read config and give the user a complete picture:

1. **Config** — check `~/.claude/channels/qq/config.json` for
   `httpUrl`, `accessToken`, `listenPort`. Show set/not-set.

2. **Access** — read `~/.claude/channels/qq/access.json` (missing file
   = defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means
   - Allowed senders: count and list
   - Pending pairings: count with codes and sender IDs

3. **Connection test** — if config exists, try to call `get_login_info`
   API to verify connection.

4. **What next** — concrete next step based on state:
   - No config → *"Run `/qq:configure setup <httpUrl>` to connect to NapCatQQ."*
   - Config set, connection failed → *"Cannot connect to NapCatQQ. Check if NapCatQQ is running."*
   - Config set, nobody allowed → *"Send a message to the bot on QQ. It replies with a code; approve with `/qq:access pair <code>`."*
   - Config set, someone allowed → *"Ready. Message the bot on QQ to reach the assistant."*

### `setup <httpUrl> [accessToken]` — configure connection

1. Validate `<httpUrl>` is a valid URL (should be NapCatQQ HTTP API address).
2. Create config:
   ```json
   {
     "httpUrl": "<httpUrl>",
     "accessToken": "<accessToken or omit>",
     "listenPort": 6099
   }
   ```
3. Ensure `~/.claude/channels/qq/` directory exists with mode 0o700.
4. Write config file with mode 0o600.
5. Test connection by calling `get_login_info` API.
6. On success, tell user:
   - *"✅ NapCatQQ 连接成功！"*
   - Show bot QQ info (nickname, user_id)
   - *"请在 NapCatQQ 中配置 HTTP 事件上报地址：http://127.0.0.1:6099/onebot/event"*
   - *"重启 Claude Code 会话以启用 QQ 频道"*

### `test` — test connection

1. Read config file.
2. Call `get_login_info` API.
3. Show result: bot nickname, user_id, or error message.

### `port <port>` — set listen port

1. Read config file.
2. Update `listenPort` to the new port.
3. Write back.
4. Remind user to update NapCatQQ event post URL.

### `clear` — remove config

Delete `~/.claude/channels/qq/config.json`.

---

## NapCatQQ API calls

### Test connection: get_login_info

```bash
curl -X POST "${httpUrl}/get_login_info" \
  -H "Content-Type: application/json" \
  ${accessToken:+-H "Authorization: Bearer ${accessToken}"} \
  -d '{}'
```

Response on success:
```json
{
  "status": "ok",
  "retcode": 0,
  "data": {
    "user_id": 12345678,
    "nickname": "Bot Name"
  }
}
```

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads config.json once at boot. Config changes need a
  session restart. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes via
  `/qq:access` take effect immediately, no restart.
- Default HTTP URL is `http://localhost:3000`.
- Default listen port is `6099`.
- NapCatQQ must be configured to POST events to the listen port.
