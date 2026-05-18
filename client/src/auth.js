export async function fetchMe() {
  const resp = await fetch('/api/me', { credentials: 'include' });
  if (resp.status === 401) return null;
  if (!resp.ok) throw new Error(`me fetch failed: ${resp.status}`);
  const { user } = await resp.json();
  return user;
}

export async function requestSignInCode(email) {
  const resp = await fetch('/api/auth/request', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!resp.ok) throw new Error('request failed');
}

export async function verifySignInCode(email, code) {
  const resp = await fetch('/api/auth/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error ?? 'verify failed');
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function patchMe(patch) {
  const resp = await fetch('/api/me', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) throw new Error('patch failed');
  const { user } = await resp.json();
  return user;
}
