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

let demoAccessToken;

function getDemoAccessToken() {
  if (typeof window === 'undefined') return '';
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('demo');
  if (token && /^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    demoAccessToken = token;
    fragment.delete('demo');
    const remaining = fragment.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ''}`);
    try { window.sessionStorage.setItem('resona-demo-access', token); } catch { return demoAccessToken; }
  }
  try { return demoAccessToken || window.sessionStorage.getItem('resona-demo-access') || ''; } catch { return demoAccessToken || ''; }
}

export async function startGuestSession() {
  const token = getDemoAccessToken();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const resp = await fetch('/api/auth/guest', { method: 'POST', credentials: 'include', headers });
  if (resp.status === 429) throw new Error('The demo is full. Please ask the presenter for access.');
  if (!resp.ok) throw new Error('guest start failed');
}

export async function fetchHealth() {
  try {
    const resp = await fetch('/health');
    return resp.ok ? await resp.json() : {};
  } catch {
    return {};
  }
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
