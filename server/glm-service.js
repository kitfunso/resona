import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const TRACE_PATH = path.join(ROOT_DIR, 'glm-trace.log');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const {
  GLM_API_KEY,
  GLM_BASE_URL = 'https://api.z.ai/api/paas/v4/',
  GLM_MODEL = 'glm-5.1',
} = process.env;

if (!GLM_API_KEY) {
  throw new Error('GLM_API_KEY is required. Set it in .env');
}

export const client = new OpenAI({
  apiKey: GLM_API_KEY,
  baseURL: GLM_BASE_URL,
});

export const MODEL = GLM_MODEL;

function traceWrite(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(TRACE_PATH, line);
  } catch (err) {
    console.error('[glm-trace] write failed:', err.message);
  }
}

// GLM-5.1 is a reasoning model by default. For real-time demo use we disable
// reasoning per Z.ai's documented `thinking: {type: "disabled"}` parameter.
// Without this a single call takes 20-60s of hidden reasoning tokens, and 3
// parallel calls reliably 429-rate-limit. Disable is Z.ai-specific but it is
// the documented mechanism and the only way to meet Sunday's demo latency.
// Set options.thinking = 'enabled' to opt in per-call for offline use.
export async function askGLM(messages, options = {}) {
  const thinkingMode = options.thinking ?? 'disabled';
  const body = {
    model: options.model || MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 2000,
    ...(options.response_format ? { response_format: options.response_format } : {}),
    ...(thinkingMode === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
  };

  traceWrite({ direction: 'request', tag: options.tag || 'askGLM', body });

  try {
    const response = await client.chat.completions.create(body);
    traceWrite({ direction: 'response', tag: options.tag || 'askGLM', response });
    return response;
  } catch (err) {
    traceWrite({
      direction: 'error',
      tag: options.tag || 'askGLM',
      error: { message: err.message, status: err.status, body: err.response?.data },
    });
    throw err;
  }
}

export async function askGLMText(messages, options = {}) {
  const res = await askGLM(messages, options);
  return res.choices?.[0]?.message?.content ?? '';
}

export async function askGLMJson(messages, options = {}) {
  const res = await askGLM(messages, { ...options, response_format: { type: 'json_object' } });
  const raw = res.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(raw);
  } catch (err) {
    traceWrite({ direction: 'parse-error', tag: options.tag || 'askGLMJson', raw });
    throw new Error(`GLM returned non-JSON: ${raw.slice(0, 200)}`);
  }
}
