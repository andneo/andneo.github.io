import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const scriptsDir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(scriptsDir,'..');
const assets=path.join(scriptsDir,'assets');
const parts=[
  'magnifier-upload.b64.01',
  'magnifier-upload.b64.02',
  'magnifier-upload.b64.03',
  'magnifier-upload.b64.040',
  'magnifier-upload.b64.041',
  'magnifier-upload.b64.050',
  'magnifier-upload.b64.051',
  'magnifier-upload.b64.060',
  'magnifier-upload.b64.061',
  'magnifier-upload.b64.070',
  'magnifier-upload.b64.071',
  'magnifier-upload.b64.08',
  'magnifier-upload.b64.09',
];

const encoded=parts.map(name=>fs.readFileSync(path.join(assets,name),'utf8').trim()).join('');
if(encoded.length!==89016)throw new Error(`Base64 length mismatch: ${encoded.length}`);
const bytes=Buffer.from(encoded,'base64');
if(bytes.length!==66762)throw new Error(`WebP size mismatch: ${bytes.length}`);

const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const expected='c5ed0a434bb3fbfca872775ee5b0d61302a242f63ea38224c9df74405979139a';
if(sha256!==expected)throw new Error(`WebP hash mismatch: ${sha256}`);
if(bytes.subarray(0,4).toString('ascii')!=='RIFF'||bytes.subarray(8,12).toString('ascii')!=='WEBP'){
  throw new Error('Invalid WebP container');
}
const read24=i=>bytes[i]|(bytes[i+1]<<8)|(bytes[i+2]<<16);
const width=read24(24)+1;
const height=read24(27)+1;
if(width!==2048||height!==2048)throw new Error(`Dimensions mismatch: ${width}x${height}`);

const output=path.join(root,'public','images','research','magnifier.webp');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,bytes);
console.log(`Materialized ${output}: ${bytes.length} bytes, ${width}x${height}, ${sha256}`);
