import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT_DIR, 'dev-emails');
const LOG_PATH = path.join(LOG_DIR, 'log.json');

let sender = null;

export function configureEmailSender(fn) {
  sender = fn;
}

export function resetEmailLog() {
  if (fs.existsSync(LOG_DIR)) {
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
  }
}

export async function sendEmail({ to, subject, text, html }) {
  if (sender) {
    return sender({ to, subject, text, html });
  }
  // Dev fallback: append to dev-emails/log.json + log to console.
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const existing = fs.existsSync(LOG_PATH)
    ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
    : [];
  const entry = { to, subject, text, html, sentAt: new Date().toISOString() };
  existing.push(entry);
  fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2));
  console.log(`\n[email DEV] to=${to} subject=${JSON.stringify(subject)}`);
  console.log(text);
  console.log('-----');
}
