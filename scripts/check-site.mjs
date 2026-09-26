import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {parse} from 'parse5';
import {execFileSync} from 'node:child_process';
const root=resolve('dist');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const pages=new Map();const errors=[];
for(const path of ['src/content/post/component-test.mdx','public/__test.svg','public/__test.json','public/__test.mp4','dist/posts/component-test'])if(existsSync(path))errors.push(`Temporary browser fixture remains: ${path}`);
for(const file of walk(root).filter(f=>f.endsWith('.html'))){
 const document=parse(readFileSync(file,'utf8'));const refs=[],ids=new Set();let main=0,h1=0;
 function visit(node){const attrs=Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));
  if(attrs.id){if(ids.has(attrs.id))errors.push(`${relative(root,file)}: duplicate ID ${attrs.id}`);ids.add(attrs.id);}
  if(node.tagName==='main')main++;if(node.tagName==='h1')h1++;
  if(node.tagName==='img'&&!('alt' in attrs))errors.push(`${file}: image has no alt attribute`);
  for(const key of ['href','src','poster'])if(attrs[key])refs.push(attrs[key]);
  for(const child of node.childNodes??[])visit(child);
 }
 visit(document);if(main!==1||h1!==1)errors.push(`${relative(root,file)}: expected one main and h1, got ${main}/${h1}`);
 pages.set(file,{refs,ids});
}
for(const [file,{refs}] of pages)for(const ref of refs){
 const base='https://local.test/'+relative(root,file);let target;
 try{target=new URL(ref,base);}catch{errors.push(`${file}: invalid URL ${ref}`);continue;}
 if(target.origin!=='https://local.test')continue;
 const pathname=decodeURIComponent(target.pathname);let path=resolve(root,'.'+pathname);
 if(!path.startsWith(root)) { errors.push(`Escaping URL ${ref}`);continue; }
 if(existsSync(path)&&!path.endsWith('.html')&&readdirSafe(path))path=join(path,'index.html');
 if(!existsSync(path)){errors.push(`${relative(root,file)}: missing ${ref}`);continue;}
 if(target.hash&&pages.has(path)&&!pages.get(path).ids.has(decodeURIComponent(target.hash.slice(1))))errors.push(`${relative(root,file)}: missing fragment ${ref}`);
}
function readdirSafe(p){try{readdirSync(p);return true;}catch{return false;}}
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>/(^|\/)(node_modules|\.astro|dist|\.DS_Store)(\/|$)/.test(p));
if(tracked.length)errors.push(`${tracked.length} generated paths are tracked`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Checked ${pages.size} HTML pages: internal URLs, fragments, IDs, landmarks, image alternatives and repository hygiene pass.`);
