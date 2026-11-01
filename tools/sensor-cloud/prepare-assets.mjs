import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '../../client/dist');
const destination = join(here, 'dist');
const html = await readFile(join(source, 'sensor.html'), 'utf8');
const pending = [...html.matchAll(/(?:src|href)="\/assets\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css))"/g)].map((match) => match[1]);
if (!pending.some((name) => name.startsWith('sensor-') && name.endsWith('.js'))) throw new Error('Build sensor.html before preparing assets.');

const selected = new Set();
while (pending.length) {
  const name = pending.pop();
  if (selected.has(name)) continue;
  selected.add(name);
  const content = await readFile(join(source, 'assets', name), 'utf8');
  for (const match of content.matchAll(/["']\.\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css))["']/g)) pending.push(match[1]);
}

await rm(destination, { recursive: true, force: true });
await mkdir(join(destination, 'assets'), { recursive: true });
await copyFile(join(source, 'sensor.html'), join(destination, 'sensor.html'));
for (const name of selected) await copyFile(join(source, 'assets', name), join(destination, 'assets', name));
console.log(`Prepared sensor.html and ${selected.size} referenced assets.`);
