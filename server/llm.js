// OpenAI-backed LLM client. Reads OPENAI_API_KEY from env. Exports the
// same surface (askGLMJson, askGLMStream, isConfigured, MODEL) as the old
// service so callers don't change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const TRACE_PATH = path.join(ROOT_DIR, 'llm-trace.log');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const API_KEY = process.env.OPENAI_API_KEY;
export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.6;
const DEFAULT_MAX_TOKENS = 2000;

// timeout/maxRetries are set explicitly: the SDK default is a 10-minute
// timeout with 2 retries, so a stalled upstream could hang an analyze
// request ~30 min. 45s + one retry caps worst-case latency near 90s.
const client = API_KEY
  ? new OpenAI({ apiKey: API_KEY, timeout: 45_000, maxRetries: 1 })
  : null;

export function isConfigured() {
  return client !== null;
}

function traceWrite(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(TRACE_PATH, line);
  } catch (err) {
    console.error('[llm-trace] write failed:', err.message);
  }
}

export async function askGLMText(messages, { tag, temperature = DEFAULT_TEMPERATURE, max_tokens = DEFAULT_MAX_TOKENS } = {}) {
  if (!client) throw new Error('OPENAI_API_KEY is not set; cannot call LLM.');
  const started = Date.now();
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature,
      max_tokens,
    });
    const text = resp.choices?.[0]?.message?.content ?? '';
    traceWrite({ tag, ms: Date.now() - started, in: messages, out: text });
    return text;
  } catch (err) {
    traceWrite({ tag, ms: Date.now() - started, in: messages, error: err.message });
    throw err;
  }
}

export async function askGLMJson(messages, opts = {}) {
  const text = await askGLMText(messages, { ...opts, tag: opts.tag ?? 'json' });
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace > 0) {
      try { return JSON.parse(trimmed.slice(0, lastBrace + 1)); } catch {}
    }
    throw new Error(`LLM did not return valid JSON: ${err.message}`);
  }
}

// Kept for API compatibility; OpenAI streaming is not used by current callers.
export const askGLMStream = askGLMText;

// Legacy export kept for back-compat. Not used by new code.
export const AUTH_PATH = null;
