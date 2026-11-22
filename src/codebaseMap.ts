import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { TextDecoder } from 'util';

/*
 * Codebase landscape map.
 *
 * The extension side finds and reads the source files; the webview (media/codebaseMap.js) does
 * all the analysis and drawing. Messages between them:
 *
 *   webview → extension  ready | refresh | scan | pickFolder | open {path} | reveal {path} | store {key, value}
 *   extension → webview  begin {scan, name, store, maxFiles} | files {scan, files} | end {scan, cut}
 *                        status {text, sticky} | stale
 *
 * Every scan has an id so batches from a superseded scan are ignored by the webview.
 */

/** Source extensions the map understands. Keep in step with LANG in media/codebaseMap.js (the test checks). */
export const MAP_EXTENSIONS = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'rb', 'php', 'swift', 'm', 'dart', 'lua', 'ex', 'exs', 'erl', 'hs', 'clj', 'jl', 'r', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'md', 'mdx', 'rst', 'json', 'yml', 'yaml', 'toml', 'xml', 'gradle', 'proto', 'graphql', 'gql', 'tf', 'repl', 'resc', 'robot', 'resource'];
/** Folders that never hold the project's own source. */
export const SKIP_DIRS = ['node_modules', 'bower_components', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.nuxt', '.svelte-kit', '__pycache__', '.venv', 'venv', '.tox', 'coverage', '.idea', '.vscode', '.cache', '.gradle', 'Pods', 'DerivedData', '.terraform'];
const SKIP_PATH = new RegExp('(^|/)(' + SKIP_DIRS.map(d => d.replace(/\./g, '\\.')).join('|') + ')(/|$)');
const SKIP_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/i;

export const VIEW_TYPE = 'markdownEditor.codebaseMap';
const STORE_KEY = 'markdownEditor.codebaseMap.store';
const ROOTS_KEY = 'markdownEditor.codebaseMap.roots';
const BATCH_SIZE = 300;
const READ_CONCURRENCY = 16;
const MAX_STORED_VALUE = 64 * 1024;
const STALE_DELAY_MS = 1500;

export interface MapRoot { uri: vscode.Uri; name: string; }
export interface MapFile { path: string; size: number; text: string; }
export interface MapOptions { maxFiles: number; maxFileBytes: number; exclude: string[]; }

/** True when a root-relative path should become a hill on the map. */
export function isMappable(relPath: string): boolean {
	const p = relPath.replace(/\\/g, '/');
	if (SKIP_PATH.test(p) || SKIP_FILE.test(p)) return false;
	const m = /\.([a-z0-9]+)$/i.exec(p);
	return !!m && MAP_EXTENSIONS.includes(m[1].toLowerCase());
}

/** Submodule paths declared in a .gitmodules file, relative to that file's folder. */
export function submodulePaths(gitmodules: string): string[] {
	const out: string[] = [];
	for (const line of gitmodules.split(/\r?\n/)) {
		const m = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
		if (m) out.push(m[1].replace(/\\/g, '/').replace(/\/$/, ''));
	}
	return out;
}

/**
 * The exclude glob for findFiles. Passing any exclude to findFiles switches off `files.exclude`,
 * so the user's enabled `files.exclude` patterns are folded back in alongside the built-in folders.
 */
export function excludeGlob(extra: string[], filesExclude: Record<string, unknown> = {}): string {
	const patterns = SKIP_DIRS.map(d => `**/${d}/**`);
	const add = (p: string) => {
		const t = p.trim().replace(/\/+$/, '');
		if (!t || t.includes('{') || t.includes('}')) return; // nested braces are not valid inside a brace group
		patterns.push(t, t + '/**');
	};
	for (const [p, on] of Object.entries(filesExclude)) if (on === true) add(p);
	extra.forEach(add);
	return '{' + [...new Set(patterns)].join(',') + '}';
}

/** Gives every root a distinct name, so map paths in a multi-root workspace resolve unambiguously. */
export function uniqueRoots(roots: MapRoot[]): MapRoot[] {
	const seen = new Map<string, number>();
	return roots.map(r => {
		const base = r.name.replace(/\//g, '-') || 'folder';
		const n = (seen.get(base) || 0) + 1;
		seen.set(base, n);
		return { uri: r.uri, name: n === 1 ? base : `${base} (${n})` };
	});
}

export function readOptions(): MapOptions {
	const config = vscode.workspace.getConfiguration('markdownEditor.codebaseMap');
	const num = (key: string, fallback: number, min: number, max: number) => {
		const v = Number(config.get(key, fallback));
		return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
	};
	const exclude = config.get<unknown>('exclude', []);
	return {
		maxFiles: num('maxFiles', 12000, 100, 50000),
		maxFileBytes: num('maxFileBytes', 1500000, 1024, 16 * 1024 * 1024),
		exclude: Array.isArray(exclude) ? exclude.filter((x): x is string => typeof x === 'string') : [],
	};
}

const decoder = new TextDecoder('utf-8');
async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try { return decoder.decode(await vscode.workspace.fs.readFile(uri)); } catch { return undefined; }
}
function joinPath(base: string, rel: string): string {
	const out: string[] = [];
	for (const s of (base ? base + '/' + rel : rel).split('/')) {
		if (!s || s === '.') continue;
		if (s === '..') out.pop(); else out.push(s);
	}
	return out.join('/');
}
function relativeTo(root: vscode.Uri, uri: vscode.Uri): string {
	const base = root.path.replace(/\/$/, '') + '/';
	return uri.path.startsWith(base) ? uri.path.slice(base.length) : vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}
function contains(root: vscode.Uri, uri: vscode.Uri): boolean {
	return root.scheme === uri.scheme && root.authority === uri.authority && uri.path.startsWith(root.path.replace(/\/$/, '') + '/');
}

/** The git metadata the webview uses to draw submodules: the root HEAD, every .gitmodules and each submodule's HEAD. */
async function gitMetadata(root: vscode.Uri, prefix: string, gitmodules: string[]): Promise<MapFile[]> {
	const out = new Map<string, MapFile>();
	const add = async (rel: string): Promise<string | undefined> => {
		const known = out.get(prefix + rel);
		if (known) return known.text;
		const text = await readText(vscode.Uri.joinPath(root, rel));
		if (text !== undefined) out.set(prefix + rel, { path: prefix + rel, size: text.length, text });
		return text;
	};
	await add('.git/HEAD');
	for (const gm of gitmodules) {
		const text = await add(gm);
		if (text === undefined) continue;
		const base = gm.replace(/\/?\.gitmodules$/, '');
		for (const sub of submodulePaths(text)) {
			const subPath = joinPath(base, sub);
			const link = await add(subPath + '/.git'); // a "gitdir:" file for modern submodules
			const gitdir = link && /gitdir:\s*(\S+)/.exec(link);
			await add(gitdir ? joinPath(subPath, gitdir[1]) + '/HEAD' : subPath + '/.git/HEAD');
		}
	}
	return [...out.values()];
}

/**
 * Collects the source files under the roots. Paths are relative to the root, prefixed with the
 * root's name when there are several. `cut` counts files left out by the file limit.
 */
export async function collectSources(roots: MapRoot[], options: MapOptions, token?: vscode.CancellationToken, progress?: (read: number) => void): Promise<{ files: MapFile[]; cut: number }> {
	const include = '**/*.{' + MAP_EXTENSIONS.join(',') + '}';
	const exclude = excludeGlob(options.exclude, vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude', {}));
	const files: MapFile[] = [];
	let cut = 0;
	for (const root of roots) {
		if (token?.isCancellationRequested) break;
		const prefix = roots.length > 1 ? root.name + '/' : '';
		const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root.uri, include), exclude, options.maxFiles * 2 + 1, token);
		const items = found.map(uri => ({ uri, path: relativeTo(root.uri, uri) })).filter(x => isMappable(x.path)).sort((a, b) => a.path.localeCompare(b.path));
		const room = Math.max(0, options.maxFiles - files.length);
		if (items.length > room) { cut += items.length - room; items.length = room; }
		let next = 0;
		const worker = async () => {
			while (next < items.length && !token?.isCancellationRequested) {
				const item = items[next++];
				try {
					const bytes = await vscode.workspace.fs.readFile(item.uri);
					if (bytes.byteLength > options.maxFileBytes) continue;
					files.push({ path: prefix + item.path, size: bytes.byteLength, text: decoder.decode(bytes) });
					if (progress && files.length % 250 === 0) progress(files.length);
				} catch { /* unreadable files are left off the map */ }
			}
		};
		await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
		const modules = await vscode.workspace.findFiles(new vscode.RelativePattern(root.uri, '**/.gitmodules'), '**/node_modules/**', 200, token);
		files.push(...await gitMetadata(root.uri, prefix, modules.map(u => relativeTo(root.uri, u)).sort((a, b) => a.length - b.length)));
	}
	return { files, cut };
}

/** The "Codebase landscape map" panel: folders are islands, files are hills, imports are roads. */
export class CodebaseMap implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private panelSubscriptions: vscode.Disposable[] = [];
	private readonly subscriptions: vscode.Disposable[] = [];
	private roots: MapRoot[] = [];
	private ready = false;
	private scanId = 0;
	private scanning: vscode.CancellationTokenSource | undefined;
	private staleTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.subscriptions.push(
			vscode.commands.registerCommand('markdownEditor.codebaseMap.open', (uri?: vscode.Uri) => this.show(uri)),
			vscode.commands.registerCommand('markdownEditor.codebaseMap.refresh', () => this.panel ? this.rescan() : this.show()),
		);
		if (vscode.window.registerWebviewPanelSerializer) {
			this.subscriptions.push(vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
				deserializeWebviewPanel: async panel => {
					if (this.panel) { panel.dispose(); return; }
					this.roots = this.savedRoots();
					this.attach(panel);
				},
			}));
		}
	}

	/** Opens the map; with a folder (or a file inside one) it maps that folder instead of the workspace. */
	async show(target?: vscode.Uri) {
		const folder = target && await this.folderOf(target);
		const fresh = !this.panel;
		if (this.panel) this.panel.reveal();
		else this.attach(vscode.window.createWebviewPanel(VIEW_TYPE, 'Codebase map', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.media] }));
		if (folder) await this.scan([{ uri: folder, name: baseName(folder) }]);
		else if (fresh) this.roots = []; // the webview maps the workspace once it reports ready
	}

	/** Resolves a map path back to a file inside one of the mapped roots. */
	resolve(mapPath: string): vscode.Uri | undefined {
		if (!this.roots.length || !mapPath || /(^|\/)\.\.?(\/|$)/.test(mapPath) || mapPath.startsWith('/')) return undefined;
		if (this.roots.length === 1) return vscode.Uri.joinPath(this.roots[0].uri, mapPath);
		const slash = mapPath.indexOf('/');
		const root = slash > 0 ? this.roots.find(r => r.name === mapPath.slice(0, slash)) : undefined;
		return root && vscode.Uri.joinPath(root.uri, mapPath.slice(slash + 1));
	}

	private get media() { return vscode.Uri.joinPath(this.context.extensionUri, 'media'); }

	private async folderOf(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			return (stat.type & vscode.FileType.Directory) ? uri : vscode.Uri.joinPath(uri, '..');
		} catch { return undefined; }
	}

	private attach(panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.ready = false;
		panel.title = 'Codebase map';
		panel.iconPath = { light: vscode.Uri.joinPath(this.media, 'codebaseMap-light.svg'), dark: vscode.Uri.joinPath(this.media, 'codebaseMap-dark.svg') };
		panel.webview.options = { enableScripts: true, localResourceRoots: [this.media] };
		panel.webview.html = this.html(panel.webview);
		const watcher = vscode.workspace.createFileSystemWatcher('**/*.{' + MAP_EXTENSIONS.join(',') + '}');
		const changed = (uri: vscode.Uri) => this.onFileChanged(uri);
		this.panelSubscriptions = [
			panel.onDidDispose(() => this.detach()),
			panel.webview.onDidReceiveMessage(m => this.onMessage(m)),
			watcher, watcher.onDidCreate(changed), watcher.onDidDelete(changed), watcher.onDidChange(changed),
		];
	}

	private detach() {
		this.scanning?.cancel();
		if (this.staleTimer) clearTimeout(this.staleTimer);
		this.panelSubscriptions.forEach(s => s.dispose());
		this.panelSubscriptions = [];
		this.panel = undefined;
		this.ready = false;
	}

	private html(webview: vscode.Webview): string {
		const nonce = crypto.randomBytes(18).toString('base64');
		const uri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.media, name));
		const body = fs.readFileSync(vscode.Uri.joinPath(this.media, 'codebaseMap.body.html').fsPath, 'utf8');
		// Inline style attributes are used for computed indents and tints, hence 'unsafe-inline' for styles only.
		const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codebase map</title>
<link rel="stylesheet" href="${uri('codebaseMap.css')}">
</head>
<body>
${body}
<script nonce="${nonce}" src="${uri('codebaseMap.js')}"></script>
</body>
</html>`;
	}

	private async onMessage(m: unknown) {
		if (!m || typeof m !== 'object') return;
		const msg = m as { type?: unknown; path?: unknown; key?: unknown; value?: unknown };
		switch (msg.type) {
			case 'ready':
				this.ready = true;
				await (this.roots.length ? this.scan(this.roots) : this.scanWorkspace());
				break;
			case 'refresh': await this.rescan(); break;
			case 'scan': await this.scanWorkspace(); break;
			case 'pickFolder': {
				const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Map folder', defaultUri: this.roots[0]?.uri });
				if (picked?.[0]) await this.scan([{ uri: picked[0], name: baseName(picked[0]) }]);
				break;
			}
			case 'open':
			case 'reveal':
				if (typeof msg.path === 'string') await this.openFile(msg.path, msg.type === 'reveal');
				break;
			case 'store':
				if (typeof msg.key === 'string' && msg.key.length <= 300) await this.remember(msg.key, msg.value);
				break;
		}
	}

	private async remember(key: string, value: unknown) {
		let size = 0;
		try { size = JSON.stringify(value)?.length ?? 0; } catch { return; }
		if (size > MAX_STORED_VALUE) return;
		const all = { ...this.context.workspaceState.get<Record<string, unknown>>(STORE_KEY, {}) };
		all[key] = value;
		await this.context.workspaceState.update(STORE_KEY, all);
	}

	private rescan() { return this.roots.length ? this.scan(this.roots) : this.scanWorkspace(); }

	private async scanWorkspace() {
		const folders = vscode.workspace.workspaceFolders || [];
		if (!folders.length) {
			this.post({ type: 'status', text: 'No folder is open. Showing the sample project; choose a folder to map your own.' });
			return;
		}
		await this.scan(folders.map(f => ({ uri: f.uri, name: f.name })));
	}

	private async scan(roots: MapRoot[]) {
		this.roots = uniqueRoots(roots);
		await this.context.workspaceState.update(ROOTS_KEY, this.roots.map(r => ({ uri: r.uri.toString(), name: r.name })));
		if (!this.panel || !this.ready) return;
		this.scanning?.cancel();
		const cts = this.scanning = new vscode.CancellationTokenSource();
		const scan = ++this.scanId;
		const name = this.roots.length === 1 ? this.roots[0].name : (vscode.workspace.name || 'Workspace');
		const options = readOptions();
		this.panel.title = `Codebase map: ${name}`;
		await this.post({ type: 'begin', scan, name, maxFiles: options.maxFiles, store: this.context.workspaceState.get(STORE_KEY, {}) });
		try {
			const { files, cut } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Mapping codebase' },
				() => collectSources(this.roots, options, cts.token, n => this.post({ type: 'status', text: `Reading files: ${n.toLocaleString()}…`, sticky: true })));
			for (let i = 0; i < files.length && !cts.token.isCancellationRequested; i += BATCH_SIZE) await this.post({ type: 'files', scan, files: files.slice(i, i + BATCH_SIZE) });
			if (!cts.token.isCancellationRequested) await this.post({ type: 'end', scan, cut });
		} catch (error) {
			if (!cts.token.isCancellationRequested) {
				this.post({ type: 'status', text: 'The map could not be built. See the error notification.' });
				vscode.window.showErrorMessage(`Codebase map: ${error instanceof Error ? error.message : String(error)}`);
			}
		} finally {
			if (this.scanning === cts) this.scanning = undefined;
			cts.dispose();
		}
	}

	private savedRoots(): MapRoot[] {
		const saved = this.context.workspaceState.get<{ uri: string; name: string }[]>(ROOTS_KEY, []);
		try { return Array.isArray(saved) ? saved.map(r => ({ uri: vscode.Uri.parse(r.uri), name: String(r.name) })) : []; } catch { return []; }
	}

	private onFileChanged(uri: vscode.Uri) {
		if (!this.ready || this.scanning) return;
		const root = this.roots.find(r => contains(r.uri, uri));
		if (!root || !isMappable(relativeTo(root.uri, uri))) return;
		if (this.staleTimer) clearTimeout(this.staleTimer);
		this.staleTimer = setTimeout(() => { this.staleTimer = undefined; this.post({ type: 'stale' }); }, STALE_DELAY_MS);
	}

	private async openFile(mapPath: string, reveal: boolean) {
		const uri = this.resolve(mapPath);
		if (!uri) return;
		try {
			if (reveal) await vscode.commands.executeCommand('revealInExplorer', uri);
			else await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: false });
		} catch (error) {
			vscode.window.showErrorMessage(`Codebase map: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private post(message: unknown): Thenable<boolean> {
		return this.panel ? this.panel.webview.postMessage(message) : Promise.resolve(false);
	}

	dispose() {
		this.panel?.dispose();
		this.detach();
		this.subscriptions.forEach(s => s.dispose());
	}
}

function baseName(uri: vscode.Uri): string {
	return uri.path.split('/').filter(Boolean).pop() || 'folder';
}
