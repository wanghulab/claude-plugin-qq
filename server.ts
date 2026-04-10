#!/usr/bin/env bun
/**
 * QQ channel for Claude Code.
 *
 * Self-contained MCP server with HTTP event receiver and full access control.
 * State lives in ~/.claude/channels/qq/ — managed by the /qq:access
 * and /qq:configure skills.
 *
 * Uses NapCatQQ OneBot 11 API with HTTP event post — no WebSocket needed.
 *
 * Supports two modes:
 * 1. Channel mode (requires --dangerously-load-development-channels): Real-time push
 * 2. Polling mode (default): Use check_messages tool to poll for new messages
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { randomBytes } from 'crypto'
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync,
  statSync, renameSync, realpathSync,
} from 'fs'
import { homedir } from 'os'
import { join, sep } from 'path'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'qq')
const CONFIG_FILE = join(STATE_DIR, 'config.json')
const ACCESS_FILE = join(STATE_DIR, 'access.json')
const APPROVED_DIR = join(STATE_DIR, 'approved')
const PENDING_CMDS_DIR = join(STATE_DIR, 'pending-cmds')
const PENDING_MSGS_DIR = join(STATE_DIR, 'pending-msgs')

// Dangerous command patterns - these will be blocked
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel(ete)?\s+/i,
  /\bformat\s+/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /:\s*\/dev\/null/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
]

// --- Types ---

type Config = {
  httpUrl: string
  accessToken?: string
  listenPort: number
  autoReply?: boolean
  model?: string
}

type PendingEntry = {
  senderId: string
  createdAt: number
  expiresAt: number
  replies: number
}

type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  pending: Record<string, PendingEntry>
  ackText?: string
  textChunkLimit?: number
}

type QueuedMessage = {
  user_id: string
  content: string
  ts: string
}

// --- Load config ---

function loadConfig(): Config | null {
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      httpUrl: parsed.httpUrl || 'http://localhost:3000',
      accessToken: parsed.accessToken,
      listenPort: parsed.listenPort || 6099,
      autoReply: parsed.autoReply ?? true,
      model: parsed.model || 'haiku',
    }
  } catch {
    return null
  }
}

const config = loadConfig()

if (!config?.httpUrl) {
  process.stderr.write(
    `qq channel: config required\n` +
    `  run /qq:configure in Claude Code to setup NapCatQQ connection\n`,
  )
  process.exit(1)
}

const HTTP_URL = config.httpUrl.endsWith('/') ? config.httpUrl : `${config.httpUrl}/`
const ACCESS_TOKEN = config.accessToken
const LISTEN_PORT = config.listenPort || 6099

// Runtime set of allowed user_ids for outbound validation.
const knownUsers = new Set<string>()

const MAX_CHUNK_LIMIT = 2000

// Message queue for polling mode
const messageQueue: QueuedMessage[] = []
const MAX_QUEUE_SIZE = 100

function defaultAccess(): Access {
  return { dmPolicy: 'pairing', allowFrom: [], pending: {} }
}

// --- API helpers ---

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`
  }
  return headers
}

async function apiFetch(endpoint: string, body: object, timeoutMs = 15000): Promise<any> {
  const url = new URL(endpoint, HTTP_URL)
  const bodyStr = JSON.stringify(body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { ...buildHeaders(), 'Content-Length': String(Buffer.byteLength(bodyStr, 'utf-8')) },
      body: bodyStr,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = await res.text()
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text}`)
    return JSON.parse(text)
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function sendPrivateMsg(userId: string, message: string): Promise<void> {
  const segments = chunk(message, MAX_CHUNK_LIMIT).map(text => ({
    type: 'text' as const,
    data: { text },
  }))
  await apiFetch('send_private_msg', {
    user_id: userId,
    message: segments,
  })
}

// --- Security ---

function assertSendable(f: string): void {
  let real: string, stateReal: string
  try {
    real = realpathSync(f)
    stateReal = realpathSync(STATE_DIR)
  } catch { return }
  if (real.startsWith(stateReal + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

function assertAllowedUser(userId: string): void {
  if (knownUsers.has(userId)) return
  const access = loadAccess()
  if (access.allowFrom.includes(userId)) return
  throw new Error(`user ${userId} is not allowlisted — add via /qq:access`)
}

// Check if command contains dangerous operations
function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command))
}

// Write command to pending directory for processing
function writePendingCommand(senderId: string, command: string): string {
  mkdirSync(PENDING_CMDS_DIR, { recursive: true, mode: 0o700 })
  const filename = `${Date.now()}_${senderId}.json`
  const filepath = join(PENDING_CMDS_DIR, filename)
  writeFileSync(
    filepath,
    JSON.stringify({
      user_id: senderId,
      command,
      ts: new Date().toISOString(),
    }, null, 2),
    { mode: 0o600 }
  )
  return filepath
}

// Write message to pending directory for auto-reply processing
function writePendingMessage(senderId: string, content: string, ts: string): string {
  mkdirSync(PENDING_MSGS_DIR, { recursive: true, mode: 0o700 })
  const filename = `${Date.now()}_${senderId}.json`
  const filepath = join(PENDING_MSGS_DIR, filename)
  writeFileSync(
    filepath,
    JSON.stringify({
      user_id: senderId,
      content,
      ts,
    }, null, 2),
    { mode: 0o600 }
  )
  return filepath
}

// --- Access persistence ---

function readAccessFile(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Access>
    return {
      dmPolicy: parsed.dmPolicy ?? 'pairing',
      allowFrom: parsed.allowFrom ?? [],
      pending: parsed.pending ?? {},
      ackText: parsed.ackText,
      textChunkLimit: parsed.textChunkLimit,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAccess()
    try {
      renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`)
    } catch {}
    process.stderr.write(`qq channel: access.json is corrupt, moved aside. Starting fresh.\n`)
    return defaultAccess()
  }
}

function loadAccess(): Access {
  return readAccessFile()
}

function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, ACCESS_FILE)
}

function pruneExpired(a: Access): boolean {
  const now = Date.now()
  let changed = false
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) {
      delete a.pending[code]
      changed = true
    }
  }
  return changed
}

// --- Gate ---

type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop' }
  | { action: 'pair'; code: string; isResend: boolean }

function gate(senderId: string): GateResult {
  const access = loadAccess()
  const pruned = pruneExpired(access)
  if (pruned) saveAccess(access)

  if (!senderId) return { action: 'drop' }

  if (access.dmPolicy === 'disabled') return { action: 'drop' }
  if (access.allowFrom.includes(senderId)) return { action: 'deliver', access }
  if (access.dmPolicy === 'allowlist') return { action: 'drop' }

  // pairing mode
  for (const [code, p] of Object.entries(access.pending)) {
    if (p.senderId === senderId) {
      if ((p.replies ?? 1) >= 2) return { action: 'drop' }
      p.replies = (p.replies ?? 1) + 1
      saveAccess(access)
      return { action: 'pair', code, isResend: true }
    }
  }
  if (Object.keys(access.pending).length >= 3) return { action: 'drop' }

  const code = randomBytes(3).toString('hex')
  const now = Date.now()
  access.pending[code] = {
    senderId,
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
    replies: 1,
  }
  saveAccess(access)
  return { action: 'pair', code, isResend: false }
}

// --- Pairing approval polling ---

function checkApprovals(): void {
  let files: string[]
  try {
    files = readdirSync(APPROVED_DIR)
  } catch { return }
  if (files.length === 0) return

  for (const senderId of files) {
    const file = join(APPROVED_DIR, senderId)
    rmSync(file, { force: true })
  }
}

setInterval(checkApprovals, 5000)

// --- Chunking ---

function chunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    const para = rest.lastIndexOf('\n\n', limit)
    const line = rest.lastIndexOf('\n', limit)
    const space = rest.lastIndexOf(' ', limit)
    const cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}

// --- Extract text from message ---

function extractText(msg: any): string {
  if (typeof msg.message === 'string') return msg.message
  if (Array.isArray(msg.message)) {
    const parts: string[] = []
    for (const seg of msg.message) {
      if (seg.type === 'text' && seg.data?.text) {
        parts.push(seg.data.text)
      } else if (seg.type === 'image') {
        parts.push('[图片]')
      } else if (seg.type === 'record') {
        parts.push('[语音]')
      } else if (seg.type === 'video') {
        parts.push('[视频]')
      } else if (seg.type === 'file') {
        parts.push(`[文件: ${seg.data?.file || 'unknown'}]`)
      } else if (seg.type === 'at') {
        parts.push(`[@${seg.data?.qq || 'user'}]`)
      } else if (seg.type === 'face') {
        parts.push('[表情]')
      } else if (seg.type === 'reply') {
        parts.push('[回复]')
      }
    }
    return parts.join('') || '(empty message)'
  }
  return '(empty message)'
}

// --- MCP Server ---

const mcp = new Server(
  { name: 'qq', version: '0.2.0' },
  {
    capabilities: { tools: {} },
    instructions: [
      'QQ Channel Plugin - Hook-Driven Polling Mode',
      '',
      'This plugin allows you to receive and reply to QQ messages.',
      '',
      '## How Messages Arrive',
      '',
      'A Stop hook automatically checks for new QQ messages after each response.',
      'When messages are waiting, the hook injects them into context and keeps',
      'the session running. You will see a "New QQ messages" prompt appear.',
      '',
      '## How to Respond',
      '',
      '1. When you receive QQ messages, use the `reply` tool to respond',
      '2. Pass the user_id from the message and your response text',
      '',
      '## Available Tools',
      '',
      '- `check_messages`: Manually poll for messages (rarely needed, hook handles this)',
      '- `reply`: Send a message to a QQ user (requires user_id + text)',
      '',
      '## Important Notes',
      '',
      '- Always respond to QQ messages when they arrive',
      '- Use the reply tool, do not just acknowledge messages verbally',
      '- Multiple messages may arrive at once from different users',
      '- Respond to each user individually',
      '- Access is managed by the /qq:access skill — the user runs it in their terminal.',
    ].join('\n'),
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'check_messages',
      description:
        'Check for new QQ messages and clear the queue. Normally called automatically by the Stop hook. Only use manually if you suspect messages were missed.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'reply',
      description:
        'Reply on QQ. Pass user_id from the inbound message.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The user_id (QQ号) from the inbound message.' },
          text: { type: 'string' },
        },
        required: ['user_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'check_messages': {
        // Return and clear the message queue
        const messages = [...messageQueue]
        messageQueue.length = 0 // Clear the queue

        if (messages.length === 0) {
          return { content: [{ type: 'text', text: 'No new messages.' }] }
        }

        const formatted = messages.map(m =>
          `[${m.ts}] QQ用户 ${m.user_id}:\n${m.content}`
        ).join('\n\n---\n\n')

        return { content: [{ type: 'text', text: `${messages.length} new message(s):\n\n${formatted}` }] }
      }

      case 'reply': {
        const userId = args.user_id as string
        const text = args.text as string

        assertAllowedUser(userId)

        await sendPrivateMsg(userId, text)

        return { content: [{ type: 'text', text: 'sent' }] }
      }

      default:
        return {
          content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
          isError: true,
        }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }],
      isError: true,
    }
  }
})

// --- Connect MCP transport ---

await mcp.connect(new StdioServerTransport())

// --- HTTP Event Server ---

async function handleInbound(event: any): Promise<void> {
  // Only handle private messages
  if (event.post_type !== 'message') return
  if (event.message_type !== 'private') return

  const senderId = String(event.user_id)
  if (!senderId) return

  const result = gate(senderId)

  if (result.action === 'drop') return

  if (result.action === 'pair') {
    const lead = result.isResend ? '仍在等待配对' : '需要配对验证'
    await sendPrivateMsg(
      senderId,
      `${lead} — 在 Claude Code 终端运行：\n\n/qq:access pair ${result.code}`,
    ).catch((err: any) => {
      process.stderr.write(`qq channel: pairing reply failed: ${err}\n`)
    })
    return
  }

  // Message approved - check for command prefix
  knownUsers.add(senderId)

  const text = extractText(event)
  const ts = event.time
    ? new Date(event.time * 1000).toISOString()
    : new Date().toISOString()

  // Check for /cmd prefix
  if (text.startsWith('/cmd ')) {
    const command = text.slice(5).trim()
    if (command) {
      // Check for dangerous operations
      if (isDangerous(command)) {
        await sendPrivateMsg(senderId, '⚠️ 命令被拒绝：包含危险操作（删除、格式化等）')
        process.stderr.write(`qq channel: blocked dangerous command from ${senderId}: ${command}\n`)
        return
      }

      // Write command to pending directory
      try {
        writePendingCommand(senderId, command)
        await sendPrivateMsg(senderId, `✅ 命令已接收，正在执行: ${command}`)
        process.stderr.write(`qq channel: command from ${senderId}: ${command}\n`)
      } catch (err) {
        await sendPrivateMsg(senderId, `❌ 命令保存失败: ${err}`)
        process.stderr.write(`qq channel: failed to save command from ${senderId}: ${err}\n`)
      }
      return
    }
  }

  // Route message based on autoReply config
  if (config!.autoReply) {
    // Write to file for scheduled task auto-reply
    try {
      writePendingMessage(senderId, text, ts)
      process.stderr.write(`qq channel: pending message from ${senderId} (auto-reply)\n`)
    } catch (err) {
      // Fallback to queue if file write fails
      messageQueue.push({ user_id: senderId, content: text, ts })
      process.stderr.write(`qq channel: file write failed, queued message from ${senderId}: ${err}\n`)
    }
  } else {
    // Add to in-memory queue for Stop hook polling
    messageQueue.push({
      user_id: senderId,
      content: text,
      ts,
    })

    // Keep queue size bounded
    while (messageQueue.length > MAX_QUEUE_SIZE) {
      messageQueue.shift()
    }

    process.stderr.write(`qq channel: queued message from ${senderId}\n`)
  }
}

// Start HTTP server for events
const httpServer = Bun.serve({
  port: LISTEN_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Lightweight check if messages exist (does NOT drain queue)
    if (url.pathname === '/has-messages' && req.method === 'GET') {
      return new Response(JSON.stringify({
        has_messages: messageQueue.length > 0,
        count: messageQueue.length,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get and clear message queue (for polling)
    if (url.pathname === '/messages' && req.method === 'GET') {
      const messages = [...messageQueue]
      messageQueue.length = 0
      return new Response(JSON.stringify({ messages }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get pending commands (for Claude Code to process)
    if (url.pathname === '/commands' && req.method === 'GET') {
      try {
        const files = readdirSync(PENDING_CMDS_DIR)
        const commands: Array<{ user_id: string; command: string; ts: string; file: string }> = []
        for (const f of files) {
          if (!f.endsWith('.json')) continue
          try {
            const content = readFileSync(join(PENDING_CMDS_DIR, f), 'utf8')
            commands.push({ ...JSON.parse(content), file: f })
          } catch {}
        }
        return new Response(JSON.stringify({ commands }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      } catch {
        return new Response(JSON.stringify({ commands: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Delete a processed command
    if (url.pathname.startsWith('/commands/') && req.method === 'DELETE') {
      const filename = url.pathname.slice('/commands/'.length)
      if (!filename.endsWith('.json')) {
        return new Response(JSON.stringify({ error: 'Invalid file' }), { status: 400 })
      }
      try {
        rmSync(join(PENDING_CMDS_DIR, filename), { force: true })
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
      }
    }

    // Get pending messages (for auto-reply processing)
    if (url.pathname === '/pending-messages' && req.method === 'GET') {
      try {
        const files = readdirSync(PENDING_MSGS_DIR)
        const messages: Array<{ user_id: string; content: string; ts: string; file: string }> = []
        for (const f of files) {
          if (!f.endsWith('.json')) continue
          try {
            const content = readFileSync(join(PENDING_MSGS_DIR, f), 'utf8')
            messages.push({ ...JSON.parse(content), file: f })
          } catch {}
        }
        return new Response(JSON.stringify({ messages }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      } catch {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Delete a processed message
    if (url.pathname.startsWith('/pending-messages/') && req.method === 'DELETE') {
      const filename = url.pathname.slice('/pending-messages/'.length)
      if (!filename.endsWith('.json')) {
        return new Response(JSON.stringify({ error: 'Invalid file' }), { status: 400 })
      }
      try {
        rmSync(join(PENDING_MSGS_DIR, filename), { force: true })
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
      }
    }

    // OneBot event endpoint
    if (url.pathname === '/onebot/event' && req.method === 'POST') {
      try {
        const event = await req.json()
        handleInbound(event).catch((err) => {
          process.stderr.write(`qq channel: event handler error: ${err}\n`)
        })
        // OneBot 11 requires JSON response for quick operations
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Bad Request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
})

process.stderr.write(`qq channel: HTTP event server started on http://127.0.0.1:${LISTEN_PORT}\n`)
process.stderr.write(`qq channel: NapCatQQ API at ${HTTP_URL}\n`)

// Keep process alive
process.stdin.resume()
