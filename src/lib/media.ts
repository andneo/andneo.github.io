import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
/** Only inspect assets in public; external resources remain author-controlled. */
export function assetExists(href: string) {
  if (!href.startsWith('/')) return true;
  const root=resolve('public');
  let pathname: string;
  try { pathname=decodeURIComponent(href.split(/[?#]/)[0]); } catch { return false; }
  const file=resolve(root,'.'+pathname);
  return file.startsWith(root+sep)&&existsSync(file);
}
