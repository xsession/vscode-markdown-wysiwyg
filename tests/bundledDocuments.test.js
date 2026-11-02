// Check the actual webpack output as well as the TypeScript test output.
const assert=require('assert'),Module=require('module'),path=require('path'),fs=require('fs');
const original=Module._load,commands=new Map(),errors=[],panels=[];
const dispose=()=>({dispose(){}}),listener=()=>dispose();
const uri=s=>({path:s,toString:()=>s});
class Emitter{constructor(){this.event=listener;}fire(){}dispose(){}}
const vscode={EventEmitter:Emitter,StatusBarAlignment:{Left:1},ViewColumn:{Beside:2},
 workspace:{isTrusted:true,getConfiguration:()=>({get:(key,fallback)=>fallback}),registerTextDocumentContentProvider:dispose,findFiles:async()=>[],createFileSystemWatcher:()=>({dispose(){},onDidCreate:listener,onDidChange:listener,onDidDelete:listener}),onDidChangeTextDocument:listener,onDidChangeWorkspaceFolders:listener,onDidChangeConfiguration:listener,fs:{stat:async u=>fs.statSync(u.path),readFile:async u=>fs.readFileSync(u.path)},openTextDocument:async u=>({getText:()=>fs.readFileSync(u.path,'utf8')})},
 window:{registerTreeDataProvider:dispose,registerCustomEditorProvider:dispose,createStatusBarItem:()=>({show(){},dispose(){}}),showErrorMessage:e=>errors.push(e),createWebviewPanel:()=>{const panel={title:'',webview:{html:'',onDidReceiveMessage:listener,postMessage(){}},onDidDispose:listener,reveal(){},dispose(){}};panels.push(panel);return panel;}},
 commands:{registerCommand:(name,action)=>{commands.set(name,action);return dispose();}},Uri:{parse:uri}};
Module._load=function(name,...args){if(name==='vscode')return vscode;return original.call(this,name,...args);};
const {activate}=require(process.env.BUNDLED_EXTENSION||'../dist/extension');Module._load=original;
(async()=>{const context={extensionPath:path.join(__dirname,'..'),globalStorageUri:{fsPath:__dirname},globalState:{get:(k,f)=>f,update:async()=>{}},workspaceState:{get:(k,f)=>f,update:async()=>{}},subscriptions:[]};
activate(context);
for(const extension of ['pdf','docx','odt','epub','rtf','rst','adoc','html','md','txt'])await commands.get('markdownEditor.readDocument')(uri(path.join(__dirname,'../examples/documents/guide.'+extension)));
assert.deepStrictEqual(errors,[]);assert.strictEqual(panels.length,1);assert(panels[0].webview.html.includes('skipFooters'));context.subscriptions.forEach(s=>s.dispose());
console.log('Built extension: all ten document imports open the Piper panel using packaged dependency resolution');
})().catch(e=>{console.error(e);process.exitCode=1;});
