import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendEmail, resetEmailLog } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, '..', 'dev-emails', 'log.json');

test.beforeEach(() => {
  resetEmailLog();
});

test('console sender records sent message', async () => {
  await sendEmail({
    to: 'alice@example.com',
    subject: 'Your Resona code',
    text: 'Your code is 123456',
  });
  const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  assert.equal(log.length, 1);
  assert.equal(log[0].to, 'alice@example.com');
  assert.match(log[0].text, /123456/);
});
