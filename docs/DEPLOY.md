# Deploying Resona

Resona deploys as a single container: the Express server serves the JSON API
and the built React client from the same process (`server/index.js` mounts
`client/dist` when `NODE_ENV=production`). The `Dockerfile` and `fly.toml` in
the repo root target [Fly.io](https://fly.io); any container host works the
same way.

## Prerequisites

- A Fly.io account and `flyctl` installed (`fly auth login`).
- An OpenAI API key.

## First-time setup

```bash
# 1. Create the app (does not deploy yet).
fly launch --no-deploy --copy-config --name resona

# 2. Provision managed Postgres and attach it.
#    `fly postgres attach` sets the DATABASE_URL secret automatically.
fly postgres create --name resona-db --region lhr
fly postgres attach resona-db --app resona

# 3. Set the remaining secrets (never commit these).
fly secrets set \
  OPENAI_API_KEY="sk-..." \
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '=\n')" \
  ADMIN_TOKEN="$(openssl rand -base64 32 | tr -d '=\n')"

# 4. Deploy.
fly deploy
```

The server runs database migrations automatically on boot, so no separate
migration step is needed.

## Configuration

| Variable | Source | Notes |
|----------|--------|-------|
| `DATABASE_URL` | `fly postgres attach` | Postgres connection string. |
| `OPENAI_API_KEY` | `fly secrets set` | LLM access; the app boots without it but analysis fails. |
| `SESSION_SECRET` | `fly secrets set` | Min 32 chars. JWT signing key. |
| `ADMIN_TOKEN` | `fly secrets set` | Min 32 chars. Gates `/api/admin/*`. |
| `NODE_ENV` | `fly.toml` | `production` — enables static client serving. |
| `PORT` | `fly.toml` | `3030`, matches `internal_port`. |
| `ALLOWED_ORIGINS` | `fly.toml` | Comma-separated origins allowed to send credentials. Update to the real domain. |
| `OPENAI_MODEL` | optional | Defaults to `gpt-4o`. |
| `LLM_TRACE` | optional | Leave unset in production (writes prompts to disk when `1`). |

## Bootstrapping the first org

After the first deploy, create an org and its first user (this is the only
way in until an admin UI exists):

```bash
curl -X POST https://resona.fly.dev/api/admin/orgs \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"slug":"demo","name":"Demo Co","firstUserEmail":"you@example.com"}'
```

## Health check

`fly.toml` polls `GET /health` every 15s. It returns `{"ok":true,...}` once
the server is up and migrations have run.

## Email in production

The dev email sender writes magic-codes to `dev-emails/log.json`. Production
needs a real sender — inject one at boot via `configureEmailSender()` in
`server/email.js` (Resend / Mailgun / SES). Until that is wired, sign-in codes
are only visible in the container logs (`fly logs`).
