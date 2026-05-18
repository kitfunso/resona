import test from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, resetEmailLog, readEmailLog } from './email.js';

test.beforeEach(() => {
  resetEmailLog();
});

test('console sender records sent message', async () => {
  await sendEmail({
    to: 'alice@example.com',
    subject: 'Your Resona code',
    text: 'Your code is 123456',
  });
  const log = readEmailLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].to, 'alice@example.com');
  assert.match(log[0].text, /123456/);
});
