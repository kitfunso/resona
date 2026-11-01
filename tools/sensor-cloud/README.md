# Sensor demo Worker

This Worker serves the earlier sensor page and the original app's Codex model reports. Both use one SQLite Durable Object with a shared lifetime limit of 24 attempts, including failures and attempts made before the limit changed. The counter persists across restarts and redeployments; restarting the Worker does not restore attempts. See [Codex analytics details](CODEX-ANALYSIS.md).

From the repository root, install dependencies and prepare the files before deploying:

```sh
npm ci
npm run build --workspace=client
node tools/sensor-cloud/prepare-assets.mjs
node --test tools/sensor-cloud/index.test.mjs
npx wrangler deploy --dry-run --config tools/sensor-cloud/wrangler.toml
```

The preparation script reads the built sensor page and its referenced scripts and styles, then replaces only the ignored `tools/sensor-cloud/dist` directory. Inspect the dry run and Worker account before deploying. Set `OPENAI_API_KEY` and a long random `SENSOR_ACCESS_TOKEN` as secrets for this Worker; never put either value in this repository. The bearer token is required for analysis. Its lifetime limit does not account for other OpenAI usage on the same account.

For a new Worker, deploy the prepared build with `npx wrangler deploy --config tools/sensor-cloud/wrangler.toml`, then use `npx wrangler secret put` with the same config to set each secret. Give a participant the page URL with `#token=` followed by the access token through a private channel. The app removes the fragment from the address bar after opening and sends it only as an authorization header for an explicit analysis request. Reloading or following the page header link requires opening the private link again.
