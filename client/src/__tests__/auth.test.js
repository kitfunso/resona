import test from 'node:test';
import assert from 'node:assert/strict';
import { startGuestSession } from '../auth.js';

test('guest access is sent only on click and removed from the fragment without changing other state', async () => {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  let saved, replaced, request;
  globalThis.window = {
    location: { hash: `#section=breath&demo=${token}`, pathname: '/index.html', search: '?view=home' },
    history: { state: { marker: 1 }, replaceState(state, unused, path) { replaced = { state, path }; } },
    sessionStorage: { setItem(key, value) { saved = { key, value }; }, getItem() { return saved?.value; } },
  };
  globalThis.fetch = async (path, options) => { request = { path, options }; return { ok: true }; };
  assert.equal(request, undefined);
  await startGuestSession();
  assert.equal(request.path, '/api/auth/guest');
  assert.equal(request.options.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(replaced, { state: { marker: 1 }, path: '/index.html?view=home#section=breath' });
  assert.equal(saved.value, token);
  delete globalThis.window;
});

test('guest capacity failure gives a useful message', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(startGuestSession(), /demo is full/i);
});
