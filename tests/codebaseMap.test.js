const assert=require('assert'),Module=require('module'),fs=require('fs'),path=require('path');
const original=Module._load,commands=new Map(),opened=[],posted=[],watchers=[];
const disk={
 '/ws/src/main.ts':'import {a} from "./lib/a";\n',
 '/ws/src/lib/a.ts':'export const a=1;\n',
 '/ws/src/gen/huge.ts':'generated\n',
 '/ws/node_modules/x/index.js':'skip',
 '/ws/README.md':'# Readme\n',
 '/ws/big.js':'x'.repeat(1600),
 '/ws/.git/HEAD':'ref: refs/heads/master\n',
 '/ws/.gitmodules':'[submodule "lib/sub"]\n\tpath = lib/sub\n\turl = https://example.invalid/sub.git\n',
 '/ws/lib/sub/.git':'gitdir: ../../.git/modules/sub\n',
 '/ws/.git/modules/sub/HEAD':'0123456789abcdef0123456789abcdef01234567\n',
 '/ws/lib/sub/x.py':'import os\n'};
const U=p=>({path:p,fsPath:p.replace(/^\/([a-zA-Z]:)/,'$1'),scheme:'file',authority:'',toString:()=> 'file://'+p});
const join=(u,...s)=>{const o=[];for(const x of (u.path+'/'+s.join('/')).split('/')){if(!x||x==='.')continue;if(x==='..')o.pop();else o.push(x)}return U('/'+o.join('/'))};
const disposable=()=>({dispose(){}});
const settings={'markdownEditor.codebaseMap':{maxFileBytes:1500,exclude:['**/gen']},files:{exclude:{'**/README.md':true,'**/off':false}}};
let onMsg=null,serializer=null,excludes=[];
const makePanel=()=>({title:'',reveal(){},dispose(){},onDidDispose:()=>disposable(),webview:{cspSource:'vscode-resource:',options:{},asWebviewUri:u=>u,html:'',onDidReceiveMessage:fn=>{onMsg=fn;return disposable();},postMessage:async m=>{posted.push(m);return true;}}});
let panel=null;const state=new Map();
// minimal glob matching for the brace-list exclude the module builds
const globRe=g=>new RegExp('^'+g.replace(/[.+^$()|[\]\\]/g,'\\$&').replace(/\*\*\//g,'(?:.*/)?').replace(/\/\*\*/g,'(?:/.*)?').replace(/\*/g,'[^/]*')+'$');
const excluded=(rel,glob)=>glob.slice(1,-1).split(',').some(g=>globRe(g).test(rel));
const vs={Uri:{joinPath:join,file:U,parse:s=>U(s.replace(/^file:\/\//,''))},FileType:{File:1,Directory:2,SymbolicLink:64},ViewColumn:{Active:-1,Beside:-2},ProgressLocation:{Window:10},
 RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern}},
 CancellationTokenSource:class{constructor(){this.token={isCancellationRequested:false}}cancel(){this.token.isCancellationRequested=true}dispose(){}},
 commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable();},executeCommand:async(id,uri)=>{opened.push([id,uri.path]);}},
 workspace:{workspaceFolders:[{uri:U('/ws'),name:'ws'}],name:'ws',
  getConfiguration:section=>({get:(k,d)=>{const v=(settings[section]||{})[k];return v===undefined?d:v;}}),
  createFileSystemWatcher:()=>{const w={handlers:[],dispose(){},onDidCreate:f=>{w.handlers.push(f);return disposable();},onDidDelete:f=>{w.handlers.push(f);return disposable();},onDidChange:f=>{w.handlers.push(f);return disposable();}};watchers.push(w);return w;},
  findFiles:async(rp,exclude)=>{const base=rp.base.path+'/';const keys=Object.keys(disk).filter(k=>k.startsWith(base));
   if(rp.pattern==='**/.gitmodules')return keys.filter(k=>k.endsWith('/.gitmodules')).map(U);
   excludes.push(exclude);
   return keys.filter(k=>!k.includes('/.git/')&&/\.(ts|js|md|py)$/.test(k)&&!excluded(k.slice(base.length),exclude)).map(U);},
  fs:{readFile:async u=>{if(!(u.path in disk))throw Error('ENOENT '+u.path);return Buffer.from(disk[u.path]);},stat:async u=>({type:u.path in disk?1:2|64})},
  asRelativePath:u=>u.path.replace(/^\/ws\//,'')},
 window:{createWebviewPanel:()=>panel=makePanel(),registerWebviewPanelSerializer:(t,s)=>{serializer=s;return disposable();},withProgress:(o,fn)=>fn(),showErrorMessage:e=>{throw Error(e);},showOpenDialog:async()=>undefined}};
Module._load=function(id,...args){if(id==='vscode')return vs;return original.call(this,id,...args);};
const lib=require('../out/codebaseMap');Module._load=original;
const {CodebaseMap,isMappable,submodulePaths,excludeGlob,uniqueRoots}=lib;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert(isMappable('src/a.ts'));assert(!isMappable('node_modules/a/b.js'));assert(!isMappable('dist/x.js'));assert(!isMappable('a/app.min.js'));assert(!isMappable('package-lock.json'));assert(!isMappable('notes.bin'));
 assert.deepStrictEqual(submodulePaths('[submodule "a"]\n path = deps/a/\n[submodule "b"]\n\tpath=b'),['deps/a','b']);
 const g=excludeGlob(['**/gen/','{bad}'],{'**/tmp':true,'**/keep':false});
 assert(g.includes('**/node_modules/**')&&g.includes('**/tmp')&&g.includes('**/tmp/**')&&g.includes('**/gen/**'));assert(!g.includes('keep')&&!g.includes('bad'));
 assert.deepStrictEqual(uniqueRoots([{uri:U('/a/app'),name:'app'},{uri:U('/b/app'),name:'app'},{uri:U('/c'),name:'a/b'}]).map(r=>r.name),['app','app (2)','a-b']);

 const ctx={extensionUri:U(path.resolve(__dirname,'..').replace(/\\/g,'/').replace(/^([a-zA-Z]:)/,'/$1')),workspaceState:{get:(k,d)=>state.has(k)?state.get(k):d,update:async(k,v)=>state.set(k,v)}};
 const map=new CodebaseMap(ctx);
 await commands.get('markdownEditor.codebaseMap.open')();
 assert(panel.webview.html.includes("script-src 'nonce-"),'CSP with nonce');assert(!/https?:\/\/fonts|cdnjs/.test(panel.webview.html),'no remote resources');
 assert.strictEqual(posted.length,0,'waits for the webview');
 await onMsg({type:'ready'});
 const begin=posted.find(m=>m.type==='begin'),files=posted.filter(m=>m.type==='files').flatMap(m=>m.files),end=posted.find(m=>m.type==='end');
 assert.strictEqual(begin.name,'ws');assert.strictEqual(begin.maxFiles,12000);assert(end&&end.scan===begin.scan&&posted.filter(m=>m.type==='files').every(m=>m.scan===begin.scan),'scan ids');
 assert.strictEqual(panel.title,'Codebase map: ws');
 assert.deepStrictEqual(files.map(f=>f.path).sort(),['.git/HEAD','.git/modules/sub/HEAD','.gitmodules','lib/sub/.git','lib/sub/x.py','src/lib/a.ts','src/main.ts'],'files.exclude, exclude setting and size limit are applied');
 assert.strictEqual(files.find(f=>f.path==='src/main.ts').text,disk['/ws/src/main.ts']);

 await onMsg({type:'open',path:'src/main.ts'});assert.deepStrictEqual(opened.pop(),['vscode.open','/ws/src/main.ts']);
 await onMsg({type:'reveal',path:'src/main.ts'});assert.deepStrictEqual(opened.pop(),['revealInExplorer','/ws/src/main.ts']);
 for(const bad of ['../etc/passwd','/etc/passwd','src/../../x','',42])await onMsg({type:'open',path:bad});
 assert.strictEqual(opened.length,0,'refuses paths outside the root');

 await onMsg({type:'store',key:'codemap:ws',value:{v:['src/main.ts'],t:[]}});assert.deepStrictEqual(state.get('markdownEditor.codebaseMap.store')['codemap:ws'].v,['src/main.ts']);
 await onMsg({type:'store',key:'huge',value:'x'.repeat(70000)});assert(!('huge' in state.get('markdownEditor.codebaseMap.store')),'oversized values are not stored');

 posted.length=0;watchers[0].handlers[0](U('/ws/src/new.ts'));watchers[0].handlers[0](U('/elsewhere/x.ts'));await wait(1700);
 assert.strictEqual(posted.filter(m=>m.type==='stale').length,1,'a source change marks the map stale once');
 posted.length=0;await onMsg({type:'refresh'});const again=posted.find(m=>m.type==='begin');assert(again.scan>begin.scan);assert.deepStrictEqual(again.store['codemap:ws'].v,['src/main.ts'],'trail is restored');

 posted.length=0;await commands.get('markdownEditor.codebaseMap.open')(U('/ws/src/main.ts'));
 assert.strictEqual(posted.find(m=>m.type==='begin').name,'src','a file maps its folder');
 posted.length=0;await commands.get('markdownEditor.codebaseMap.open')(U('/ws/lib'));
 assert.strictEqual(posted.find(m=>m.type==='begin').name,'lib','a symlinked folder is treated as a folder');

 map.dispose();
 const restored=new CodebaseMap(ctx);posted.length=0;const p2=makePanel();await serializer.deserializeWebviewPanel(p2,{});
 assert(p2.webview.html.includes('codebaseMap.js'));await onMsg({type:'ready'});
 assert.strictEqual(posted.find(m=>m.type==='begin').name,'lib','a restored panel maps the same folder again');
 restored.dispose();

 const js=fs.readFileSync(path.join(__dirname,'..','media','codebaseMap.js'),'utf8');
 for(const ext of lib.MAP_EXTENSIONS)assert(new RegExp("[{,\\s]"+ext+": '").test(js),'webview knows .'+ext);
 assert(!/localStorage|cdnjs|fetch\(/.test(js),'webview stays offline');
 console.log('Codebase map: scan protocol, exclusions, submodules, open/reveal, path safety, storage limits, stale detection and panel restore passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
