import { lstatSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIME = Object.freeze({ js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' });

function isRegular(path) {
  try { return lstatSync(path).isFile(); } catch { return false; }
}

export function createStaticHandler(root) {
  if (!lstatSync(root).isDirectory()) throw new Error('Static directory is unavailable');
  const entry = join(root, 'sensor.html');
  if (!isRegular(entry)) throw new Error('Sensor entry is unavailable');
  const paths = new Map([['/', [entry, 'text/html; charset=utf-8']], ['/sensor.html', [entry, 'text/html; charset=utf-8']], ['/sensor', [entry, 'text/html; charset=utf-8']]]);
  const assets = join(root, 'assets');
  try {
    if (lstatSync(assets).isDirectory()) for (const name of readdirSync(assets)) {
      const match = name.match(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(js|css)$/);
      if (match && isRegular(join(assets, name))) paths.set(`/assets/${name}`, [join(assets, name), MIME[match[1]]]);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    const file = paths.get(req.url.split('?', 1)[0]);
    if (!file) return false;
    try {
      const body = await readFile(file[0]);
      res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end();
    }
    return true;
  };
}
