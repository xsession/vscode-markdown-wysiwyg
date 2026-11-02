import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as https from 'https';
import {URL} from 'url';
import {createHash, randomBytes} from 'crypto';

export interface Voice {
	key: string; name: string; quality: string;
	language: { code: string; name_english: string; name_native: string };
	files: { [name: string]: { size_bytes: number; md5_digest: string } };
}
export interface Runtime { executable: string; args: string[]; native?: boolean }
export interface ReaderVoices {
	list(): Promise<{ key: string; label: string; installed: boolean }[]>;
	selected(): string;
	select(key: string): Promise<void>;
	resolve(): Promise<{ model: string; runtime: Runtime }>;
 resolveFor?(key:string):Promise<{model:string;runtime:Runtime}>;
	setup(): Promise<void>;
	license(key: string): Promise<void>;
}

/** Bundled models work offline; only runtime setup/additional voices require network. */
export class VoiceManager implements ReaderVoices {
	private installing: Promise<Runtime> | undefined;
	private selectedKey: string;
	private selectionGeneration = 0;
	private downloads = new Map<string, Promise<void>>();
	constructor(private context: vscode.ExtensionContext, private report: (text: string) => void) {
		this.selectedKey = context.globalState.get<string>('piper.voice', 'en_US-ljspeech-medium');
	}
	selected() { return this.selectedKey; }
	private async catalog(): Promise<{ [key: string]: Voice }> {
		return JSON.parse(await fs.readFile(path.join(this.context.extensionPath, 'resources', 'voice-catalog.json'), 'utf8'));
	}
	private async modelPath(key: string): Promise<string | undefined> {
		if (!/^[a-zA-Z0-9_-]+$/.test(key)) return undefined;
		for (const root of [path.join(this.context.extensionPath, 'resources', 'voices'), path.join(this.context.globalStorageUri.fsPath, 'voices')]) {
			const model = path.join(root, key, key + '.onnx');
			try { await fs.access(model); await fs.access(model + '.json'); await fs.access(path.join(root, key, 'MODEL_CARD')); return model; } catch { /* Try downloaded path. */ }
		}
		return undefined;
	}
	async list() {
		const catalog = await this.catalog();
		return Promise.all(Object.values(catalog).map(async voice => ({key: voice.key,
			label: `${voice.language.name_english} / ${voice.language.name_native} · ${voice.name} · ${voice.quality}`,
			installed: !!await this.modelPath(voice.key)})));
	}
	async select(key: string) {
		if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before selecting or downloading voices.');
		const generation = ++this.selectionGeneration;
		const catalog = await this.catalog();
		const voice = Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : undefined;
		if (!voice || !/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Unknown voice. Select a voice from the catalog.');
		if (!await this.modelPath(key)) {
			this.report(`Downloading ${key} with checksum verification…`);
			const destination = path.join(this.context.globalStorageUri.fsPath, 'voices', key);
			let download = this.downloads.get(key);
			if (!download) {
				download = downloadVoice(voice, destination).finally(() => this.downloads.delete(key));
				this.downloads.set(key, download);
			}
			await download;
		}
		if (generation !== this.selectionGeneration) return;
		this.selectedKey = key;
		await this.context.globalState.update('piper.voice', key);
		// An explicit voice selection supersedes a legacy custom model setting.
		await vscode.workspace.getConfiguration('markdownEditor.piper').update('modelPath', '', vscode.ConfigurationTarget.Global);
		this.report(`Voice ready: ${key}`);
	}

	async license(key: string) {
		const model = await this.modelPath(key);
		if (model) {
			const file = path.join(path.dirname(model), 'MODEL_CARD');
			try { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)), { preview: true }); return; } catch { /* Offer upstream card. */ }
		}
		const catalog = await this.catalog();
		if (!Object.prototype.hasOwnProperty.call(catalog, key)) return;
		const card = Object.keys(catalog[key].files).find(name => name.endsWith('/MODEL_CARD'));
		if (card) await vscode.env.openExternal(vscode.Uri.parse('https://huggingface.co/rhasspy/piper-voices/blob/main/' + card));
	}
	async setup() { await this.ensureRuntime(); this.report('Piper is ready. Select a voice and press Read.'); }
	async resolve() {
		if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Piper.');
		const custom = vscode.workspace.getConfiguration('markdownEditor.piper').get<string>('modelPath', '');
		const model = custom || await this.modelPath(this.selectedKey);
		if (!model) throw new Error('Voice is not installed. Choose a bundled voice in the Voices section.');
		await fs.access(model); await fs.access(model + '.json');
		return { model, runtime: await this.ensureRuntime() };
	}
	async resolveFor(key:string) {
		if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Piper.');
		const model=await this.modelPath(key);if(!model)throw new Error('Language voice is not installed: '+key);
		return {model,runtime:await this.ensureRuntime()};
	}
	private async ensureRuntime(): Promise<Runtime> {
		if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before installing or running Piper.');
		const config = vscode.workspace.getConfiguration('markdownEditor.piper');
		const exe = config.get<string>('executable', '').trim();
		const args = config.get<string[]>('arguments', []);
		// Older releases saved the bare command "piper". It bypassed the bundled
		// runtime after upgrading and failed on PCs with no Piper on PATH.
		if (!usesBundledRuntime(exe, args)) return { executable: exe, args };
		if (/^piper(?:\.exe)?$/i.test(exe)) this.report('Using the bundled offline engine instead of the legacy Piper PATH setting.');
		if (!this.installing) this.installing = this.installRuntime().catch(error => { this.installing = undefined; throw error; });
		return this.installing;
	}
	private async installRuntime(): Promise<Runtime> {
		const platform = process.platform + '-' + process.arch;
		const root = path.join(this.context.extensionPath, 'resources', 'runtime', platform, 'piper');
		const executable = path.join(root, process.platform === 'win32' ? 'piper.exe' : 'piper');
		try { await fs.access(executable); }
		catch { throw new Error('No bundled runtime for ' + platform + '. This offline package supports Windows x64 and Linux x64. Configure a custom Piper executable for another platform.'); }
		if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
		this.report('Checking bundled offline speech engine…');
		await run(executable, ['--help'], 30000);
		return {executable, args: ['--espeak_data', path.join(root, 'espeak-ng-data'), '--tashkeel_model', path.join(root, 'libtashkeel_model.ort')], native: true};
	}
}

export function usesBundledRuntime(executable: string, args: string[]): boolean {
	const value = executable.trim();
	return !value || value.toLowerCase() === 'auto' || (args.length === 0 && /^piper(?:\.exe)?$/i.test(value));
}

export function run(executable: string, args: string[], timeout: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {shell: false, windowsHide: true});
		let output = '';
		const timer = setTimeout(() => { child.kill(); reject(new Error('Setup timed out. Check your network, Python version and proxy settings, then retry.')); }, timeout);
		child.stdout?.on('data', data => { output = (output + data).slice(-5000); });
		child.stderr?.on('data', data => { output = (output + data).slice(-5000); });
		child.stdin?.end();
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${executable} failed (${code}): ${output}`)); });
	});
}


async function downloadVoice(voice: Voice, destination: string): Promise<void> {
 await fs.mkdir(destination, {recursive: true});
 for (const [remote, expected] of Object.entries(voice.files)) {
  const name = remote.split('/').pop()!;
  if (![voice.key + '.onnx', voice.key + '.onnx.json', 'MODEL_CARD'].includes(name)) continue;
  if (!/^[A-Za-z0-9_./-]+$/.test(remote) || remote.split('/').includes('..')) throw new Error('Invalid voice catalog path.');
  const output = path.join(destination, name), partial = output + '.' + randomBytes(8).toString('hex') + '.partial';
  try {
   await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {request?.destroy(new Error('Voice download timed out.')); reject(new Error('Voice download timed out.'));}, 600000);
    let request: import('http').ClientRequest | undefined;
    const fail = (error: Error) => {clearTimeout(deadline); reject(error);};
    const fetch = (url: string, redirects: number) => {
     if (!url.startsWith('https://') || redirects > 6) {fail(new Error('Invalid download redirect.')); return;}
     request = https.get(url, response => {
      if ([301,302,303,307,308].includes(response.statusCode || 0) && response.headers.location) {response.resume(); fetch(new URL(response.headers.location, url).toString(), redirects + 1); return;}
      if (response.statusCode !== 200) {response.resume(); fail(new Error('Voice download HTTP ' + response.statusCode)); return;}
      const file = require('fs').createWriteStream(partial, {flags: 'wx'});
      let complete = false;
      const hash = createHash('md5'); let bytes = 0;
      const abort = (error: Error) => {response.destroy(); file.destroy(); fail(error);};
      response.on('data', (data: Buffer) => {bytes += data.length; hash.update(data); if (bytes > expected.size_bytes) abort(new Error('Voice exceeds catalog size.'));});
      response.once('error', abort); file.once('error', abort);
      file.once('finish', () => {complete = true;});
      file.once('close', () => {clearTimeout(deadline); if (!complete) return; if (bytes !== expected.size_bytes || hash.digest('hex') !== expected.md5_digest) reject(new Error('Voice checksum mismatch.')); else resolve();});
      response.pipe(file);
     });
     request.setTimeout(60000, () => request?.destroy(new Error('Voice connection timed out.')));
     request.once('error', fail);
    };
    fetch('https://huggingface.co/rhasspy/piper-voices/resolve/main/' + remote, 0);
   });
   await fs.rename(partial, output);
  } finally {await fs.unlink(partial).catch(() => undefined);}
 }
}
