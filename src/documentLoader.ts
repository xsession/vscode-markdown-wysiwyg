import * as vscode from 'vscode';
import {importDocument, ImportedDocument, documentExtensions} from './documentFormats';
import {ReadingFilters, defaultFilters, filterReadingText} from './readingFilters';
export function configuredFilters(state?: vscode.Memento): ReadingFilters {
 const config = vscode.workspace.getConfiguration('markdownEditor.piper');
 return {skipCode: config.get<boolean>('skipCode', !config.get<boolean>('readCodeBlocks', false)), skipUrls:config.get<boolean>('skipUrls',true),skipHeaders:config.get<boolean>('skipHeaders',true),skipFooters:config.get<boolean>('skipFooters',true),...state?.get<Partial<ReadingFilters>>('piper.readingFilters',{})};
}
export class DocumentLoader implements vscode.Disposable, vscode.TextDocumentContentProvider {
 private converted = new Map<string,string>();
 private changed = new vscode.EventEmitter<vscode.Uri>();
 readonly onDidChange = this.changed.event;
 private registration: vscode.Disposable;
 constructor(){this.registration = vscode.workspace.registerTextDocumentContentProvider('markdown-listening',this);}
 async load(uri:vscode.Uri):Promise<ImportedDocument> {
  const ext=uri.path.split('.').pop()?.toLowerCase();
  const binary=['pdf','docx','odt','epub','rtf'].includes(ext||'');
  if ((await vscode.workspace.fs.stat(uri)).size > 64*1024*1024) throw new Error('Document exceeds the 64 MiB input limit. Split the document first.');
  let data:Buffer;
  if(binary)data=Buffer.from(await vscode.workspace.fs.readFile(uri));
  else {const doc=await vscode.workspace.openTextDocument(uri);data=Buffer.from(doc.getText(),'utf8');}
  return importDocument(data,uri.path);
 }
 provideTextDocumentContent(uri:vscode.Uri) {return this.converted.get(uri.toString())||'Document is no longer indexed. Refresh the documentation index.';}
 async show(uri:vscode.Uri, imported:ImportedDocument, line=0) {
  let target=uri;
  if(imported.extracted){target=vscode.Uri.parse('markdown-listening:/'+encodeURIComponent(uri.toString())+'.md');this.converted.set(target.toString(),imported.markdown);this.changed.fire(target);}
  const document=await vscode.workspace.openTextDocument(target),editor=await vscode.window.showTextDocument(document);
  const position=new vscode.Position(Math.min(line,document.lineCount-1),0);editor.selection=new vscode.Selection(position,position);editor.revealRange(new vscode.Range(position,position),vscode.TextEditorRevealType.AtTop);
 }
 dispose(){this.registration.dispose();this.changed.dispose();this.converted.clear();}
}
