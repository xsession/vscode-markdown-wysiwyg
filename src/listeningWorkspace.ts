import {createHash} from 'crypto';
export interface Store {get<T>(key:string,fallback?:T):T|undefined;update(key:string,value:any):Thenable<void>|Promise<void>}
export interface QueueEntry {id:string;uri:string;title:string;line:number}
export interface DocumentProgress {fingerprint?:string;uri:string;title:string;index:number;total:number;line:number;visited:number[];completed:boolean;bookmarks:{index:number;label:string;line?:number}[];updated:number}
export interface Pronunciation {term:string;say:string;language:'any'|'en'|'hu'}
export interface SourceDocument {uri:string;title:string;text:string;format?:string}
export interface SourcePassage {id:string;uri:string;title:string;line:number;text:string;score:number}
export const defaultPronunciations:Pronunciation[]=[{term:'GPIO',say:'G P I O',language:'any'},{term:'CANopen',say:'can open',language:'en'},{term:'STM32',say:'S T M thirty two',language:'en'},{term:'kHz',say:'kilohertz',language:'en'},{term:'MHz',say:'megahertz',language:'en'},{term:'GPIO',say:'gé pé í ó',language:'hu'},{term:'STM32',say:'es té em harminckettő',language:'hu'},{term:'kHz',say:'kilohertz',language:'hu'}];
export function languageOf(text:string):'en'|'hu' {const words=text.toLocaleLowerCase().match(/[\p{L}]+/gu)||[];const hu=new Set(['a','az','és','hogy','egy','van','nem','ez','kell','vagy','mert','jel','feszültség','áram']);let count=0;for(const w of words)if(hu.has(w))count++;return /[őűŐŰ]/.test(text)||(count>=2&&/[áéíóöúüÁÉÍÓÖÚÜ]/.test(text))||count>=4?'hu':'en';}
export function pronounce(text:string,rules:Pronunciation[],language:'en'|'hu'):string {
 const applicable=[...rules].filter(r=>r.term&&r.say&&(r.language==='any'||r.language===language)).sort((a,b)=>b.term.length-a.term.length||(a.language===language?-1:1));
 const chosen=new Map<string,Pronunciation>();for(const r of applicable)if(!chosen.has(r.term))chosen.set(r.term,r);
 if(!chosen.size)return text;
 const escaped=[...chosen.keys()].map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 return text.replace(new RegExp('(?<![\\p{L}\\p{N}_])('+escaped.join('|')+')(?![\\p{L}\\p{N}_])','gu'),term=>chosen.get(term)!.say);
}
export function structures(text:string):{label:string;line:number;kind:string}[] {
 const result:{label:string;line:number;kind:string}[]=[];let fence='';const lines=text.split('\n');
 for(let i=0;i<lines.length;i++){const line=lines[i],m=/^\s*(`{3,}|~{3,})/.exec(line);if(m){if(!fence)fence=m[1][0];else if(fence===m[1][0])fence='';continue;}if(fence)continue;
  const h=/^\s{0,3}#{1,6}\s+(.+)/.exec(line);if(h){const title=h[1];result.push({label:title,line:i,kind:/^Page \d+/i.test(title)?'page':/references|bibliography|hivatkoz/i.test(title)?'references':'heading'});}
  if(/^\s*\|?.*\|/.test(line)&&/^\s*\|?[\s:|-]+\|/.test(lines[i+1]||''))result.push({label:'Table: '+line.replace(/\|/g,' ').trim(),line:i,kind:'table'});
  const figure=/!\[([^\]]*)\]/.exec(line);if(figure)result.push({label:'Figure: '+(figure[1]||'image'),line:i,kind:'figure'});
 }
 return result;
}
export function retrieve(documents:SourceDocument[],query:string,limit=4):SourcePassage[] {
 const tokens=[...new Set((query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)||[]).filter(t=>!['the','and','this','that','what','please','explain','summarize','document'].includes(t)))];const hits:SourcePassage[]=[];
 for(const doc of documents){const lines=doc.text.split('\n');let text='',start=0;const emit=()=>{if(!text.trim())return;const lower=(doc.title+' '+text).toLowerCase();let score=0;for(const token of tokens)if(lower.includes(token))score+=1+(doc.title.toLowerCase().includes(token)?2:0);hits.push({id:'',uri:doc.uri,title:doc.title,line:start,text:text.slice(0,1800),score});};
  for(let i=0;i<lines.length;i++){if(text.length+lines[i].length>1600){emit();start=i;text='';}text+=lines[i].slice(0,1800)+'\n';}emit();
 }
 return hits.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)||a.line-b.line).slice(0,limit).map((h,i)=>({...h,id:'S'+(i+1)}));
}
export function projectTour(documents:SourceDocument[],topic=''):SourceDocument[]{const tokens=topic.toLowerCase().split(/\s+/).filter(Boolean);const rank=(d:SourceDocument)=>{const t=d.title.toLowerCase();let r=/readme|overview|introduction/.test(t)?0:/architecture|design/.test(t)?10:/install|setup|getting.started/.test(t)?20:/tutorial|example/.test(t)?30:40;if(tokens.some(w=>(d.title+' '+d.text).toLowerCase().includes(w)))r-=50;return r;};return [...documents].sort((a,b)=>rank(a)-rank(b)||a.title.localeCompare(b.title)).filter(d=>!topic||tokens.some(t=>(d.title+' '+d.text).toLowerCase().includes(t))||/readme|overview/i.test(d.title)).slice(0,30);}
export class ListeningWorkspace {
 queue:QueueEntry[]=[];cursor=0;autoAdvance=true;progress:{[uri:string]:DocumentProgress}={};history:{uri:string;line:number}[]=[];
 pronunciations:Pronunciation[]=[...defaultPronunciations];languageMode:'manual'|'en'|'hu'|'auto'='manual';focus=false;syncHighlight=true;
 corrections:{[uri:string]:{hash:string;text:string}}={};private pending:Promise<any>=Promise.resolve();
 constructor(private store?:Store){const data=store?.get<any>('piper.projectWorkspace',{});if(data){this.queue=Array.isArray(data.queue)?data.queue.slice(0,1000):[];this.cursor=Math.max(0,Math.min(data.cursor||0,this.queue.length));this.autoAdvance=data.autoAdvance!==false;this.progress=data.progress||{};this.history=data.history||[];this.pronunciations=data.pronunciations||[...defaultPronunciations];this.languageMode=data.languageMode||'manual';this.focus=!!data.focus;this.syncHighlight=data.syncHighlight!==false;this.corrections=data.corrections||{};}}
 save(){const value=JSON.parse(JSON.stringify({queue:this.queue,cursor:this.cursor,autoAdvance:this.autoAdvance,progress:this.progress,history:this.history,pronunciations:this.pronunciations,languageMode:this.languageMode,focus:this.focus,syncHighlight:this.syncHighlight,corrections:this.corrections}));this.pending=this.pending.catch(()=>{}).then(()=>this.store?.update('piper.projectWorkspace',value));return this.pending;}
 add(documents:{uri:string;title:string;line?:number}[]){for(const doc of documents){const line=Math.max(0,doc.line||0),id=createHash('sha256').update(doc.uri+'#'+line).digest('hex');if(this.queue.length<1000&&!this.queue.some(e=>e.id===id))this.queue.push({id,uri:doc.uri,title:doc.title,line});}return this.save();}
 move(id:string,delta:number){const i=this.queue.findIndex(e=>e.id===id),j=i+delta;if(i<0||j<0||j>=this.queue.length)return this.save();const current=this.queue[this.cursor]?.id;[this.queue[i],this.queue[j]]=[this.queue[j],this.queue[i]];if(current)this.cursor=this.queue.findIndex(e=>e.id===current);return this.save();}
 remove(id:string){const active=this.queue[this.cursor]?.id;this.queue=this.queue.filter(e=>e.id!==id);const i=this.queue.findIndex(e=>e.id===active);this.cursor=i>=0?i:Math.min(this.cursor,this.queue.length);return this.save();}
 record(value:Omit<DocumentProgress,'visited'|'updated'|'completed'>,heard=false,completed=false){const old=this.progress[value.uri];const changed=!!old?.fingerprint&&!!value.fingerprint&&old.fingerprint!==value.fingerprint;const visited=new Set(changed?[]:old?.visited||[]);if(heard)visited.add(value.index);this.progress[value.uri]={...value,visited:[...visited].slice(-100000),completed:completed||(!changed&&!!old?.completed),updated:Date.now()};const keys=Object.keys(this.progress).sort((a,b)=>this.progress[b].updated-this.progress[a].updated);for(const key of keys.slice(500))delete this.progress[key];return this.save();}
 correct(uri:string,original:string,text:string){if(text.length>200000)throw Error('Corrections are limited to 200,000 characters. Split this document.');this.corrections[uri]={hash:createHash('sha256').update(original).digest('hex'),text};return this.save();}
 source(uri:string,original:string){const edit=this.corrections[uri];return edit&&edit.hash===createHash('sha256').update(original).digest('hex')?edit.text:original;}
}
/** Full current heading section, chunked with source lines; never silently truncates. */
export function chapterPassages(document:SourceDocument,line:number,maxChunks=16):SourcePassage[]{
 const lines=document.text.split('\n');const found=structures(document.text).filter(s=>s.kind==='heading'||s.kind==='page'||s.kind==='references');let start=0,level=0;
 for(const h of found)if(h.line<=line){start=h.line;level=/^\s*(#+)/.exec(lines[start])?.[1].length||1;}else break;
 let end=lines.length;for(const h of found)if(h.line>start&&(/^\s*(#+)/.exec(lines[h.line])?.[1].length||1)<=level){end=h.line;break;}
 const passages:SourcePassage[]=[];let buffer='',at=start;
 const emit=()=>{if(buffer.trim()){passages.push({id:'S'+(passages.length+1),uri:document.uri,title:document.title,line:at,text:buffer,score:1});buffer='';}};
 for(let i=start;i<end;i++){const value=lines[i]+'\n';for(let offset=0;offset<value.length;offset+=1800){const part=value.slice(offset,offset+1800);if(buffer.length+part.length>2000){emit();at=i;}if(!buffer)at=i;buffer+=part;}}emit();
 if(passages.length>maxChunks)throw Error('This section needs '+passages.length+' model chunks (limit '+maxChunks+'). Choose a smaller child heading for a complete summary.');return passages;
}
