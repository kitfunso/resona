// Codex (ChatGPT OAuth) backend.
// Reads ~/.codex/auth.json (populated by `codex login`), refreshes expiring
// access tokens via pi-ai, and streams from Codex's /codex/responses endpoint.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { refreshOpenAICodexToken } from '@mariozechner/pi-ai/oauth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const TRACE_PATH = path.join(ROOT_DIR, 'gpt-trace.log');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const AUTH_PATH = path.join(CODEX_HOME, 'auth.json');
const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_MODEL = process.env.CODEX_MODEL || 'gpt-5.4';
const DEFAULT_REASONING = process.env.CODEX_REASONING || 'medium';
const DEFAULT_FAST_MODE = process.env.CODEX_FAST_MODE !== 'false';

export const MODEL = DEFAULT_MODEL;
export const client = null;

let authState = null;
let inflightRefresh = null;

function traceWrite(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(TRACE_PATH, line);
  } catch (err) {
    console.error('[codex-trace] write failed:', err.message);
  }
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function accountIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
}

function expiryFromToken(token) {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' ? exp * 1000 : 0;
}

function loadAuthFromDisk() {
  if (!fs.existsSync(AUTH_PATH)) {
    throw new Error(
      `Codex auth file not found at ${AUTH_PATH}. Run \`codex login\` (install with \`npm i -g @openai/codex\`) to authorize with your ChatGPT account.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  const access = raw.tokens?.access_token?.trim();
  const refresh = raw.tokens?.refresh_token?.trim();
  if (!access || !refresh) {
    throw new Error(`${AUTH_PATH} is missing tokens.access_token or tokens.refresh_token. Re-run \`codex login\`.`);
  }
  const accountId = raw.tokens?.account_id?.trim() || accountIdFromToken(access);
  if (!accountId) {
    throw new Error('Codex access token has no chatgpt_account_id claim — re-run `codex login`.');
  }
  return {
    access,
    refresh,
    accountId,
    expires: expiryFromToken(access),
  };
}

function persistAuth(state) {
  try {
    const raw = fs.existsSync(AUTH_PATH) ? JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')) : {};
    const next = {
      ...raw,
      tokens: {
        ...(raw.tokens || {}),
        access_token: state.access,
        refresh_token: state.refresh,
        account_id: state.accountId,
      },
      last_refresh: new Date().toISOString(),
    };
    fs.writeFileSync(AUTH_PATH, JSON.stringify(next, null, 2));
  } catch (err) {
    traceWrite({ direction: 'error', tag: 'persist-auth', error: { message: err.message } });
  }
}

async function ensureFreshAccess() {
  if (!authState) authState = loadAuthFromDisk();
  const now = Date.now();
  if (authState.expires > 0 && now < authState.expires - REFRESH_MARGIN_MS) {
    return authState;
  }
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        traceWrite({ direction: 'refresh', tag: 'codex-auth', expires_in_ms: authState.expires - now });
        const refreshed = await refreshOpenAICodexToken(authState.refresh);
        authState = {
          access: refreshed.access,
          refresh: refreshed.refresh,
          accountId: refreshed.accountId || authState.accountId,
          expires: refreshed.expires || expiryFromToken(refreshed.access),
        };
        persistAuth(authState);
        return authState;
      } finally {
        inflightRefresh = null;
      }
    })();
  }
  return await inflightRefresh;
}

const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant. Follow the user message precisely.';

function toCodexInput(messages) {
  let instructions;
  const input = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      instructions = instructions ? `${instructions}\n\n${msg.content}` : msg.content;
      continue;
    }
    const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text';
    input.push({
      type: 'message',
      role: msg.role,
      content: [{ type: contentType, text: msg.content }],
    });
  }
  return { instructions: instructions || DEFAULT_INSTRUCTIONS, input };
}

function extractTextFromFinalResponse(resp) {
  if (!resp?.output) return '';
  let out = '';
  for (const item of resp.output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') out += part.text;
    }
  }
  return out;
}

async function callCodex(messages, options = {}) {
  const auth = await ensureFreshAccess();
  const { instructions, input } = toCodexInput(messages);
  const body = {
    model: options.model || DEFAULT_MODEL,
    store: false,
    stream: true,
    instructions,
    input,
    text: { verbosity: options.textVerbosity || 'medium' },
    include: ['reasoning.encrypted_content'],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    reasoning: {
      effort: options.reasoning || DEFAULT_REASONING,
      summary: options.reasoningSummary || 'auto',
    },
  };
  // GPT-5.x reasoning models on the Codex endpoint reject `temperature` and
  // `max_output_tokens`. Pass them through only for older non-reasoning models.
  const modelId = body.model.toLowerCase();
  const isReasoningModel = /^gpt-5(\.|-|$)|^o[13](\.|-|$)/.test(modelId);
  if (options.temperature != null && !isReasoningModel) body.temperature = options.temperature;
  if (options.max_tokens != null && !isReasoningModel) body.max_output_tokens = options.max_tokens;
  // Fast mode: priority service tier (lower queue time, higher cost per token).
  const fastMode = options.fastMode ?? DEFAULT_FAST_MODE;
  if (fastMode && isReasoningModel) body.service_tier = 'priority';

  traceWrite({ direction: 'request', tag: options.tag || 'askGPT', body });

  const headers = {
    Authorization: `Bearer ${auth.access}`,
    'chatgpt-account-id': auth.accountId,
    originator: 'pi',
    'User-Agent': `resona (${os.platform()} ${os.release()}; ${os.arch()})`,
    'OpenAI-Beta': 'responses=experimental',
    accept: 'text/event-stream',
    'content-type': 'application/json',
  };

  let res;
  try {
    res = await fetch(CODEX_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    traceWrite({ direction: 'error', tag: options.tag || 'askGPT', error: { message: err.message } });
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Codex HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    traceWrite({ direction: 'error', tag: options.tag || 'askGPT', status: res.status, body: text });
    throw err;
  }
  if (!res.body) {
    throw new Error('Codex returned no response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  let finalResponse = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n').trim();
        if (!data || data === '[DONE]') continue;
        let evt;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        const type = typeof evt.type === 'string' ? evt.type : '';
        if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
          output += evt.delta;
          if (options.onDelta) {
            try { options.onDelta(evt.delta); } catch {}
          }
        } else if (type === 'error') {
          throw new Error(`Codex error: ${evt.message || evt.code || JSON.stringify(evt)}`);
        } else if (type === 'response.failed') {
          throw new Error(evt.response?.error?.message || 'Codex response failed');
        } else if (type === 'response.completed' || type === 'response.done' || type === 'response.incomplete') {
          finalResponse = evt.response ?? finalResponse;
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }

  if (!output && finalResponse) output = extractTextFromFinalResponse(finalResponse);

  traceWrite({ direction: 'response', tag: options.tag || 'askGPT', text_len: output.length });

  return { choices: [{ message: { role: 'assistant', content: output } }] };
}

export async function askGPT(messages, options = {}) {
  return await callCodex(messages, options);
}

export async function askGPTText(messages, options = {}) {
  const r = await callCodex(messages, options);
  return r.choices?.[0]?.message?.content ?? '';
}

export async function askGPTStream(messages, options = {}, onDelta) {
  const r = await callCodex(messages, { ...options, onDelta });
  return r.choices?.[0]?.message?.content ?? '';
}

function stripCodeFences(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return trimmed;
}

export async function askGPTJson(messages, options = {}) {
  // Codex's Responses API doesn't accept `response_format: json_object`; nudge
  // it via the system prompt instead, then parse defensively.
  const jsonNudge = 'Respond with a single valid JSON object only. No prose, no markdown fences.';
  const msgs = [...messages];
  if (msgs.length > 0 && msgs[0].role === 'system') {
    msgs[0] = { ...msgs[0], content: `${msgs[0].content}\n\n${jsonNudge}` };
  } else {
    msgs.unshift({ role: 'system', content: jsonNudge });
  }
  const r = await callCodex(msgs, options);
  const raw = r.choices?.[0]?.message?.content ?? '';
  const candidate = stripCodeFences(raw);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    traceWrite({ direction: 'parse-error', tag: options.tag || 'askGPTJson', raw });
    throw new Error(`Codex returned non-JSON: ${raw.slice(0, 200)}`);
  }
}

export function isConfigured() {
  return fs.existsSync(AUTH_PATH);
}
