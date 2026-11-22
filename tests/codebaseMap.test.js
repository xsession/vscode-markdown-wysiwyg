const assert=require('assert'),Module=require('module'),fs=require('fs'),path=require('path');
const original=Module._load,commands=new Map(),opened=[],posted=[];
const disk={
 '/ws/src/main.ts':'import {a} from "./lib/a";\n',
 '/ws/src/lib/a.ts':'export const a=1;\n',
 '/ws/node_modules/x/index.js':'skip',
 '/ws/README.md':'# Readme\n',
 '/ws/big.js':'x'.repeat(1.6e6),
 '/ws/.git/HEAD':'ref: refs/heads/master\n',
 '/ws/.gitmodules':'[submodule "lib/sub"]\n\tpath = lib/sub\n\turl = https://example.invalid/sub.git\n',
 '/ws/lib/sub/.git':'gitdir: ../../.git/modules/sub\n',
 '/ws/.git/modules/sub/HEAD':'0123456789abcdef0123456789abcdef01234567\n',
 '/ws/lib/sub/x.py':'import os\n'};
const U=p=>({path:p,fsPath:p,scheme:'file',toString:()=> 'file://'+p});
const join=(u,...s)=>{const o=[];for(const x of (u.path+'/'+s.join('/')).split('/')){if(!x||x==='.')continue;if(x==='..')o.pop();else o.push(x)}return U('/'+o.join('/'))};
const disposable=()=>({dispose(){}});
let onMsg=null;
const panel={reveal(){},dispose(){},onDidDispose:()=>disposable(),webview:{cspSource:'vscode-resource:',asWebviewUri:u=>u,set html(h){this._h=h},get html(){return this._h},onDidReceiveMessage:fn=>{onMsg=fn;return disposable();},postMessage:async m=>{posted.push(m);return true;}}};
const state=new Map();
const vs={Uri:{joinPath:join,file:U},FileType:{File:1,Directory:2},ViewColumn:{Active:-1,Beside:-2},ProgressLocation:{Window:10},
 RelativePattern:class{constructor(base,pattern){this.base=base;this.pattern=pattern}},
 CancellationTokenSource:class{constructor(){this.token={isCancellationRequested:false}}cancel(){this.token.isCancellationRequested=true}dispose(){}},
 commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable();},executeCommand:async(id,uri)=>{opened.push([id,uri.path]);}},
 workspace:{workspaceFolders:[{uri:U('/ws'),name:'ws'}],name:'ws',
  findFiles:async(rp)=>{const base=rp.base.path+'/';const keys=Object.keys(disk).filter(k=>k.startsWith(base));
   if(rp.pattern==='**/.gitmodules')return keys.filter(k=>k.endsWith('/.gitmodules')).map(U);
   return keys.filter(k=>!/node_modules|\.git\//.test(k)&&/\.(ts|js|md|py)$/.test(k)).map(U);},
  fs:{readFile:async u=>{if(!(u.path in disk))throw Error('ENOENT '+u.path);return Buffer.from(disk[u.path]);},stat:async u=>({type:u.path in disk?1:2})},
  asRelativePath:u=>u.path.replace(/^\/ws\//,'')},
 window:{createWebviewPanel:()=>panel,withProgress:(o,fn)=>fn(),showErrorMessage:e=>{throw Error(e);},showOpenDialog:async()=>undefined}};
Module._load=function(id,...args){if(id==='vscode')return vs;return original.call(this,id,...args);};
const {CodebaseMap,isMappable,submodulePaths}=require('../out/codebaseMap');Module._load=original;
(async()=>{
 assert(isMappable('src/a.ts'));assert(!isMappable('node_modules/a/b.js'));assert(!isMappable('dist/x.js'));assert(!isMappable('a/app.min.js'));assert(!isMappable('package-lock.json'));assert(!isMappable('notes.bin'));
 assert.deepStrictEqual(submodulePaths('[submodule "a"]\n path = deps/a/\n[submodule "b"]\n\tpath=b'),['deps/a','b']);
 const ctx={extensionUri:U(path.resolve(__dirname,'..')),workspaceState:{get:(k,d)=>state.has(k)?state.get(k):d,update:async(k,v)=>state.set(k,v)}};
 const map=new CodebaseMap(ctx);
 await commands.get('markdownEditor.codebaseMap.open')();
 assert(panel.webview.html.includes("script-src 'nonce-"),'CSP with nonce');assert(!/https?:\/\/fonts/.test(panel.webview.html),'no remote fonts');
 assert.strictEqual(posted.length,0,'waits for the webview');
 await onMsg({type:'ready'});
 const begin=posted.find(m=>m.type==='begin'),files=posted.filter(m=>m.type==='files').flatMap(m=>m.files),end=posted.find(m=>m.type==='end');
 assert.strictEqual(begin.name,'ws');assert(end);
 const paths=files.map(f=>f.path).sort();
 assert.deepStrictEqual(paths,['.git/HEAD','.git/modules/sub/HEAD','.gitmodules','README.md','lib/sub/.git','lib/sub/x.py','src/lib/a.ts','src/main.ts']);
 assert.strictEqual(files.find(f=>f.path==='src/main.ts').text,disk['/ws/src/main.ts']);
 await onMsg({type:'open',path:'src/main.ts'});assert.deepStrictEqual(opened[0],['vscode.open','/ws/src/main.ts']);
 await onMsg({type:'open',path:'../etc/passwd'});assert.strictEqual(opened.length,1,'refuses paths outside the root');
 await onMsg({type:'store',key:'codemap:ws',value:{v:['src/main.ts'],t:[]}});assert.deepStrictEqual(state.get('markdownEditor.codebaseMap.store')['codemap:ws'].v,['src/main.ts']);
 posted.length=0;await onMsg({type:'scan'});assert.deepStrictEqual(posted.find(m=>m.type==='begin').store['codemap:ws'].v,['src/main.ts'],'trail is restored');
 const js=fs.readFileSync(path.join(__dirname,'..','media','codebaseMap.js'),'utf8');
 for(const ext of require('../out/codebaseMap').MAP_EXTENSIONS)assert(new RegExp('[{,]'+ext+":'").test(js),'webview knows .'+ext);
 assert(!/localStorage|cdnjs|fetch\(/.test(js),'webview stays offline');
 map.dispose();
 console.log('Codebase map: workspace scan, skip rules, submodule metadata, open-in-editor, path safety and trail storage passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
