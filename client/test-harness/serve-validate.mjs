// Serve the real-camera accuracy-validation page on localhost (a secure context,
// so getUserMedia works without HTTPS). Open the printed URL on THIS machine to
// use the laptop webcam. To validate on a phone (the real product form factor),
// expose it over HTTPS instead, e.g.  ngrok http 5198  and open the https URL.
//
// Usage: node client/test-harness/serve-validate.mjs   (Ctrl-C to stop)

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.join(__dirname, '..');
const PORT = 5198;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = path.normalize(path.join(CLIENT_ROOT, urlPath));
  if (!filePath.startsWith(CLIENT_ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
  console.log(`\n  Validation page:  http://localhost:${PORT}/test-harness/validate.html`);
  console.log(`  Phone (HTTPS):    ngrok http ${PORT}  -> open the https URL on your phone\n`);
});
