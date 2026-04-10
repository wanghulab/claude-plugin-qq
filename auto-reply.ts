#!/usr/bin/env bun
/**
 * QQ Auto-Reply Background Script
 *
 * Continuously polls for pending QQ messages and replies using LLM API.
 * Runs independently of Claude Code session.
 *
 * Usage: bun auto-reply.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const POLL_INTERVAL = 10_000 // 10 seconds
const SERVER_URL = 'http://127.0.0.1:6199'
const NAPCAT_URL = 'http://localhost:3000'
const MAX_CHUNK = 2000

const STATE_DIR = join(homedir(), '.claude', 'channels', 'qq')

function loadJson(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

const config = loadJson(join(STATE_DIR, 'config.json'))
const apiConfig = loadJson(join(STATE_DIR, 'api.json'))

const MODEL = (apiConfig.model as string) || (config.model as string) || 'glm-5.1'
const API_BASE = (apiConfig.baseUrl as string) || 'https://open.bigmodel.cn/api/paas/v4/'
const API_KEY = apiConfig.key || process.env.LLM_API_KEY

if (!API_KEY) {
  process.stderr.write('auto-reply: API key not set. Create ~/.claude/channels/qq/api.json with { "baseUrl", "key", "model" }\n')
  process.exit(1)
}

// --- API helpers ---

async function getPendingMessages(): Promise<Array<{
  user_id: string
  content: string
  ts: string
  file: string
}>> {
  const res = await fetch(`${SERVER_URL}/pending-messages`)
  const data = (await res.json()) as { messages?: Array<unknown> }
  return (data.messages ?? []) as Array<{
    user_id: string
    content: string
    ts: string
    file: string
  }>
}

async function generateReply(userMessage: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0]
  const baseUrl = API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`

  const res = await fetch(`${baseUrl}chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: [
            '你是一个QQ聊天机器人助手。回复风格：简洁、有用、用中文。',
            '不要加emoji（除非用户消息里有emoji）。',
            '消息分段发送避免过长（每段不超过2000字）。',
            `当前日期：${today}。`,
            '如果用户问时效性问题（市场行情、新闻等），基于你的知识回答，适当说明信息时效性。',
          ].join('\n'),
        },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }

  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content
  }
  throw new Error(data.error?.message || 'LLM API error')
}

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = rest.lastIndexOf('\n', limit)
    const idx = cut > limit / 2 ? cut : limit
    chunks.push(rest.slice(0, idx))
    rest = rest.slice(idx).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function sendReply(userId: string, text: string): Promise<void> {
  const chunks = chunkText(text, MAX_CHUNK)
  for (const chunk of chunks) {
    const body = JSON.stringify({
      user_id: userId,
      message: [{ type: 'text', data: { text: chunk } }],
    })
    await fetch(`${NAPCAT_URL}/send_private_msg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    })
  }
}

async function deletePending(filename: string): Promise<void> {
  await fetch(`${SERVER_URL}/pending-messages/${filename}`, { method: 'DELETE' })
}

// --- Main loop ---

async function main(): Promise<void> {
  process.stderr.write(`auto-reply: started (model=${MODEL}, base=${API_BASE}, poll=${POLL_INTERVAL / 1000}s)\n`)

  while (true) {
    try {
      const messages = await getPendingMessages()

      for (const msg of messages) {
        process.stderr.write(`auto-reply: ${msg.user_id}: ${msg.content}\n`)

        const reply = await generateReply(msg.content)
        await sendReply(msg.user_id, reply)
        await deletePending(msg.file)

        process.stderr.write(`auto-reply: replied to ${msg.user_id}\n`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`auto-reply: error: ${msg}\n`)
    }

    await Bun.sleep(POLL_INTERVAL)
  }
}

main()
