import {spawn, ChildProcess} from 'child_process';
import {promises as fs} from 'fs';
import * as os from 'os';
import * as path from 'path';
import {randomBytes} from 'crypto';
import {Runtime} from './voiceManager';

/** Native JSON-input mode keeps one voice loaded and supports a bounded look-ahead. */
export class SpeechEngine {
 private child: ChildProcess | undefined;
 private directory: string | undefined;
 private disposed = false;
 private initializing: Promise<string> | undefined;
 private pending = new Map<string, {resolve: (value: Buffer) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}>();
 private tail = ''; private stderr = '';
 constructor(private runtime: Runtime, private model: string) {}
 async render(text: string): Promise<Buffer> {
  if (this.disposed) throw new Error('Speech cancelled.');
  if (!this.directory) { if (!this.initializing) this.initializing = fs.mkdtemp(path.join(os.tmpdir(), 'markdown-piper-')); this.directory = await this.initializing; }
  if (this.disposed) { await this.cleanup(); throw new Error('Speech cancelled.'); }
  const output = path.join(this.directory, randomBytes(12).toString('hex') + '.wav');
  if (!this.runtime.native) return this.renderOnce(text, output);
  if (!this.child) {
   const child = spawn(this.runtime.executable, [...this.runtime.args, '--model', this.model, '--json-input', '--output_dir', this.directory], {shell: false, windowsHide: true});
   this.child = child;
   child.stdin?.on('error', error => this.fail(error));
   child.stdout?.on('data', data => {
    this.tail += data.toString();
    let newline: number;
    while ((newline = this.tail.indexOf('\n')) >= 0) {
     const filename = this.tail.slice(0, newline).trim(); this.tail = this.tail.slice(newline + 1);
     const task = this.pending.get(filename);
     if (task) { this.pending.delete(filename); clearTimeout(task.timer); this.read(filename).then(task.resolve, task.reject); }
    }
    if (this.tail.length > 8192) this.fail(new Error('Invalid Piper worker response.'));
   });
   child.stderr?.on('data', data => {this.stderr = (this.stderr + data.toString()).slice(-4000);});
   child.once('error', error => this.fail(error));
   child.once('close', code => { if (!this.disposed) this.fail(new Error(`Piper worker exited (${code}): ${this.stderr}`)); void this.cleanup(); });
  }
  return new Promise<Buffer>((resolve, reject) => {
   const timer = setTimeout(() => this.fail(new Error('Piper synthesis timed out.')), 120000);
   this.pending.set(output, {resolve, reject, timer});
   this.child!.stdin!.write(JSON.stringify({text, output_file: output}) + '\n');
  });
 }
 private async read(filename: string): Promise<Buffer> {
  try {
   const stat = await fs.stat(filename);
   if (stat.size > 32 * 1024 * 1024) throw new Error('Piper output exceeds 32 MB.');
   const audio = await fs.readFile(filename);
   if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid Piper WAV.');
   return audio;
  } finally { await fs.unlink(filename).catch(() => undefined); }
 }
 private async renderOnce(text: string, filename: string): Promise<Buffer> {
  await new Promise<void>((resolve, reject) => {
   const child = spawn(this.runtime.executable, [...this.runtime.args, '--model', this.model, '--output_file', filename], {shell: false, windowsHide: true});
   this.child = child;
   const timer = setTimeout(() => {child.kill(); reject(new Error('Piper synthesis timed out.'));}, 120000);
   child.stderr?.on('data', data => {this.stderr = (this.stderr + data.toString()).slice(-4000);}); child.stdout?.resume();
   child.stdin?.on('error', () => {});
   child.once('error', error => {clearTimeout(timer); reject(error);});
   child.once('close', code => {clearTimeout(timer); this.child = undefined; code === 0 ? resolve() : reject(new Error(`Piper failed (${code}): ${this.stderr}`)); if (this.disposed) void this.cleanup();});
   child.stdin?.end(text + '\n', 'utf8');
  });
  return this.read(filename);
 }
 private fail(error: Error) {
  for (const task of this.pending.values()) {clearTimeout(task.timer); task.reject(error);}
  this.pending.clear(); this.dispose();
 }
 dispose() {
  if (this.disposed) return;
  this.disposed = true;
  if (this.child) {this.child.kill(); this.child = undefined;} else void this.cleanup();
  for (const task of this.pending.values()) {clearTimeout(task.timer); task.reject(new Error('Speech cancelled.'));}
  this.pending.clear();
 }
 private async cleanup() {
  if (!this.directory) return;
  const directory = this.directory; this.directory = undefined;
  const files = await fs.readdir(directory).catch(() => []);
  await Promise.all(files.map(f => fs.unlink(path.join(directory, f)).catch(() => undefined)));
  await fs.rmdir(directory).catch(() => undefined);
 }
}
