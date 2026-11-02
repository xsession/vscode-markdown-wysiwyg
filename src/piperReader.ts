import {structures, languageOf, pronounce, Pronunciation} from './listeningWorkspace';
import {ReadingFilters, defaultFilters, filterReadingText} from './readingFilters';
import {configuredFilters} from './documentLoader';
import * as vscode from 'vscode';
import {createHash} from 'crypto';
import {ReaderVoices, Runtime} from './voiceManager';
import {listeningDocument, ListeningDocument, nextHeading} from './listeningDocument';
import {SpeechEngine} from './speechEngine';
import {readerHtml} from './readerHtml';

export interface ReaderSnapshot {fingerprint?:string;uri:string;title:string;text:string;line:number;index:number;total:number;bookmarks:{index:number;label:string;line:number}[]}
export interface ReaderHooks {
 prepareSource?(uri:string,text:string):string;
 opened?(previous:ReaderSnapshot|undefined,current:ReaderSnapshot):Promise<void>|void;
 position?(current:ReaderSnapshot,heard?:boolean,completed?:boolean):Promise<void>|void;
 finished?(current:ReaderSnapshot):Promise<boolean>;
 action?(action:string,message:any):Promise<void>;
 pronunciation?():Pronunciation[];
 language?():'manual'|'en'|'hu'|'auto';
 highlight?(current:ReaderSnapshot):Promise<void>|void;
}
interface Bookmark {index: number; label: string}
interface SavedSession {fingerprint: string; index: number; seconds: number; rate: number; mode: string; bookmarks: Bookmark[]}
const emptyDocument = (): ListeningDocument => ({segments: [], headings: [], words: 0});

export class PiperReader implements vscode.Disposable {
 private panel: vscode.WebviewPanel | undefined;
 private engine: SpeechEngine | undefined;
 private engineKey = '';
 private audio = new Map<number, Promise<Buffer>>();
 private native = false;
 private generation = 0;
 private doc = emptyDocument();
 private index = 0; private seconds = 0; private rate = 1;
 private mode = 'continuous'; private stopped = true; private autoStart = false;
 private sourceText = ''; private originalSource = ''; private sourceIdentity = '';
 private filters: ReadingFilters = {...defaultFilters};
 private identity = ''; private fingerprint = ''; private title = '';
 private bookmarks: Bookmark[] = []; private history: number[] = [];
 constructor(private voices?: ReaderVoices, private state?: vscode.Memento, private hooks:ReaderHooks = {}) {}
 notify(text: string) {this.send({type: 'status', text});}
 private cancel(reset = true) {
  this.generation++;
  if (reset) {this.engine?.dispose(); this.engine = undefined; this.engineKey = ''; this.audio.clear();}
 }
 dispose() {void this.save(); this.cancel(); this.panel?.dispose(); this.panel = undefined;}
 async open(markdown: string, title: string, identity = title, autoStart = false, startLine?:number) {
  if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Piper.');
  const previous=this.snapshot();
  await this.save(); this.cancel();
  this.sourceIdentity=identity;this.originalSource=markdown;markdown=this.hooks.prepareSource?.(identity,markdown)||markdown;
  this.title = title; this.identity = 'piper.session.' + createHash('sha256').update(identity).digest('hex');
  this.sourceText = markdown;
  this.filters = configuredFilters(this.state);
  this.fingerprint = createHash('sha256').update(markdown + JSON.stringify(this.filters)).digest('hex');
  this.doc = listeningDocument(filterReadingText(markdown, this.filters), !this.filters.skipCode);
  if (!this.doc.segments.length) throw new Error('No readable text in this document or selection.');
  const saved = this.state?.get<SavedSession>(this.identity);
  this.index = saved?.fingerprint === this.fingerprint ? Math.max(0, Math.min(saved.index, this.doc.segments.length - 1)) : 0;
  this.seconds = saved?.fingerprint === this.fingerprint ? Math.max(0, saved.seconds || 0) : 0;
  this.bookmarks = saved?.fingerprint === this.fingerprint ? saved.bookmarks.slice(0, 50) : [];
  this.rate = saved ? Math.max(0.5, Math.min(4, saved.rate || 1)) : 1;
  this.mode = ['continuous', 'outline', 'study'].includes(saved?.mode || '') ? saved!.mode : 'continuous';
  if(startLine!==undefined){const i=this.doc.segments.findIndex(s=>s.sourceLine>=startLine);this.index=i<0?this.doc.segments.length-1:i;this.seconds=0;}
  await this.hooks.opened?.(previous,this.snapshot()!);
  this.history = []; this.stopped = true; this.autoStart = autoStart;
  if (!this.panel) {
   this.panel = vscode.window.createWebviewPanel('markdownEditor.piperReader', 'Piper Reader', vscode.ViewColumn.Beside,
    {enableScripts: true, retainContextWhenHidden: true, localResourceRoots: []});
   this.panel.onDidDispose(() => {void this.save(); this.cancel(); this.panel = undefined;void vscode.commands.executeCommand?.('setContext','markdownEditor.listenerActive',false);});
   this.panel.webview.onDidReceiveMessage(message => this.message(message));
  }
  void vscode.commands.executeCommand?.('setContext','markdownEditor.listenerActive',true);
  this.panel.title = 'Piper: ' + title; this.panel.webview.html = readerHtml(); this.panel.reveal(vscode.ViewColumn.Beside);
 }
 private async message(message: any) {
  try {
   if (message.type === 'ready') {await this.hooks.action?.('ready',{});await this.sendVoices(); this.sendDocument(); if (this.autoStart) {this.autoStart = false; this.stopped = false; await this.speak();} return;}
   if(message.type==='projectAction'&&typeof message.action==='string'){await this.hooks.action?.(message.action,message);return;}
   if (message.type === 'setup' && this.voices) {await this.voices.setup(); return;}
   if (message.type === 'license' && this.voices && typeof message.key === 'string') {await this.voices.license(message.key); return;}
   if (message.type === 'mindmap') {await vscode.commands.executeCommand('markdownEditor.documentation.mindmap'); return;}
   if (message.type === 'openDocument') {await vscode.commands.executeCommand('markdownEditor.readDocument'); return;}
   if (message.type === 'filters' && message.filters && ['skipCode','skipUrls','skipHeaders','skipFooters'].every(key => typeof message.filters[key] === 'boolean')) {
    const filters:ReadingFilters = {skipCode:message.filters.skipCode,skipUrls:message.filters.skipUrls,skipHeaders:message.filters.skipHeaders,skipFooters:message.filters.skipFooters};
    const next = listeningDocument(filterReadingText(this.sourceText,filters),!filters.skipCode);
    if (!next.segments.length) throw new Error('These skip options leave no readable text. Change the options or open another document.');
    const line = this.doc.segments[this.index]?.sourceLine || 0;
    const bookmarkLines = this.bookmarks.map(b=>({line:this.doc.segments[b.index]?.sourceLine||0,label:b.label}));
    this.stopped = true; this.cancel(); this.doc = next; this.filters = filters;
    const nearest = (line:number) => {const i = next.segments.findIndex(s=>s.sourceLine>=line);return i<0?next.segments.length-1:i;};
    this.index=nearest(line);this.seconds=0;this.history=[];
    this.bookmarks=bookmarkLines.map(b=>({index:nearest(b.line),label:b.label})).filter((b,i,a)=>a.findIndex(x=>x.index===b.index)===i);
    this.fingerprint=createHash('sha256').update(this.sourceText+JSON.stringify(filters)).digest('hex');
    await this.state?.update('piper.readingFilters',filters);await this.save();this.sendDocument();
    this.send({type:'status',reset:true,text:'Skip options applied. Press Read to continue.'});
    await vscode.commands.executeCommand('markdownEditor.documentation.refresh');return;
   }
   if (message.type === 'guide') {await vscode.commands.executeCommand('markdownEditor.listeningGuide'); return;}
   if (message.type === 'settings') {await vscode.commands.executeCommand('workbench.action.openSettings', 'markdownEditor.piper'); return;}
   if (message.type === 'voice' && this.voices && typeof message.key === 'string') {
    this.stopped = true; this.cancel(); this.seconds = 0; await this.voices.select(message.key); await this.sendVoices(); return;
   }
   if (message.type === 'progress' && message.id === this.generation && typeof message.seconds === 'number') {
    this.seconds = Math.max(0, Math.min(600, message.seconds)); await this.save(); return;
   }
   if (message.type === 'rate' && typeof message.rate === 'number') {this.rate = Math.max(0.5, Math.min(4, message.rate)); await this.save(); return;}
   if (message.type === 'mode' && ['continuous','outline','study'].includes(message.mode)) {this.mode = message.mode; await this.save(); this.sendDocument(); return;}
   if (message.type === 'stop') {this.stopped = true; this.cancel();this.send({type:'status',reset:true,text:'Stopped. Your place is saved.'}); await this.save(); return;}
   if (message.type === 'bookmark') {
    if (this.bookmarks.length < 50 && !this.bookmarks.some(b => b.index === this.index)) this.bookmarks.push({index: this.index, label: this.doc.segments[this.index].text.slice(0, 100)});
    await this.save(); this.sendDocument(); await this.announce('Bookmark saved. ' + this.location()); return;
   }
   if (message.type === 'deleteBookmark' && Number.isInteger(message.index)) {
    this.bookmarks = this.bookmarks.filter(b => b.index !== message.index); await this.save(); this.sendDocument(); return;
   }
   if (message.type === 'context') {await this.announce(this.location() + '. Press Read to continue.'); return;}
   if (message.type === 'find' && typeof message.query === 'string') {
    const query = message.query.trim().slice(0, 200).toLocaleLowerCase();
    const results: {index: number; label: string}[] = [];
    if (query) for (let i = 0; i < this.doc.segments.length && results.length < 100; i++) if (this.doc.segments[i].text.toLocaleLowerCase().includes(query)) results.push({index: i, label: this.doc.segments[i].text.slice(0, 160)});
    this.send({type: 'results', results}); return;
   }
   if (message.type === 'back') {const previous = this.history.pop(); if (previous !== undefined) await this.jump(previous, false);else await this.hooks.action?.('backDocument',{}); return;}
   if (message.type === 'restart') {await this.jump(0); return;}
   if (message.type === 'jump' && Number.isInteger(message.index)) {await this.jump(message.index); return;}
   if (message.type === 'nextHeading' || message.type === 'previousHeading') {await this.jump(nextHeading(this.doc, this.index, message.type === 'previousHeading')); return;}
   if (message.type === 'previous' || message.type === 'next') {await this.jump(this.index + (message.type === 'previous' ? -1 : 1)); return;}
   if (message.type === 'play' || message.type === 'repeat') {if (message.type === 'repeat') this.seconds = 0; this.stopped = false; await this.speak(); return;}
   if (message.type === 'ended' && message.id === this.generation && !this.stopped) {
    this.seconds = 0;
    await this.hooks.position?.(this.snapshot()!,true);
    let next = this.index + 1;
    if (this.mode === 'outline') {const following = nextHeading(this.doc, this.index); next = following === this.index ? this.doc.segments.length : following;}
    if (next >= this.doc.segments.length) {await this.hooks.position?.(this.snapshot()!,true,true);if(await this.hooks.finished?.(this.snapshot()!))return;this.stopped = true; this.send({type: 'finished'}); await this.save(); await this.announce('Finished. You have reached the end. Use Start over to read again.'); return;}
    if (this.mode === 'study' && this.doc.segments[this.index].kind !== 'heading' && this.doc.segments[next].paragraph !== this.doc.segments[this.index].paragraph) {
     this.index = next; this.stopped = true; this.sendDocument(); await this.save();
     await this.announce('Pause for recall. Explain the main point and how it connects to the previous paragraph. Press Read to continue.'); return;
    }
    this.index = next; await this.speak();
   }
  } catch (error) {this.stopped = true; this.cancel(); if(this.doc.segments.length)this.sendDocument(); this.send({type: 'error', text: String(error)});}
 }
 snapshot():ReaderSnapshot|undefined {if(!this.doc.segments.length)return;return {fingerprint:this.fingerprint,uri:this.sourceIdentity,title:this.title,text:this.sourceText,line:this.doc.segments[this.index]?.sourceLine||0,index:this.index,total:this.doc.segments.length,bookmarks:this.bookmarks.map(b=>({...b,line:this.doc.segments[b.index]?.sourceLine||0}))};}
 rawSource(){return this.originalSource;}
 public updateProject(value:any){this.send({type:'projectState',...value});}
 public projectResult(kind:string,text:string,sources?:any[]){this.send({type:'projectResult',kind,text,sources});}
 public control(type:string){if(type==='pause'){this.send({type:'externalControl',command:'pause'});return Promise.resolve();}return this.message({type});}
 public async speakInformation(text:string){await this.announce(text);}
 public jumpToLine(line:number){const i=this.doc.segments.findIndex(s=>s.sourceLine>=line);return this.jump(i<0?this.doc.segments.length-1:i);}
 private segmentLanguage(text:string):'en'|'hu'{const mode=this.hooks.language?.()||'manual';return mode==='en'||mode==='hu'?mode:languageOf(text);}
 private async jump(index: number, remember = true) {
  if (index < 0 || index >= this.doc.segments.length) return;
  if (remember && index !== this.index) {this.history.push(this.index); if (this.history.length > 100) this.history.shift();}
  this.index = index; this.seconds = 0; this.stopped = false; await this.speak();
 }
 private location() {
  const segment = this.doc.segments[this.index];
  const remaining = this.doc.segments.slice(this.index).reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  return `${this.title}. ${segment.path.join(', ') || 'Introduction'}. Sentence or block ${this.index + 1} of ${this.doc.segments.length}. ${Math.floor(this.index / this.doc.segments.length * 100)} percent. Approximately ${Math.ceil(remaining / (180 * this.rate))} minutes remaining. This is an estimate.`;
 }
 private async save() {
  if (this.identity && this.state) await this.state.update(this.identity, {fingerprint: this.fingerprint, index: this.index, seconds: this.seconds, rate: this.rate, mode: this.mode, bookmarks: this.bookmarks} as SavedSession);
  if(this.doc.segments.length)await this.hooks.position?.(this.snapshot()!);
 }
 private async sendVoices() {if (this.voices) this.send({type: 'voices', voices: await this.voices.list(), selected: this.voices.selected()});}
 private sendDocument() {
  this.send({type: 'document', title: this.title, headings: this.doc.headings, total: this.doc.segments.length, words: this.doc.words,
   structures:structures(this.sourceText),passages:this.doc.segments.slice(Math.max(0,this.index-6),this.index+13).map((s,i)=>({index:Math.max(0,this.index-6)+i,text:s.text,kind:s.kind,sourceLine:s.sourceLine})), filters:this.filters, index: this.index, path: this.doc.segments[this.index]?.path || [], bookmarks: this.bookmarks, rate: this.rate, mode: this.mode});
 }
 private send(message: object) {this.panel?.webview.postMessage(message);}
 private async getEngine(generation = this.generation) {
  if (!vscode.workspace.isTrusted) throw new Error('Workspace trust is required to run Piper.');
  const config = vscode.workspace.getConfiguration('markdownEditor.piper');
  const lang=this.segmentLanguage(this.doc.segments[this.index]?.text||'');
  const languageMode=this.hooks.language?.()||'manual';
  const resolved = this.voices ? (languageMode!=='manual'&&this.voices.resolveFor?await this.voices.resolveFor(lang==='hu'?'hu_HU-anna-medium':'en_US-ljspeech-medium'):await this.voices.resolve()) : {model: config.get<string>('modelPath', ''), runtime: {executable: config.get<string>('executable', 'piper'), args: config.get<string[]>('arguments', [])} as Runtime};
  if (generation !== this.generation) return undefined;
  const key = JSON.stringify(resolved);
  if (!this.engine || key !== this.engineKey) {this.engine?.dispose(); this.audio.clear(); this.engine = new SpeechEngine(resolved.runtime, resolved.model); this.engineKey = key; this.native = !!resolved.runtime.native;}
  return this.engine;
 }
 private audioAt(index: number): Promise<Buffer> {
  let audio = this.audio.get(index);
  if (!audio) {audio = this.engine!.render(pronounce(this.doc.segments[index].text,this.hooks.pronunciation?.()||[],this.segmentLanguage(this.doc.segments[index].text))); this.audio.set(index, audio); void audio.catch(() => this.audio.delete(index));}
  // Keep a bounded working set instead of synthesizing the entire book.
  for (const key of this.audio.keys()) if (key < this.index - 1 || key > this.index + 2) this.audio.delete(key);
  return audio;
 }
 private async speak() {
  if (this.mode === 'outline' && this.doc.segments[this.index].kind !== 'heading') {
   const heading = nextHeading(this.doc, this.index);
   if (heading === this.index) {await this.announce('There are no more headings. Choose Continuous mode to read the text.'); return;}
   this.index = heading; this.seconds = 0;
  }
  this.cancel(!this.native); const id = this.generation;
  this.send({type: 'status', text: `Preparing ${this.index + 1} / ${this.doc.segments.length}`, reset: true});
  await this.hooks.highlight?.(this.snapshot()!);this.sendDocument();
  this.send({type: 'position', index: this.index, total: this.doc.segments.length, path: this.doc.segments[this.index].path}); await this.save();
  try {
   await this.getEngine(id); if (id !== this.generation) return;
   const data = await this.audioAt(this.index); if (id !== this.generation) return;
   this.send({type: 'audio', id, audio: data.toString('base64'), text: this.doc.segments[this.index].text,
    position: `${this.index + 1} / ${this.doc.segments.length}`, path: this.doc.segments[this.index].path,
    seconds: this.seconds, rate: this.rate, advance: true});
   const next = this.mode === 'outline' ? nextHeading(this.doc, this.index) : this.index + 1;
   if (this.native && next > this.index && next < this.doc.segments.length && this.segmentLanguage(this.doc.segments[next].text)===this.segmentLanguage(this.doc.segments[this.index].text)) void this.audioAt(next).catch(() => undefined);
  } catch (error) {if (id === this.generation) throw error;}
 }
 private async announce(text: string) {
  this.stopped = true; this.cancel(!this.native); const id = this.generation;
  this.send({type: 'status', reset: true, text});
  try {
   await this.getEngine(id); if (id !== this.generation) return;
   const audio = await this.engine!.render(text); if (id === this.generation) this.send({type: 'audio', id, audio: audio.toString('base64'), text, position: 'Reader information', rate: 1, seconds: 0, advance: false});
  } catch (error) {if (id === this.generation) throw error;}
 }
}
