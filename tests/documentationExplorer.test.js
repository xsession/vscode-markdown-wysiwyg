const assert=require('assert'),Module=require('module');
const original=Module._load,commands=new Map(),opened=[],spoken=[],events=[];
const uri={path:'/project/docs/guide.md',toString:()=> 'file:///project/docs/guide.md'};
const doc={uri,lineCount:4,getText:()=> '# Intro\nText\n## Setup\nSteps',offsetAt:p=>p.line===2?13:0};
class EventEmitter{constructor(){this.event=()=>({dispose(){}});}fire(n){events.push(n);}dispose(){}}
class Position{constructor(line,character){this.line=line;this.character=character;}}
const disposable=()=>({dispose(){}}),listener=()=>disposable();
const vs={EventEmitter,Position,Selection:class{},Range:class{},ThemeIcon:class{},TreeItem:class{},TreeItemCollapsibleState:{Collapsed:1,None:0},TextEditorRevealType:{AtTop:1},
commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable();}},
workspace:{getConfiguration:()=>({get:(name,fallback)=>fallback}),createFileSystemWatcher:()=>({dispose(){},onDidCreate:listener,onDidChange:listener,onDidDelete:listener}),onDidChangeTextDocument:listener,onDidChangeWorkspaceFolders:listener,onDidChangeConfiguration:listener,findFiles:async()=>[uri],fs:{stat:async()=>({size:30})},openTextDocument:async()=>doc,asRelativePath:()=> 'docs/guide.md'},
window:{registerTreeDataProvider:()=>disposable(),showTextDocument:async()=>{opened.push(true);return {revealRange(){}};},showErrorMessage:e=>{throw Error(e);},setStatusBarMessage(){}},Uri:{parse:s=>({toString:()=>s})}};
Module._load=function(id,...args){if(id==='vscode')return vs;return original.call(this,id,...args);};
const {DocumentationExplorer}=require('../out/documentationExplorer');Module._load=original;
(async()=>{const loader={load:async()=>({markdown:doc.getText(),extracted:false,format:'Markdown',warnings:[]}),show:async()=>opened.push(true)};const index=new DocumentationExplorer({}, {open:async(...args)=>spoken.push(args)},loader);await index.refresh();
const folder=index.getChildren()[0],file=index.getChildren(folder)[0],intro=index.getChildren(file)[0],setup=intro.children[0];
assert.strictEqual(setup.label,'Setup');await commands.get('markdownEditor.documentation.open')(setup);assert.strictEqual(opened.length,1);
await commands.get('markdownEditor.documentation.listen')(setup);assert.strictEqual(spoken[0][0],doc.getText());assert.strictEqual(spoken[0][4],2);assert.strictEqual(spoken[0][1],'Setup');
await commands.get('markdownEditor.documentation.open')({id:'file:///outside'});assert.strictEqual(opened.length,1);
assert.strictEqual(index.getTreeItem(setup).command.command,'markdownEditor.documentation.open');assert(events.length);index.dispose();
console.log('Documentation explorer: workspace scan, native tree, source navigation, section listening, unknown-node rejection and disposal passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
