# claude-channel-qq

QQ channel plugin for [Claude Code](https://claude.com/claude-code) — receive and reply to QQ messages directly in your terminal.

Uses [NapCatQQ](https://github.com/NapNeko/NapCatQQ) with OneBot 11 protocol. HTTP event post — no WebSocket or public webhook needed.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) v2.1.80+
- [Bun](https://bun.sh) runtime
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) installed and running

## Install

```bash
# Add the marketplace (one-time)
claude plugin marketplace add <your-marketplace>

# Install the plugin
claude plugin install qq@<marketplace-name>
```

## NapCatQQ Configuration

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

## Configure

### Setup connection

In Claude Code, run:

```
/qq:configure setup http://localhost:3000
```

If NapCatQQ has access_token configured:

```
/qq:configure setup http://localhost:3000 your_token_here
```

### Check status

```
/qq:configure
```

### Test connection

```
/qq:configure test
```

## Start with channels

```bash
claude --dangerously-load-development-channels plugin:qq@<marketplace-name>
```

> The `--dangerously-load-development-channels` flag is required during the [channels research preview](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview) for non-official plugins.

## Pair your QQ account

1. Send a message to the bot on QQ — it replies with a pairing code
2. In Claude Code, run `/qq:access pair <code>` to approve

## Skills

| Skill | Description |
|---|---|
| `/qq:configure` | Setup NapCatQQ connection, check channel status |
| `/qq:access` | Manage pairing, allowlists, DM policy |

## How it works

The plugin runs a local MCP server that:
1. Listens for HTTP POST events from NapCatQQ (port 6099)
2. Processes incoming private messages
3. Forwards allowed messages to your Claude Code session
4. Sends replies back through NapCatQQ's HTTP API

No public URL or WebSocket needed — everything runs locally.

## Access Control

| Policy | Description |
|--------|-------------|
| `pairing` | Default. New users must pair with a code |
| `allowlist` | Only whitelisted QQ numbers can message |
| `disabled` | Disable all private messages |

### Commands

```
/qq:access                    # Show status
/qq:access pair <code>        # Approve pairing
/qq:access deny <code>        # Deny pairing
/qq:access allow <qq_number>  # Add to whitelist
/qq:access remove <qq_number> # Remove from whitelist
/qq:access policy <mode>      # Set policy
```

## Comparison with WeChat Plugin

| Feature | WeChat Plugin | QQ Plugin |
|---------|---------------|-----------|
| Protocol | iLink Bot API | OneBot 11 |
| Message receive | HTTP long-poll | HTTP POST event |
| Login | QR scan for token | NapCatQQ WebUI |
| Reply token | context_token required | Not needed |
| User ID | ilink_user_id | QQ number |

## License

MIT
