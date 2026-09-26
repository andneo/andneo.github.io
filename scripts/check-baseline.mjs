import { readFileSync, existsSync } from 'node:fs';
const routes = JSON.parse(readFileSync(new URL('./baseline-routes.json', import.meta.url)));
const missing = routes.filter(route => !existsSync(new URL('../dist/' + route, import.meta.url)));
if (missing.length) throw new Error('Missing legacy routes: ' + missing.join(', '));
console.log(`All ${routes.length} baseline routes exist.`);
