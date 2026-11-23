// Builds stand-alone HTML pages of the extension's webviews for documentation
// screenshots. Each page uses the real webview markup, styles and scripts, VS
// Code theme variables (Light Modern / Dark Modern) and a stand-in for
// acquireVsCodeApi. Run `npm run test-compile` (and `npm run build:editor` for
// the editor page) first.
//
// Usage: node scripts/docs/webview-pages.js <output-dir>
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] || path.join(root, '.docs-tools', 'pages'));
fs.mkdirSync(outDir, { recursive: true });
const fileUrl = (p) => pathToFileURL(p).href;

// A subset of VS Code's theme variables, enough for the webviews' styles.
const THEMES = {
	light: {
		'font-family': "system-ui, 'Segoe UI', Ubuntu, sans-serif", 'font-size': '13px', 'font-weight': 'normal',
		'editor-font-family': "'Droid Sans Mono', monospace", 'editor-font-size': '14px',
		foreground: '#3b3b3b', descriptionForeground: '#3b3b3b', errorForeground: '#f85149', focusBorder: '#005fb8',
		'editor-background': '#ffffff', 'editor-foreground': '#3b3b3b', 'editorWidget-background': '#f8f8f8',
		'editorWidget-border': '#e5e5e5', 'sideBar-background': '#f8f8f8', 'panel-background': '#f8f8f8', 'panel-border': '#e5e5e5',
		'button-background': '#005fb8', 'button-foreground': '#ffffff', 'button-hoverBackground': '#0258a8',
		'button-secondaryBackground': '#e5e5e5', 'button-secondaryForeground': '#3b3b3b', 'button-secondaryHoverBackground': '#cccccc',
		'input-background': '#ffffff', 'input-foreground': '#3b3b3b', 'input-border': '#cecece', 'input-placeholderForeground': '#767676',
		'dropdown-background': '#ffffff', 'dropdown-foreground': '#3b3b3b', 'dropdown-border': '#cecece',
		'checkbox-background': '#f8f8f8', 'checkbox-border': '#cecece', 'list-hoverBackground': '#f2f2f2',
		'list-activeSelectionBackground': '#e8e8e8', 'list-activeSelectionForeground': '#000000',
		'textLink-foreground': '#005fb8', 'textLink-activeForeground': '#005fb8', 'textBlockQuote-background': '#f8f8f8',
		'textCodeBlock-background': '#f8f8f8', 'textPreformat-foreground': '#3b3b3b', 'widget-shadow': 'rgba(0,0,0,0.16)',
		'toolbar-hoverBackground': 'rgba(184,184,184,0.31)', 'icon-foreground': '#3b3b3b', 'badge-background': '#cccccc', 'badge-foreground': '#3b3b3b',
		'panelTitle-activeForeground': '#3b3b3b', 'panelTitle-activeBorder': '#005fb8', 'panelTitle-inactiveForeground': '#3b3b3b',
		'inputValidation-warningBackground': '#fffbe6', 'inputValidation-warningBorder': '#bf8803', 'editorWarning-foreground': '#bf8803',
		'editor-selectionBackground': '#add6ff', 'editor-findMatchHighlightBackground': 'rgba(234,92,0,0.33)',
		'scrollbarSlider-background': 'rgba(100,100,100,0.4)', 'progressBar-background': '#005fb8', 'contrastBorder': 'transparent',
	},
	dark: {
		'font-family': "system-ui, 'Segoe UI', Ubuntu, sans-serif", 'font-size': '13px', 'font-weight': 'normal',
		'editor-font-family': "'Droid Sans Mono', monospace", 'editor-font-size': '14px',
		foreground: '#cccccc', descriptionForeground: '#9d9d9d', errorForeground: '#f85149', focusBorder: '#0078d4',
		'editor-background': '#1f1f1f', 'editor-foreground': '#cccccc', 'editorWidget-background': '#202020',
		'editorWidget-border': '#454545', 'sideBar-background': '#181818', 'panel-background': '#181818', 'panel-border': '#2b2b2b',
		'button-background': '#0078d4', 'button-foreground': '#ffffff', 'button-hoverBackground': '#026ec1',
		'button-secondaryBackground': '#313131', 'button-secondaryForeground': '#cccccc', 'button-secondaryHoverBackground': '#3c3c3c',
		'input-background': '#313131', 'input-foreground': '#cccccc', 'input-border': '#3c3c3c', 'input-placeholderForeground': '#989898',
		'dropdown-background': '#313131', 'dropdown-foreground': '#cccccc', 'dropdown-border': '#3c3c3c',
		'checkbox-background': '#313131', 'checkbox-border': '#3c3c3c', 'list-hoverBackground': '#2a2d2e',
		'list-activeSelectionBackground': '#04395e', 'list-activeSelectionForeground': '#ffffff',
		'textLink-foreground': '#4daafc', 'textLink-activeForeground': '#4daafc', 'textBlockQuote-background': '#2b2b2b',
		'textCodeBlock-background': '#2b2b2b', 'textPreformat-foreground': '#d0d0d0', 'widget-shadow': 'rgba(0,0,0,0.36)',
		'toolbar-hoverBackground': 'rgba(90,93,94,0.31)', 'icon-foreground': '#cccccc', 'badge-background': '#616161', 'badge-foreground': '#f8f8f8',
		'panelTitle-activeForeground': '#cccccc', 'panelTitle-activeBorder': '#0078d4', 'panelTitle-inactiveForeground': '#9d9d9d',
		'inputValidation-warningBackground': '#352a05', 'inputValidation-warningBorder': '#b89500', 'editorWarning-foreground': '#cca700',
		'editor-selectionBackground': '#264f78', 'editor-findMatchHighlightBackground': 'rgba(234,92,0,0.33)',
		'scrollbarSlider-background': 'rgba(121,121,121,0.4)', 'progressBar-background': '#0078d4', 'contrastBorder': 'transparent',
	},
};
const themeStyle = (mode) =>
	`html{${Object.entries(THEMES[mode]).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}` +
	'body{margin:0;padding:0 20px;background:var(--vscode-editor-background);color:var(--vscode-foreground);' +
	'font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}';
const bodyClass = (mode) => (mode === 'dark' ? 'vscode-dark' : 'vscode-light');
const stub = 'window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m),getState:()=>undefined,setState:()=>{}});';
const write = (name, html) => {
	fs.writeFileSync(path.join(outDir, name), html);
	console.log('wrote', path.join(outDir, name));
};

// --- Codebase map -----------------------------------------------------------
for (const mode of ['light', 'dark']) {
	const body = fs.readFileSync(path.join(root, 'media/codebaseMap.body.html'), 'utf8');
	write(`codebase-map-${mode}.html`, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>${themeStyle(mode)}</style><link rel="stylesheet" href="${fileUrl(path.join(root, 'media/codebaseMap.css'))}">
<script>${stub}</script></head><body class="${bodyClass(mode)}" style="padding:0">${body}
<script src="${fileUrl(path.join(root, 'media/codebaseMap.js'))}"></script></body></html>`);
}

// --- Reader -------------------------------------------------------------------
{
	const { readerHtml } = require(path.join(root, 'out/readerHtml'));
	for (const mode of ['light', 'dark']) {
		let html = readerHtml().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
		html = html.replace('<head>', `<head><style>${themeStyle(mode)}</style><script>${stub}</script>`);
		html = html.replace(/<body([^>]*)>/, `<body$1 class="${bodyClass(mode)}">`);
		write(`reader-${mode}.html`, html);
	}
}

// --- Documentation mind map --------------------------------------------------
{
	const provider = fs.readFileSync(path.join(root, 'src/documentationExplorer.ts'), 'utf8');
	const template = provider.match(/panel.webview.html = `([\s\S]*?)`;/)[1];
	const { documentationTree } = require(path.join(root, 'out/documentationIndex'));
	const docs = path.join(root, 'docs');
	const files = [];
	for (const dir of ['getting_started', 'tutorials', 'theory_of_operation']) {
		for (const name of fs.readdirSync(path.join(docs, dir)).filter((n) => n.endsWith('.md')).sort()) {
			const full = path.join(docs, dir, name);
			files.push({ path: 'docs/' + dir + '/' + name, uri: fileUrl(full), text: fs.readFileSync(full, 'utf8') });
		}
	}
	const tree = documentationTree(files);
	// Progress badges as the listening workspace would report them.
	const mark = (node) => {
		if (node.kind === 'file' && /listen_to_a_document|first_tour/.test(node.uri)) Object.assign(node, { progress: node.uri.includes('first_tour') ? 100 : 45, completed: node.uri.includes('first_tour'), bookmarks: 2 });
		if (node.kind === 'file' && /speech_pipeline/.test(node.uri)) Object.assign(node, { current: true, progress: 20 });
		node.children.forEach(mark);
	};
	mark(tree);
	for (const mode of ['light', 'dark']) {
		let html = template
			.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
			.replace(/<link[^>]*>/, `<link rel="stylesheet" href="${fileUrl(path.join(root, 'media/documentationMap.css'))}">`)
			.replace(/<script[\s\S]*?<\/script>/, `<script>${stub}</script><script src="${fileUrl(path.join(root, 'media/documentationMap.js'))}"></script>`)
			.replace(/\$\{[^}]*\}/g, '');
		html = html.replace('<head>', `<head><style>${themeStyle(mode)}</style>`).replace(/<body([^>]*)>/, `<body$1 class="${bodyClass(mode)}">`);
		html = html.replace('</body>', `<script>window.addEventListener('load',()=>setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'index',root:${JSON.stringify(tree)},status:'${files.length} documents'}})),50));</script></body>`);
		write(`mindmap-${mode}.html`, html);
	}
}

// --- WYSIWYG editor -----------------------------------------------------------
if (fs.existsSync(path.join(root, 'ckeditor5-build-markdown/build/ckeditor.js'))) {
	const original = Module._load;
	const disposable = () => ({ dispose() {} });
	const uri = (fsPath) => ({ fsPath, path: fsPath, scheme: 'file', toString: () => fsPath });
	const vscode = {
		Uri: { file: uri, parse: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
		ViewColumn: { Beside: 2 }, ConfigurationTarget: { Global: 1 }, EndOfLine: { LF: 1, CRLF: 2 },
		WorkspaceEdit: class { replace() {} }, Range: class {}, RelativePattern: class {},
		commands: { executeCommand: async () => undefined, registerCommand: () => disposable() },
		window: { showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {}, visibleTextEditors: [] },
		workspace: {
			getConfiguration: () => ({ get: (_k, d) => d }), onDidSaveTextDocument: () => disposable(),
			onDidChangeConfiguration: () => disposable(), onDidChangeTextDocument: () => disposable(), textDocuments: [],
			workspaceFolders: [{ uri: uri(root) }], asRelativePath: (p) => String(p),
		},
	};
	Module._load = function (id, ...args) {
		return id === 'vscode' ? vscode : original.call(this, id, ...args);
	};
	const { MarkdownEditorProvider } = require(path.join(root, 'out/markdownEditor'));
	Module._load = original;
	let html = '';
	const webview = {
		options: {}, cspSource: 'file:', asWebviewUri: (u) => fileUrl(u.fsPath),
		set html(v) { html = v; }, get html() { return html; },
		onDidReceiveMessage: () => disposable(), postMessage: async () => true,
	};
	const panel = { webview, onDidDispose: () => disposable(), onDidChangeViewState: () => disposable(), active: true, visible: true };
	const text = fs.readFileSync(path.join(__dirname, 'editor-sample.md'), 'utf8');
	const document = { uri: uri(path.join(root, 'design-note.md')), fileName: 'design-note.md', getText: () => text, lineCount: text.split('\n').length, eol: 1 };
	Promise.resolve(new MarkdownEditorProvider({ extensionUri: uri(root), workspaceState: { get: () => undefined, update: async () => {} } }).resolveCustomTextEditor(document, panel, {}))
		.then(() => {
			for (const mode of ['light', 'dark']) {
				let page = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
				const editorStub = stub.replace('postMessage:m=>window.messages.push(m)', "postMessage:m=>{window.messages.push(m);if(m.type==='initialized')setTimeout(()=>window.postMessage({type:'documentChanged',text:" + JSON.stringify(text) + "},'*'),0);}");
				page = page.replace('<head>', `<head><style>${themeStyle(mode)}</style><script>${editorStub}</script>`);
				page = page.replace(/<body([^>]*)>/, `<body$1 class="${bodyClass(mode)}">`);
				write(`editor-${mode}.html`, page);
			}
		})
		.catch((e) => {
			console.error('editor page failed:', e);
			process.exitCode = 1;
		});
} else {
	console.warn('ckeditor5-build-markdown/build/ckeditor.js is missing: run npm run build:editor for the editor page');
}
