import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { pool } from './db.js';
import { sendEmail } from './email.js';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set and at least 32 chars');
}
const SECRET_BYTES = new TextEncoder().encode(SESSION_SECRET);

function generateCode() {
  // 6 digits, zero-padded, cryptographically random.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}

export async function requestCode(email) {
  const normalized = email.trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
    [normalized],
  );
  // Always behave the same way regardless of whether the user exists,
  // to avoid leaking which emails are registered. Only actually send if the
  // user exists.
  if (rows.length === 0) return;

  const code = generateCode();
  const hash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await pool.query(
    'INSERT INTO auth_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
    [normalized, hash, expiresAt],
  );
  await sendEmail({
    to: normalized,
    subject: 'Your Resona sign-in code',
    text: `Your Resona sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore it.`,
  });
}

export async function verifyCode(email, code) {
  const normalized = email.trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, code_hash FROM auth_codes
     WHERE lower(email) = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 5`,
    [normalized],
  );
  for (const row of rows) {
    const matches = await bcrypt.compare(code, row.code_hash);
    if (matches) {
      await pool.query('UPDATE auth_codes SET consumed_at = now() WHERE id = $1', [row.id]);
      const { rows: users } = await pool.query(
        'SELECT id, org_id, email FROM users WHERE lower(email) = $1 LIMIT 1',
        [normalized],
      );
      if (users.length === 0) throw new Error('user no longer exists');
      return { userId: users[0].id, orgId: users[0].org_id, email: users[0].email };
    }
  }
  throw new Error('invalid or expired code');
}

export async function issueSession({ userId, orgId }) {
  return await new SignJWT({ userId, orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(SECRET_BYTES);
}

export async function verifySession(token) {
  const { payload } = await jwtVerify(token, SECRET_BYTES);
  return { userId: payload.userId, orgId: payload.orgId };
}

export const SESSION_COOKIE = 'resona_session';
export const SESSION_TTL_SEC_OUT = SESSION_TTL_SEC;
