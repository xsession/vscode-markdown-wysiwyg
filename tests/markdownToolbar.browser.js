// Run npm run test-compile and npm run build:editor first.
// Provide Playwright on NODE_PATH and optionally set CHROMIUM_EXECUTABLE.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { chromium } = require('playwright');

const disposable = () => ({ dispose() {} });
const uri = fsPath => ({ fsPath, toString: () => fsPath });
const root = path.resolve(__dirname, '..');

async function run(browser, directory) {
	const source = path.join(directory, 'source.md');
	const template = path.join(directory, 'demo.j2');
	const mapping = path.join(directory, 'demo.table-template.json');
	const output = path.join(directory, 'generated');
	await fs.writeFile(source, '# Example\n');
	await fs.writeFile(template, '---\nname: Example template\nformat: yml\n---\ntitle: {{ title }}');
	await fs.writeFile(mapping, JSON.stringify({
		format: 'yaml',
		markdown: 'source.md',
		output: 'defaults/board.cfg',
		table: 'devices',
		columns: { ID: { path: ['id'], type: 'string' } }
	}));

	let handler;
	let settings = '';
	let nextSelection;
	let dialog;
	let workspaceFolders;
	let text = '# Example\n';
	const updates = [];
	const errors = [];
	let rejectFolderUpdate = false;
	const commands = [];
	const document = {
		uri: uri(source), fileName: source,
		getText: () => text, lineAt: () => ({ range: { start: { line: 0 } } }),
		get lineCount() { return text.split('\n').length; }
	};
	const vscode = {
		Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
		WorkspaceEdit: class { replace(_uri, _range, replacement) { this.text = replacement; } },
		Range: class {},
		EndOfLine: { CRLF: 2 },
		ViewColumn: { Beside: 2 },
		ConfigurationTarget: { Global: 1, Workspace: 2 },
		commands: { async executeCommand(...args) { commands.push(args); } },
		window: {
			onDidChangeTextEditorVisibleRanges: disposable,
			async showOpenDialog(options) {
				dialog = options;
				const result = nextSelection;
				nextSelection = undefined;
				return result ? [uri(result)] : undefined;
			},
			showErrorMessage: error => errors.push(error),
			showInformationMessage() {},
			async showTextDocument() {}
		},
		workspace: {
			get workspaceFolders() { return workspaceFolders; },
			textDocuments: [document],
			fs: { readFile: target => fs.readFile(target.fsPath) },
			getConfiguration: () => ({
				get: () => settings,
				async update(key, value, target) {
					if (rejectFolderUpdate) throw new Error('Settings unavailable');
					updates.push({ key, value, target });
					settings = value;
				}
			}),
			async applyEdit(edit) { text = edit.text; return true; },
			asRelativePath: target => path.relative(directory, target),
			onDidSaveTextDocument: disposable,
			onDidChangeTextDocument: disposable,
			onDidChangeConfiguration: disposable
		}
	};
	const load = Module._load;
	Module._load = function (id, ...args) {
		return id === 'vscode' ? vscode : load.call(this, id, ...args);
	};
	let MarkdownEditorProvider;
	try {
		({ MarkdownEditorProvider } = require('../out/markdownEditor'));
	} finally {
		Module._load = load;
	}

	const page = await browser.newPage();
	page.setDefaultTimeout(10000);
	const pageErrors = [];
	page.on('pageerror', error => pageErrors.push(error.message));
	const webview = {
		set html(value) {
			assert.equal(typeof handler, 'function', 'Install the listener before loading the webview');
			this.content = value;
		},
		asWebviewUri: target => 'https://editor.test/' + path.relative(root, target.fsPath).split(path.sep).join('/'),
		async postMessage(message) {
			await page.evaluate(data => window.postMessage(data, '*'), message);
			return true;
		},
		onDidReceiveMessage(listener) { handler = listener; return disposable(); }
	};
	const panel = {
		webview, active: true, onDidChangeViewState: disposable, onDidDispose: disposable
	};
	await new MarkdownEditorProvider({ extensionUri: uri(root) }).resolveCustomTextEditor(document, panel);
	await page.exposeFunction('hostMessage', handler);
	await page.addInitScript(() => {
		window.acquireVsCodeApi = () => ({
			postMessage: message => window.hostMessage(message),
			getState: () => null,
			setState() {}
		});
	});
	await page.route('https://editor.test/**', async route => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === '/') {
			await route.fulfill({ contentType: 'text/html', body: webview.content });
		} else {
			await route.fulfill({ path: path.join(root, pathname.slice(1)), contentType: 'application/javascript' });
		}
	});
	await page.goto('https://editor.test/');
	await page.getByRole('heading', { name: 'Example' }).waitFor();
	const button = name => page.getByRole('button', { name, exact: true });
	assert.equal(await button('Generate').isDisabled(), true);

	nextSelection = output;
	await button('Output folder').click();
	await button(output).waitFor();
	assert.equal(dialog.canSelectFolders, true);
	assert.equal(updates[0].target, vscode.ConfigurationTarget.Global);

	workspaceFolders = [{ uri: uri(directory) }];
	const workspaceOutput = path.join(directory, 'workspace-output');
	nextSelection = workspaceOutput;
	await button(output).click();
	await button(workspaceOutput).waitFor();
	assert.equal(updates[1].target, vscode.ConfigurationTarget.Workspace);
	assert.equal(dialog.defaultUri.fsPath, output);
	rejectFolderUpdate = true;
	nextSelection = output;
	await button(workspaceOutput).click();
	await waitUntil(() => errors.length === 1);
	assert.match(errors.shift(), /Settings unavailable/);
	assert.equal(await button(workspaceOutput).isVisible(), true);
	rejectFolderUpdate = false;
	settings = output;

	nextSelection = template;
	await button('Template').click();
	await button('Example template').waitFor();
	assert.equal(dialog.defaultUri.fsPath, directory);
	assert.equal(await button('Generate').isEnabled(), true);
	await button('YAML (.yml)').click();
	assert.equal(await button('Word (.docx)').count(), 0);
	await button('JSON (.json)').click();
	await button('Generate').click();
	await page.waitForFunction(() => window.markdownToolbar.getState().format === 'json');
	await waitForFile(path.join(output, 'source.json'), 'title: Example');

	// Opening the dialog and cancelling retains the previous selection.
	await button('Example template').click();
	assert.equal(await button('Example template').isVisible(), true);

	nextSelection = source;
	await button('Example template').click();
	await waitUntil(() => errors.length === 1);
	assert.match(errors.shift(), /Choose a Jinja template/);
	assert.equal(await button('Example template').isVisible(), true);

	// A host echo with unchanged text must not suppress the next actual edit.
	const current = await page.evaluate(() => window.editor.getData());
	await webview.postMessage({ type: 'documentChanged', text: current });
	await page.evaluate(() => window.editor.setData('# New title'));
	await button('Generate').click();
	await waitForFile(path.join(output, 'source.json'), 'title: New title');

	nextSelection = mapping;
	await button('Example template').click();
	await button('demo').waitFor();
	await button('YAML (.yml)').waitFor();
	const table = '<!-- table-sync:devices -->\n| ID |\n| --- |\n| UART |\n<!-- /table-sync:devices -->\n';
	text = table;
	settings = '';
	await button('Generate').click();
	await waitForFile(path.join(directory, 'defaults/board.cfg'), 'id: UART', true);

	for (const [label, command, args] of [
		['Documentation mind map', 'markdownEditor.documentation.mindmap', []],
		['Read document aloud', 'markdownEditor.readAloud', [document.uri]],
		['Open document in documentation view', 'markdownEditor.documentation.open', [undefined, document.uri]],
		['Listen to document', 'markdownEditor.documentation.listen', [undefined, document.uri]]
	]) {
		await button(label).click();
		await waitUntil(() => commands.some(call => call[0] === command));
		assert.deepEqual(commands.find(call => call[0] === command), [command, ...args]);
	}

	assert.deepEqual(pageErrors, []);
	assert.deepEqual(errors, []);
	await page.close();
}

async function waitUntil(condition) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await condition()) return;
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	assert.fail('Timed out waiting for the toolbar action');
}

async function waitForFile(file, expected, substring = false) {
	await waitUntil(async () => {
		const actual = await fs.readFile(file, 'utf8').catch(() => '');
		return substring ? actual.includes(expected) : actual === expected;
	});
}

(async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-toolbar-'));
	let browser;
	try {
		const portable = process.env.CHROMIUM_PACKAGE ? require(process.env.CHROMIUM_PACKAGE).default : undefined;
		const executablePath = process.env.CHROMIUM_EXECUTABLE || await portable?.executablePath();
		browser = await chromium.launch({ executablePath, args: portable?.args || ['--no-sandbox'] });
		await run(browser, directory);
		console.log('Markdown toolbar browser test passed: both pickers, format overrides, generation and document actions');
	} finally {
		await browser?.close();
		await fs.rm(directory, { recursive: true, force: true });
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
