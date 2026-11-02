const assert=require('assert'),Module=require('module'),fs=require('fs'),path=require('path');
const original=Module._load;let provider,shown;const reads=[];
const uri=value=>({path:value,toString:()=>value});
class Position{constructor(line,character){this.line=line;this.character=character;}}
const vscode={EventEmitter:class{constructor(){this.event=()=>{};}fire(){}dispose(){}},Position,Selection:class{},Range:class{},TextEditorRevealType:{AtTop:1},Uri:{parse:uri},
workspace:{registerTextDocumentContentProvider:(scheme,p)=>{provider=p;return{dispose(){}};},fs:{stat:async u=>({size:fs.statSync(u.path).size}),readFile:async u=>{reads.push(u.path);return fs.readFileSync(u.path);}},openTextDocument:async u=>({lineCount:100,getText:()=>u.path.startsWith('markdown-listening:')?provider.provideTextDocumentContent(u):'# Unsaved editor text'})},window:{showTextDocument:async d=>{shown=d;return{revealRange(){}};}}};
Module._load=function(id,...args){if(id==='vscode')return vscode;return original.call(this,id,...args);};const{DocumentLoader}=require('../out/documentLoader');Module._load=original;
(async()=>{const loader=new DocumentLoader();const folder=path.join(__dirname,'../examples/documents');
 const md=await loader.load(uri(path.join(folder,'guide.md')));assert.strictEqual(md.markdown,'# Unsaved editor text');
 const docx=await loader.load(uri(path.join(folder,'guide.docx')));assert(docx.markdown.includes('Readable body'));assert(reads.some(p=>p.endsWith('.docx')));
 await loader.show(uri(path.join(folder,'guide.docx')),docx,2);assert(shown.getText().includes('Readable body'));assert(!shown.getText().includes('PK\u0003'));
 loader.dispose();console.log('Document loader: unsaved text, binary reads and extracted source navigation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
