#!/usr/bin/env node

/**
 * Stop Hook: QQ Message Poll
 *
 * Runs after each Claude Code response. Checks if there are pending QQ
 * messages and, if so, blocks the stop to inject messages into context.
 *
 * Loop prevention: When Claude Code re-invokes after a block, it sets
 * stop_hook_active = true in the stdin payload. We detect this and
 * exit cleanly to prevent an infinite loop.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = path.join(os.homedir(), '.claude', 'channels', 'qq', 'config.json');

function loadPort() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(raw);
    return config.listenPort || 6099;
  } catch {
    return 6099;
  }
}

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON from server'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

const MAX_STDIN = 1024 * 1024;
let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) {
    stdinData += chunk.substring(0, MAX_STDIN - stdinData.length);
  }
});

process.stdin.on('end', () => {
  run().catch(() => {
    process.stdout.write(stdinData || '{}');
    process.exit(0);
  });
});

async function run() {
  let input = {};
  try {
    input = JSON.parse(stdinData);
  } catch {
    process.stdout.write(stdinData || '{}');
    return;
  }

  // CRITICAL: Loop guard
  // Claude Code sets stop_hook_active = true when this stop is the result
  // of a previous hook block. If we don't check this, we'll loop forever.
  if (input.stop_hook_active === true) {
    process.stdout.write(JSON.stringify(input));
    return;
  }

  const port = loadPort();

  // Step 1: Lightweight check (does NOT drain queue)
  let check;
  try {
    check = await httpGet(`http://127.0.0.1:${port}/has-messages`);
  } catch {
    process.stdout.write(JSON.stringify(input));
    return;
  }

  if (!check.has_messages) {
    process.stdout.write(JSON.stringify(input));
    return;
  }

  // Step 2: Fetch actual messages (drains the queue)
  let result;
  try {
    result = await httpGet(`http://127.0.0.1:${port}/messages`);
  } catch {
    process.stdout.write(JSON.stringify(input));
    return;
  }

  const messages = result.messages || [];
  if (messages.length === 0) {
    process.stdout.write(JSON.stringify(input));
    return;
  }

  // Step 3: Format messages and block
  const formatted = messages.map(m =>
    `[${m.ts}] QQ用户 ${m.user_id}:\n${m.content}`
  ).join('\n\n---\n\n');

  const blockOutput = {
    decision: 'block',
    reason: `New QQ message(s) received (${messages.length}). ` +
            `Please read each message and use the 'reply' tool to respond.\n\n${formatted}`,
  };

  process.stdout.write(JSON.stringify(blockOutput));
}
