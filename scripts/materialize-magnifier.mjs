import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');
const assetsDir = path.join(scriptsDir, 'assets');
const outputDir = path.join(rootDir, 'public', 'images', 'research');

const parts = [
  'magnifier-shell.b64.01',
  'magnifier-shell.b64.02',
  'magnifier-shell.b64.03a1',
  'magnifier-shell.b64.03a2',
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

const v4Parts = [
  'magnifier-shell-v4-q90.b64.01',
  'magnifier-shell-v4-q90.b64.02',
  'magnifier-shell-v4-q90.b64.03',
  'magnifier-shell-v4-q90.b64.04a',
  'magnifier-shell-v4-q90.b64.04b',
  'magnifier-shell-v4-q90.b64.04c',
  'magnifier-shell-v4-q90.b64.04d',
  'magnifier-shell-v4-q90.b64.05a',
  'magnifier-shell-v4-q90.b64.05b',
  'magnifier-shell-v4-q90.b64.05c',
  'magnifier-shell-v4-q90.b64.05d',
];

const v4Encoded = v4Parts
  .map((name) => fs.readFileSync(path.join(assetsDir, name), 'utf8').trim())
  .join('');

if (v4Encoded.length !== 104752) {
  throw new Error(`Magnifier v4 payload length mismatch: expected 104752, got ${v4Encoded.length}.`);
}

const v4Bytes = Buffer.from(v4Encoded, 'base64');
if (v4Bytes.length !== 78564) {
  throw new Error(`Magnifier v4 byte length mismatch: expected 78564, got ${v4Bytes.length}.`);
}

if (
  v4Bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
  v4Bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
) {
  throw new Error('Magnifier v4 payload is not a valid WebP container.');
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'magnifier-shell-v2.webp'), bytes);
fs.writeFileSync(path.join(outputDir, 'magnifier-shell-v4.webp'), v4Bytes);

console.log(`Materialized magnifier-shell-v2.webp (${bytes.length} bytes).`);
console.log(`Materialized magnifier-shell-v4.webp (${v4Bytes.length} bytes).`);
