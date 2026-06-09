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
// Optional override so the standard OpenAI SDK can target an OpenAI-compatible
// endpoint (e.g. the local openclaw shim or OpenRouter). Unset = OpenAI direct.
const BASE_URL = process.env.OPENAI_BASE_URL;
export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const DEFAULT_TEMPERATURE = 0.6;
const DEFAULT_MAX_TOKENS = 2000;

// timeout/maxRetries are set explicitly: the SDK default is a 10-minute
// timeout with 2 retries, so a stalled upstream could hang an analyze
// request ~30 min. 45s + one retry caps worst-case latency near 90s.
const client = API_KEY
  ? new OpenAI({ apiKey: API_KEY, ...(BASE_URL ? { baseURL: BASE_URL } : {}), timeout: 45_000, maxRetries: 1 })
  : null;

export function isConfigured() {
  return client !== null;
}

const TRACE_ENABLED = process.env.LLM_TRACE === '1';
const PII_KEYS = new Set(['dob', 'height_cm', 'heightCm', 'sex', 'ethnicity', 'name', 'email']);

function redact(value) {
  // Prompt builders JSON.stringify their payloads, so message `content` is a
  // string. Parse it, redact the structure, and re-stringify — otherwise PII
  // inside the string would pass through untouched.
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed !== null && typeof parsed === 'object') {
        return JSON.stringify(redact(parsed));
      }
    } catch {}
    return value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = PII_KEYS.has(k) ? '[redacted]' : redact(v);
  }
  return out;
}

function traceWrite(entry) {
  if (!TRACE_ENABLED) return;
  const safe = { ...entry, in: redact(entry.in) };
  const line = JSON.stringify({ ts: new Date().toISOString(), ...safe }) + '\n';
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

// Retry wrapper around askGLMJson for the analyze-* handlers: up to 3 attempts
// with linear backoff, retrying only transient failures (429 / connection /
// timeout / reset). Lives here next to askGLMJson, its only dependency.
export async function askGLMJsonWithRetry(messages, options) {
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await askGLMJson(messages, options);
    } catch (err) {
      lastErr = err;
      const msg = (err?.message || '').toLowerCase();
      const status = err?.status;
      const retryable =
        status === 429 ||
        msg.includes('connection') ||
        msg.includes('fetch failed') ||
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('socket hang up') ||
        msg.includes('rate limit');
      if (!retryable || attempt === maxAttempts) throw err;
      const delayMs = 800 * attempt;
      console.warn(`[glm-retry] ${options.tag}: attempt ${attempt} failed (${err.message}), waiting ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// Kept for API compatibility; OpenAI streaming is not used by current callers.
export const askGLMStream = askGLMText;

// Legacy export kept for back-compat. Not used by new code.
export const AUTH_PATH = null;
