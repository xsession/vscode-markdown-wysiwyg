import {URL} from 'url';
import {SourceDocument,DocumentProgress} from './listeningWorkspace';
import {ReaderSnapshot} from './piperReader';
import { DocumentLoader, configuredFilters } from './documentLoader';
import { documentGlob, isSupportedDocument, ImportedDocument } from './documentFormats';
import { filterReadingText } from './readingFilters';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { DocNode, documentationTree } from './documentationIndex';
import { PiperReader } from './piperReader';

export class DocumentationExplorer implements vscode.TreeDataProvider<DocNode>, vscode.Disposable {
 private changed = new vscode.EventEmitter<DocNode | undefined>();
 readonly onDidChangeTreeData = this.changed.event;
 private root: DocNode = documentationTree([]);
 private nodes = new Map<string, DocNode>();
 private panel?: vscode.WebviewPanel;
 private subscriptions: vscode.Disposable[] = [];
 private timer?: ReturnType<typeof setTimeout>;
 private generation = 0;
 private disposed = false;
 public sourceTransform=(uri:string,text:string)=>text;
 private cached=new Map<string,{stamp:string;value:ImportedDocument}>();
 private progress:{[uri:string]:DocumentProgress}={};private current?:ReaderSnapshot;
 private imports = new Map<string, ImportedDocument>();
 constructor(private context: vscode.ExtensionContext, private reader: PiperReader, private loader: DocumentLoader) {
  this.subscriptions.push(vscode.window.registerTreeDataProvider('markdownEditor.documentation', this),vscode.window.registerTreeDataProvider('markdownEditor.documentationHub',this));
  const command = (id: string, action: (...args: any[]) => any) => this.subscriptions.push(vscode.commands.registerCommand(id, action));
  command('markdownEditor.documentation.refresh', () => this.refresh());
  command('markdownEditor.documentation.mindmap', () => this.showMap());
  command('markdownEditor.documentation.open', (node: DocNode) => this.open(node?.id));
  command('markdownEditor.documentation.listen', (node: DocNode) => this.open(node?.id, true));
  const watcher = vscode.workspace.createFileSystemWatcher(documentGlob);
  this.subscriptions.push(watcher, watcher.onDidCreate(() => this.schedule()), watcher.onDidChange(() => this.schedule()), watcher.onDidDelete(() => this.schedule()),
   vscode.workspace.onDidChangeTextDocument(e => { if (isSupportedDocument(e.document.uri.path)) this.schedule(); }),
   vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
   vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('markdownEditor.documentation') || e.affectsConfiguration('markdownEditor.piper')) this.schedule(); }));
  this.refresh();
 }
 private schedule() { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 500); }
 async refresh() {
  const generation = ++this.generation;
  const config = vscode.workspace.getConfiguration('markdownEditor.documentation');
  const limit = Math.max(1, Math.min(10000, config.get<number>('maxFiles', 2000)));
  const maxBytes = Math.max(1024, config.get<number>('maxFileBytes', 33554432));
  const exclude = config.get<string>('exclude', '**/{node_modules,.git,dist,out,build,.venv,vendor}/**');
  try {
   const uris = await vscode.workspace.findFiles(documentGlob, exclude, limit + 1);
   const files: {path:string;uri:string;text:string}[] = []; const imports = new Map<string, ImportedDocument>(); const failures:string[]=[]; let skipped = 0;
   // Bound parallel reads and stop obsolete scans before doing more IO.
   for (let i = 0; i < Math.min(uris.length, limit); i += 4) {
    if (this.disposed || generation !== this.generation) return;
    await Promise.all(uris.slice(i, Math.min(i + 4, limit)).map(async uri => {
     try {
      if ((await vscode.workspace.fs.stat(uri)).size > maxBytes) { skipped++; return; }
      const stat=await vscode.workspace.fs.stat(uri);const live=vscode.workspace.textDocuments?.find(d=>d.uri.toString()===uri.toString());const stamp=String(stat.size)+':'+String(stat.mtime)+':'+String(live?.version||0);
      const old=this.cached.get(uri.toString());const imported=old?.stamp===stamp?old.value:await this.loader.load(uri);this.cached.set(uri.toString(),{stamp,value:imported});
      imports.set(uri.toString(), imported);
      files.push({path: vscode.workspace.asRelativePath(uri, true).replace(/\\/g, '/'), uri: uri.toString(), text: filterReadingText(this.sourceTransform(uri.toString(),imported.markdown),configuredFilters(this.context.workspaceState))});
     } catch(error) { skipped++; failures.push(uri.path + ': ' + String(error)); }
    }));
   }
   if (this.disposed || generation !== this.generation) return;
   this.root = documentationTree(files);this.addLinks(files);for(const uri of this.cached.keys())if(!imports.has(uri))this.cached.delete(uri); this.imports = imports; this.nodes.clear();
   const visit = (n: DocNode) => { this.nodes.set(n.id,n); n.children.forEach(visit); }; visit(this.root);
   this.updateListening(this.progress,this.current);
   this.changed.fire(undefined);
   if (failures.length) console.warn('Documentation import failures:\n' + failures.join('\n')); 
   this.panel?.webview.postMessage({type:'index', root:this.root, status:`${files.length} documents${uris.length > limit ? ' · file limit reached' : ''}${skipped ? ` · ${skipped} oversized/unreadable files skipped` : ''}`});
   if (uris.length > limit || skipped) vscode.window.setStatusBarMessage(`Documentation: ${files.length} indexed; ${skipped} skipped${uris.length > limit ? '; file limit reached (see settings)' : ''}`, 7000);
  } catch (error) { if (!this.disposed) vscode.window.showErrorMessage('Documentation indexing failed: ' + String(error)); }
 }
 documents():SourceDocument[]{return [...this.imports].map(([uri,d])=>({uri,title:vscode.workspace.asRelativePath(vscode.Uri.parse(uri),true),text:d.markdown,format:d.format}));}
 updateListening(progress:{[uri:string]:DocumentProgress},current?:ReaderSnapshot){this.progress=progress;this.current=current;let heading:DocNode|undefined;for(const n of this.nodes.values())if(n.kind==='heading'&&n.uri===current?.uri&&(n.line||0)<=(current?.line||0)&&(!heading||(n.line||0)>(heading.line||0)))heading=n;for(const node of this.nodes.values()){node.current=node.kind==='file'&&node.uri===current?.uri||node===heading;if(node.kind==='file'&&node.uri){const p=progress[node.uri];node.progress=p?Math.min(100,Math.floor(p.visited.length/Math.max(1,p.total)*100)):0;node.completed=p?.completed;node.bookmarks=p?.bookmarks.length||0;}}this.panel?.webview.postMessage({type:'marks',progress,current:current?{uri:current.uri,line:current.line}:undefined});this.changed.fire(undefined);}
 private addLinks(files:{uri:string;text:string}[]){const known=new Map(files.map(f=>[f.uri,f]));const find=(n:DocNode):DocNode[]=>[n,...n.children.flatMap(find)];const nodes=find(this.root);for(const file of files){const node=nodes.find(n=>n.id===file.uri);if(!node)continue;const pattern=/\[[^\]]*\]\(([^)]+)\)/g;let match:RegExpExecArray|null;const seen=new Set<string>();while((match=pattern.exec(file.text))){try{const target=new URL(match[1].split('#')[0],file.uri).toString();if(target!==file.uri&&known.has(target)&&!seen.has(target)){seen.add(target);node.children.push({id:file.uri+'#link-'+seen.size,label:'↗ '+decodeURIComponent(target.split('/').pop()||target),kind:'link',uri:target,line:0,children:[]});}}catch{}}}}
 getChildren(node?: DocNode): DocNode[] { return (node || this.root).children; }
 getTreeItem(node: DocNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, node.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  item.description = node.current?'▶ Current':node.kind==='file'&&node.progress!==undefined?`${node.completed?'✓ Reached end · ':''}${node.progress}% heard${node.bookmarks?' · '+node.bookmarks+' bookmarks':''}`:'';
  item.id = node.id; item.contextValue = node.uri ? 'documentationSection' : 'documentationFolder';
  item.tooltip = node.uri ? `${node.label} — line ${(node.line || 0) + 1}` : node.label;
  item.iconPath = new vscode.ThemeIcon(node.kind === 'folder' ? 'folder' : node.kind === 'file' ? 'markdown' : 'symbol-string');
  if (node.uri) item.command = {command:'markdownEditor.documentation.open', title:'Open section', arguments:[node]};
  return item;
 }
 private async open(id: string, listen = false) {
  const node = this.nodes.get(id); if (!node?.uri) return;
  try {
   const uri = vscode.Uri.parse(node.uri);
   const imported = this.imports.get(node.uri) || await this.loader.load(uri);
   if (listen) {
    await this.reader.open(imported.markdown,node.label,node.uri,true,node.line||0);
   } else {const text=this.sourceTransform(node.uri,imported.markdown);await this.loader.show(uri,text!==imported.markdown?{...imported,markdown:text,extracted:true}:imported,node.line||0);}
  } catch (error) { vscode.window.showErrorMessage(String(error)); }
 }
 private showMap() {
  if (this.panel) { this.panel.reveal(); return; }
  const panel = vscode.window.createWebviewPanel('markdownEditor.documentationMap','Documentation mind map',vscode.ViewColumn.Beside,{enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(this.context.extensionUri,'media')]});
  this.panel = panel;
  const nonce = crypto.randomBytes(18).toString('hex');
  const resource = (name:string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri,'media',name));
  panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${resource('documentationMap.css')}"></head><body><header><button id="refresh">Refresh</button><button id="showAll">All branches</button><button id="minus" aria-label="Zoom out">−</button><output id="zoom">100%</output><button id="plus" aria-label="Zoom in">+</button><button id="fit">Fit</button><button id="collapse">Collapse all</button><button id="expand">Expand all</button><label>Levels <select id="depth"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="4">4</option><option value="6">6</option><option value="99">All</option></select></label><input id="search" type="search" placeholder="Find file or heading" aria-label="Find file or heading"></header><p id="status" role="status">Indexing documentation…</p><p class="hint">Scroll to zoom · drag background to pan · select a label to open · use +/− on branches to fold · Tab and Enter work on all nodes.</p><main id="viewport" aria-label="Documentation mind map"><div id="world"></div></main><script nonce="${nonce}" src="${resource('documentationMap.js')}"></script></body></html>`;
  this.subscriptions.push(panel.onDidDispose(() => { this.panel = undefined; }),panel.webview.onDidReceiveMessage(message => {
   if (message?.type === 'ready') panel.webview.postMessage({type:'index',root:this.root,status:`${this.root.children.length ? 'Project documentation' : 'No supported documents found. Open a project folder or refresh.'}`});
   else if (message?.type === 'refresh') this.refresh();
   else if ((message?.type === 'open' || message?.type === 'listen') && typeof message.id === 'string') this.open(message.id,message.type === 'listen');
  }));
 }
 dispose() { this.disposed = true; this.generation++; if (this.timer) clearTimeout(this.timer); this.panel?.dispose(); this.subscriptions.forEach(s => s.dispose()); this.changed.dispose(); }
}
