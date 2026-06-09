# Live smoke test — Resona on a real phone

Prereqs (verified ready as of 2026-06-09): Postgres reachable, `resona_dev` schema migrated,
`.env` has `DATABASE_URL` + `OPENAI_API_KEY`. The dev servers must be started by you (the
agent's bash guard blocks long-running dev servers).

## Boot
Three terminals from the repo root (`C:\Users\skf_s\resona`):

```bash
# 1. backend on :3030 (runs migrations on startup)
npm run dev:server

# 2. frontend on :5174 (proxies /api -> :3030)
npm run dev:client

# 3. HTTPS tunnel so the phone gets camera + mic (secure context required off-localhost)
ngrok http 5174
```

Bootstrap one org + user (first time only; copies ADMIN_TOKEN from .env):

```bash
curl -X POST http://localhost:3030/api/admin/orgs \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $(grep ADMIN_TOKEN .env | cut -d= -f2)" \
  -d '{"slug":"smoke","name":"Smoke Co","firstUserEmail":"you@example.com"}'
```

Open the **https** ngrok URL on the phone (not the http localhost one).

## Phone checklist
- [ ] Page loads over HTTPS, no console errors.
- [ ] Magic-code login: enter email -> the 6-digit code prints to the **server console** and
      `dev-emails/log.json` -> sign in succeeds.
- [ ] Profile setup saves (name/age/sex/height/ethnicity).
- [ ] **Heart** module: camera permission prompt -> 30s capture -> shows a HR number (grade
      good/fair) **or** coaching (grade poor).
- [ ] **Gate-fix check (the point of this round):** cover the camera / do it in the dark ->
      capture must end in **coaching, not a number**. If it shows a confident HR on a covered
      camera, the gate fix didn't take — tell me.
- [ ] **Breath** module: mic permission -> 6s blow -> FEV1/FVC/PEF result.
- [ ] **History** view lists the check-ins; nobody else can see them.

## Known quirks (from scratchpad)
- iOS Safari needs a **direct user tap** to unlock the mic/camera — don't auto-start capture.
- Ports 5174 / 3030 sometimes clash with other local projects (Quantamental). `strictPort`
  is on, so vite will fail loudly rather than silently move.
- This is a wellness **screening** surface — the "not a medical diagnosis" disclaimer must
  stay visible.
```
