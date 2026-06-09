#!/usr/bin/env node
// Local OpenAI-compatible shim -> openclaw `infer model run` (ChatGPT Pro OAuth,
// Codex backend). Lets Resona run with $0 LLM cost while this PC + openclaw are
// up. NOT for production: serial, PC-bound, rides a personal subscription.
//
//   POST /v1/chat/completions  ->  node openclaw.mjs infer model run --json
//
// Start: node scripts/openclaw-llm-shim.mjs        (listens on 127.0.0.1:8788)
// Point Resona at it: OPENAI_BASE_URL=http://127.0.0.1:8788/v1

import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.SHIM_PORT) || 8788;
const OPENCLAW_MJS = process.env.OPENCLAW_MJS
  || 'C:/Users/skf_s/AppData/Roaming/npm/node_modules/openclaw/openclaw.mjs';
const MODEL = process.env.SHIM_MODEL || 'openai-codex/gpt-5.5';
const THINKING = process.env.SHIM_THINKING || 'low';

// openclaw infer model run takes a single --prompt; collapse the chat
// transcript into a labelled prompt (system first, then the turns).
function flatten(messages = []) {
  return messages.map((m) => {
    const role = (m.role || 'user').toUpperCase();
    const c = m.content;
    const content = typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? c.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n')
        : JSON.stringify(c);
    return `[${role}]\n${content}`;
  }).join('\n\n');
}

function parseLoose(s) {
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

function runOpenclaw(prompt) {
  return new Promise((resolve, reject) => {
    const args = [OPENCLAW_MJS, 'infer', 'model', 'run', '--json',
      '--model', MODEL, '--thinking', THINKING, '--prompt', prompt];
    // argv array + shell:false -> the prompt is one argv element, so no
    // cross-shell quoting/truncation regardless of its contents.
    const child = spawn(process.execPath, args, { windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const j = parseLoose(out);
      if (j && j.ok && j.outputs?.[0]?.text != null) return resolve(j.outputs[0].text);
      reject(new Error(`openclaw exit ${code}: ${(err || out).slice(0, 500)}`));
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, model: MODEL }));
  }
  if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(404); return res.end('not found');
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
  req.on('end', async () => {
    const started = Date.now();
    try {
      const payload = JSON.parse(body || '{}');
      const text = await runOpenclaw(flatten(payload.messages));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-shim-' + started,
        object: 'chat.completion',
        created: Math.floor(started / 1000),
        model: payload.model || MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
      console.log(`[shim] 200 in ${Date.now() - started}ms (${text.length} chars)`);
    } catch (e) {
      console.error(`[shim] 502: ${e.message}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(e.message || e), type: 'shim_error' } }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[shim] OpenAI->openclaw on http://127.0.0.1:${PORT} (model ${MODEL}, thinking ${THINKING})`);
});
