import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');
const assetsDir = path.join(scriptsDir, 'assets');

const parts = [
  'magnifier-shell.b64.01',
  'magnifier-shell.b64.02',
  'magnifier-shell.b64.03',
  'magnifier-shell.b64.03b',
  'magnifier-shell.b64.04',
  'magnifier-shell.b64.05',
  'magnifier-shell.b64.06',
];

const encoded = parts
  .map((name) => fs.readFileSync(path.join(assetsDir, name), 'utf8').trim())
  .join('');

if (encoded.length !== 53000) {
  throw new Error(`Magnifier payload length mismatch: expected 53000, got ${encoded.length}.`);
}

const bytes = Buffer.from(encoded, 'base64');
if (bytes.length !== 39750) {
  throw new Error(`Magnifier byte length mismatch: expected 39750, got ${bytes.length}.`);
}

if (
  bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
  bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
) {
  throw new Error('Magnifier payload is not a valid WebP container.');
}

const outputDir = path.join(rootDir, 'public', 'images', 'research');
const outputPath = path.join(outputDir, 'magnifier-shell-v2.webp');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, bytes);

console.log(`Materialized magnifier-shell-v2.webp (${bytes.length} bytes).`);
