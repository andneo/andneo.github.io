import {published} from '../lib/content';
export async function GET(){
 const escape=(s:string)=>s.replace(/[\\{}%&#_]/g, character => character === '\\' ? '\\textbackslash{}' : '\\' + character);
 const records=(await published('publications')).map(p=>{
  const fields={title:p.data.title,author:p.data.authors.join(' and '),year:String(p.data.year),journal:p.data.journal,doi:p.data.doi};
  return `@${p.data.type==='article'?'article':'misc'}{${p.id.replaceAll('/','-')},\n${Object.entries(fields).filter(([,v])=>v).map(([k,v])=>`  ${k} = {${escape(v!)}},`).join('\n')}\n}`;
 });
 return new Response(records.join('\n\n')+'\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
}
