import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { TextDecoder } from 'util';

/** Source extensions the landscape map understands (keep in step with LANG in media/codebaseMap.js). */
export const MAP_EXTENSIONS = ['js','jsx','mjs','cjs','ts','tsx','mts','cts','vue','svelte','py','go','rs','java','kt','kts','scala','c','h','cpp','cc','cxx','hpp','hh','cs','rb','php','swift','m','dart','lua','ex','exs','erl','hs','clj','jl','r','sh','bash','zsh','ps1','sql','css','scss','sass','less','html','htm','md','mdx','rst','json','yml','yaml','toml','xml','gradle','proto','graphql','gql','tf','repl','resc','robot','resource'];
const SKIP_DIRS = ['node_modules','bower_components','.git','.hg','.svn','dist','build','out','target','vendor','.next','.nuxt','.svelte-kit','__pycache__','.venv','venv','.tox','coverage','.idea','.vscode','.cache','.gradle','Pods','DerivedData','.terraform'];
const SKIP = new RegExp('(^|/)(' + SKIP_DIRS.map(d => d.replace(/\./g, '\\.')).join('|') + ')(/|$)');
const SKIP_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/i;
export const MAX_FILES = 12000;
export const MAX_BYTES = 1.5e6;
const BATCH = 300;

export interface MapFile { path: string; size: number; text: string; }

/** True when a workspace-relative path should become a hill on the map. */
export function isMappable(relPath: string): boolean {
	const p = relPath.replace(/\\/g, '/');
	if (SKIP.test(p) || SKIP_FILE.test(p)) return false;
	const m = /\.([a-z0-9]+)$/i.exec(p);
	return !!m && MAP_EXTENSIONS.includes(m[1].toLowerCase());
}

/** Paths of submodules declared in a .gitmodules file, relative to the file's folder. */
export function submodulePaths(gitmodules: string): string[] {
	const out: string[] = [];
	for (const line of gitmodules.split(/\r?\n/)) {
		const m = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
		if (m) out.push(m[1].replace(/\\/g, '/').replace(/\/$/, ''));
	}
	return out;
}

const decoder = new TextDecoder('utf-8');
async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try { return decoder.decode(await vscode.workspace.fs.readFile(uri)); } catch { return undefined; }
}
function join(base: string, rel: string): string {
	const out: string[] = [];
	for (const s of (base ? base + '/' + rel : rel).split('/')) {
		if (!s || s === '.') continue;
		if (s === '..') out.pop(); else out.push(s);
	}
	return out.join('/');
}

/**
 * Reads the git metadata the map uses to draw submodules as territories:
 * the root HEAD, every .gitmodules and each submodule's HEAD.
 */
async function gitFiles(root: vscode.Uri, prefix: string, gitmodules: string[]): Promise<MapFile[]> {
	const out: MapFile[] = [];
	const add = async (rel: string) => {
		if (out.some(f => f.path === prefix + rel)) return true;
		const text = await readText(vscode.Uri.joinPath(root, rel));
		if (text === undefined) return false;
		out.push({ path: prefix + rel, size: text.length, text });
		return true;
	};
	await add('.git/HEAD');
	for (const gm of gitmodules) {
		if (!(await add(gm))) continue;
		const base = gm.replace(/\/?\.gitmodules$/, '');
		for (const sub of submodulePaths(out.find(f => f.path === prefix + gm)!.text)) {
			const subPath = join(base, sub);
			const link = await readText(vscode.Uri.joinPath(root, subPath, '.git'));
			if (link === undefined) { await add(subPath + '/.git/HEAD'); continue; }
			out.push({ path: prefix + subPath + '/.git', size: link.length, text: link });
			const m = /gitdir:\s*(\S+)/.exec(link);
			if (m) await add(join(subPath, m[1]) + '/HEAD');
		}
	}
	return out;
}

/** Collects source files under the given roots, paths relative to the root (prefixed by the root name when there are several). */
export async function collectSources(roots: { uri: vscode.Uri; name: string }[], token?: vscode.CancellationToken, progress?: (n: number) => void): Promise<{ files: MapFile[]; cut: number }> {
	const include = '**/*.{' + MAP_EXTENSIONS.join(',') + '}';
	const exclude = '**/{' + SKIP_DIRS.join(',') + '}/**';
	const files: MapFile[] = [];
	let cut = 0;
	for (const root of roots) {
		const prefix = roots.length > 1 ? root.name + '/' : '';
		const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root.uri, include), exclude, MAX_FILES * 2, token);
		const rel = (u: vscode.Uri) => {
			const r = u.path.startsWith(root.uri.path + '/') ? u.path.slice(root.uri.path.length + 1) : vscode.workspace.asRelativePath(u, false);
			return r.replace(/\\/g, '/');
		};
		const items = found.map(u => ({ u, p: rel(u) })).filter(x => isMappable(x.p)).sort((a, b) => a.p.localeCompare(b.p));
		const room = MAX_FILES - files.length;
		if (items.length > room) { cut += items.length - Math.max(0, room); items.length = Math.max(0, room); }
		let next = 0;
		const worker = async () => {
			while (next < items.length && !token?.isCancellationRequested) {
				const it = items[next++];
				try {
					const bytes = await vscode.workspace.fs.readFile(it.u);
					if (bytes.byteLength >= MAX_BYTES) continue;
					files.push({ path: prefix + it.p, size: bytes.byteLength, text: decoder.decode(bytes) });
					if (progress && files.length % 200 === 0) progress(files.length);
				} catch { /* unreadable files are left off the map */ }
			}
		};
		await Promise.all(Array.from({ length: 16 }, worker));
		const modules = await vscode.workspace.findFiles(new vscode.RelativePattern(root.uri, '**/.gitmodules'), '**/node_modules/**', 200, token);
		files.push(...await gitFiles(root.uri, prefix, modules.map(rel).sort((a, b) => a.length - b.length)));
	}
	return { files, cut };
}

/** The "Codebase landscape map" panel: folders as islands, files as hills, imports as roads. */
export class CodebaseMap implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private roots: { uri: vscode.Uri; name: string }[] = [];
	private scanning: vscode.CancellationTokenSource | undefined;
	private readonly subscriptions: vscode.Disposable[] = [];
	private static readonly STORE_KEY = 'markdownEditor.codebaseMap.store';

	constructor(private readonly context: vscode.ExtensionContext) {
		this.subscriptions.push(vscode.commands.registerCommand('markdownEditor.codebaseMap.open', (uri?: vscode.Uri) => this.show(uri)));
	}

	async show(folder?: vscode.Uri) {
		let target = folder;
		if (target) {
			try { if ((await vscode.workspace.fs.stat(target)).type !== vscode.FileType.Directory) target = vscode.Uri.joinPath(target, '..'); } catch { target = undefined; }
		}
		const panel = this.ensurePanel();
		panel.reveal();
		if (target) await this.scan([{ uri: target, name: target.path.split('/').filter(Boolean).pop() || 'folder' }]);
		else if (this.ready && !this.roots.length) await this.scanWorkspace();
	}

	private ready = false;
	private ensurePanel(): vscode.WebviewPanel {
		if (this.panel) return this.panel;
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		const panel = vscode.window.createWebviewPanel('markdownEditor.codebaseMap', 'Codebase landscape map', vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
		this.panel = panel;
		this.ready = false;
		const nonce = crypto.randomBytes(18).toString('hex');
		const res = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name));
		const body = fs.readFileSync(vscode.Uri.joinPath(media, 'codebaseMap.body.html').fsPath, 'utf8');
		panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codebase landscape map</title><link rel="stylesheet" href="${res('codebaseMap.css')}"></head><body>\n${body}<script nonce="${nonce}" src="${res('codebaseMap.js')}"></script></body></html>`;
		this.subscriptions.push(
			panel.onDidDispose(() => { this.panel = undefined; this.roots = []; this.scanning?.cancel(); }),
			panel.webview.onDidReceiveMessage(m => this.onMessage(m)),
		);
		return panel;
	}

	private async onMessage(m: any) {
		if (!m || typeof m !== 'object') return;
		if (m.type === 'ready') { this.ready = true; if (this.roots.length) await this.scan(this.roots); else await this.scanWorkspace(); }
		else if (m.type === 'scan') await this.scanWorkspace();
		else if (m.type === 'pickFolder') {
			const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Map this folder' });
			if (picked?.[0]) await this.scan([{ uri: picked[0], name: picked[0].path.split('/').filter(Boolean).pop() || 'folder' }]);
		}
		else if (m.type === 'open' && typeof m.path === 'string') await this.open(m.path);
		else if (m.type === 'store' && typeof m.key === 'string' && m.key.length < 300) {
			const all = { ...this.context.workspaceState.get<Record<string, unknown>>(CodebaseMap.STORE_KEY, {}) };
			all[m.key] = m.value;
			await this.context.workspaceState.update(CodebaseMap.STORE_KEY, all);
		}
	}

	private async scanWorkspace() {
		const folders = vscode.workspace.workspaceFolders || [];
		if (!folders.length) { this.post({ type: 'status', text: 'No folder is open. Showing the sample project; use Map folder… to draw one.' }); return; }
		await this.scan(folders.map(f => ({ uri: f.uri, name: f.name })));
	}

	private async scan(roots: { uri: vscode.Uri; name: string }[]) {
		this.roots = roots;
		if (!this.panel || !this.ready) return;
		this.scanning?.cancel();
		const cts = this.scanning = new vscode.CancellationTokenSource();
		const name = roots.length === 1 ? roots[0].name : (vscode.workspace.name || 'workspace');
		this.post({ type: 'begin', name, store: this.context.workspaceState.get(CodebaseMap.STORE_KEY, {}) });
		try {
			const { files, cut } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Mapping codebase' },
				() => collectSources(roots, cts.token, n => this.post({ type: 'status', text: `Reading ${n.toLocaleString()} files…`, sticky: true })));
			if (cts.token.isCancellationRequested) return;
			for (let i = 0; i < files.length; i += BATCH) await this.post({ type: 'files', files: files.slice(i, i + BATCH) });
			await this.post({ type: 'end', cut });
		} catch (error) {
			vscode.window.showErrorMessage('Codebase map: ' + String(error));
		} finally { if (this.scanning === cts) this.scanning = undefined; cts.dispose(); }
	}

	/** Resolves a map path back to a file in one of the mapped roots. */
	resolve(path: string): vscode.Uri | undefined {
		if (!this.roots.length || /(^|\/)\.\.(\/|$)/.test(path)) return undefined;
		if (this.roots.length === 1) return vscode.Uri.joinPath(this.roots[0].uri, path);
		const slash = path.indexOf('/');
		const root = this.roots.find(r => r.name === path.slice(0, slash));
		return root && slash > 0 ? vscode.Uri.joinPath(root.uri, path.slice(slash + 1)) : undefined;
	}

	private async open(path: string) {
		const uri = this.resolve(path);
		if (!uri) return;
		try { await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside, preview: true }); }
		catch (error) { vscode.window.showErrorMessage(String(error)); }
	}

	private post(message: unknown): Thenable<boolean> {
		return this.panel ? this.panel.webview.postMessage(message) : Promise.resolve(false);
	}

	dispose() { this.scanning?.cancel(); this.panel?.dispose(); this.subscriptions.forEach(s => s.dispose()); }
}
