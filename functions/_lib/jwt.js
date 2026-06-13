// Minimal HS256 JWT for the Workers/Pages runtime, using Web Crypto only (no
// node deps, no `jose` bundling). Matches the old Express server's session
// contract: HS256 over { userId, orgId, iat, exp } signed with SESSION_SECRET.
// Tokens are freshly issued by these Functions, so cross-compat with the old
// server's tokens is neither needed nor attempted.

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(payload, secret, ttlSec) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET missing or too short');
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToB64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec })));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${bytesToB64url(sig)}`;
}

export async function verifySession(token, secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET missing or too short');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const data = `${parts[0]}.${parts[1]}`;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), enc.encode(data));
  if (!ok) throw new Error('bad signature');
  const payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error('expired');
  return payload;
}
