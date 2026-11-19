// Run npm run test-compile and npm run build:editor first.
// Provide Playwright on NODE_PATH and optionally set CHROMIUM_EXECUTABLE.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { chromium } = require('playwright');

const disposable = () => ({ dispose() {} });
const uri = fsPath => ({ fsPath, scheme: 'file', toString: () => fsPath });
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
	const saveListeners = new Set();
	const onSave = saved => Promise.all([...saveListeners].map(listener => listener(saved)));
	const outputWatchers = new Set();
	const warnings = [];
	let onDispose;
	let documentMessages = 0;
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
		getText: () => text,
		async save() { await fs.writeFile(source, text); await onSave(document); return true; },
		lineAt: () => ({ range: { start: { line: 0 } } }),
		get lineCount() { return text.split('\n').length; }
	};
	const vscode = {
		Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
		WorkspaceEdit: class { replace(_uri, _range, replacement) { this.text = replacement; } },
		Range: class {},
		RelativePattern: class {},
		EndOfLine: { CRLF: 2 },
		ViewColumn: { Beside: 2 },
		ConfigurationTarget: { Global: 1, Workspace: 2 },
		commands: { async executeCommand(...args) {
			commands.push(args);
			if (args[0] === 'markdownEditor.createJinjaTemplate') {
				return { sourceUri: document.uri.toString(), path: 'from-examples.j2', name: 'Example-derived template', format: 'json' };
			}
		} },
		window: {
			onDidChangeTextEditorVisibleRanges: disposable,
			async showOpenDialog(options) {
				dialog = options;
				const result = nextSelection;
				nextSelection = undefined;
				return result ? [uri(result)] : undefined;
			},
			showErrorMessage: error => errors.push(error),
			showWarningMessage: warning => warnings.push(warning),
			visibleTextEditors: [],
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
			async openTextDocument(target) { assert.equal(target.fsPath, source); return document; },
			onDidSaveTextDocument(listener) {
				saveListeners.add(listener);
				return { dispose: () => saveListeners.delete(listener) };
			},
			createFileSystemWatcher() {
				let changed;
				return {
					onDidChange(listener) { changed = listener; outputWatchers.add(listener); return disposable(); },
					onDidCreate: disposable,
					dispose() { outputWatchers.delete(changed); }
				};
			},
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
			if (message.type === 'documentChanged') documentMessages++;
			await page.evaluate(data => window.postMessage(data, '*'), message);
			return true;
		},
		onDidReceiveMessage(listener) { handler = listener; return disposable(); }
	};
	const panel = {
		webview, active: true, onDidChangeViewState: disposable,
		onDidDispose(listener) { onDispose = listener; return disposable(); }
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
	const mappedOutput = path.join(directory, 'defaults/board.cfg');
	await waitForFile(mappedOutput, 'id: UART', true);
	await waitUntil(() => outputWatchers.size === 1);
	await fs.writeFile(mappedOutput, 'devices:\n  - id: SPI\n');
	await onSave({ uri: uri(mappedOutput) });
	await waitUntil(() => text.includes('SPI') || warnings.length > 0);
	assert.deepEqual(warnings, []);
	await editableFor(page).locator('td').getByText('SPI', { exact: true }).waitFor();
	assert.match(await fs.readFile(source, 'utf8'), /\| SPI \|/);
	await editableFor(page).evaluate(() => window.editor.setData('| ID |\n| --- |\n| I2C |'));
	await waitUntil(() => text.includes('I2C') || errors.length > 0);
	assert.match(text, /<!-- table-sync:devices -->[\s\S]*I2C[\s\S]*<!-- \/table-sync:devices -->/);

	const conflictingSource = text + '\nIndependent source edit.\n';
	text = conflictingSource;
	await fs.writeFile(mappedOutput, 'devices:\n  - id: CAN\n');
	for (const notify of outputWatchers) notify(uri(mappedOutput));
	await waitUntil(() => warnings.some(message => /source also changed/.test(message)));
	assert.equal(text, conflictingSource);
	assert.match(await fs.readFile(mappedOutput, 'utf8'), /CAN/);

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

	const editable = editableFor(page);
	const nested = editable.locator('td table');
	await editable.evaluate(() => {
		const editor = window.editor;
		editor.setData('| Name | Description |\n| --- | --- |\n| UART | Before |\n\nAfter document');
		const cell = editor.model.document.getRoot().getNodeByPath([0, 1, 1]);
		editor.model.change(writer => writer.setSelection(cell.getChild(0), 'end'));
	});
	await button('Insert table').click();
	await page.locator('.ck-insert-table-dropdown-grid-box').first().click();
	await nested.waitFor();
	await waitUntil(() => /^\|.*UART.*<table[ >]/m.test(text));
	const messagesBeforeSave = documentMessages;
	await onSave(document);
	assert.equal(documentMessages, messagesBeforeSave, 'Auto-save must not echo an edit back to its source panel');
	await editable.evaluate(() => {
		const editor = window.editor;
		editor.model.change(writer => writer.insertText('Inner | **literal** & <tag>', editor.model.document.selection.getFirstPosition()));
	});
	await waitUntil(() => text.includes('Inner'));
	assert.match(text, /^\|.*UART.*<table[ >]/m, 'Store the nested table inside the parent pipe-table row');
	await fs.writeFile(source, text);
	await onSave(document);
	text = await fs.readFile(source, 'utf8');
	await page.reload();
	await nested.waitFor();
	assert.match(await nested.textContent(), /Inner \| \*\*literal\*\* & <tag>/);
	assert.equal(await editable.locator('> figure.table').count(), 1);
	assert.match(await editable.textContent(), /After document/);

	await editable.evaluate(() => window.editor.setData(
		'<table><tr><td><table><tr><td></td></tr></table></td></tr></table>'
	));
	await waitUntil(() => /^<table[ >].*<table[ >]/m.test(text));
	await page.reload();
	await nested.waitFor();
	assert.equal(await editable.locator('> figure.table').count(), 1);

	const registerMap = await fs.readFile(path.join(__dirname, 'fixtures/register-map-demo.md'), 'utf8');
	text = registerMap;
	await onSave(document);
	await nested.getByText('DemoBoardA', { exact: true }).waitFor();
	const roundTripped = await editable.evaluate(() => window.editor.getData());
	const { buildMarkdownContext, rowDoc, rowSubRows } = require('../out/markdownTables');
	const original = buildMarkdownContext(registerMap, 'register-map-demo.md');
	const restored = buildMarkdownContext(roundTripped, 'register-map-demo.md');
	assert.deepEqual(restored.rows.map(rowSubRows), original.rows.map(rowSubRows));
	assert.deepEqual(restored.rows.map(rowDoc), original.rows.map(rowDoc));

	const builtinTemplate = path.join(root, 'templates', 'register-map-to-json.j2');
	nextSelection = builtinTemplate;
	await button('Template').click();
	await button('Register map to JSON').waitFor();
	settings = output;
	await button('Generate').click();
	const registerOutput = path.join(output, 'source.json');
	await waitForFile(registerOutput, '"types"', true);
	await waitUntil(() => outputWatchers.size === 2);
	const exported = JSON.parse(await fs.readFile(registerOutput, 'utf8'));
	exported.types.deviceId.doc = 'Edited from JSON';
	await fs.writeFile(registerOutput, JSON.stringify(exported, null, 2));
	await onSave({ uri: uri(registerOutput) });
	await editable.getByText('Edited from JSON', { exact: true }).waitFor();
	assert.match(await fs.readFile(source, 'utf8'), /Edited from JSON/);

	await button('Create Jinja template from examples').click();
	await button('Example-derived template').waitFor();
	assert.deepEqual(commands.find(args => args[0] === 'markdownEditor.createJinjaTemplate'),
		['markdownEditor.createJinjaTemplate', document.uri]);

	assert.deepEqual(pageErrors, []);
	assert.deepEqual(errors, []);
	onDispose();
	exported.types.deviceId.doc = 'Edited after closing Markdown';
	await fs.writeFile(registerOutput, JSON.stringify(exported, null, 2));
	for (const notify of outputWatchers) notify(uri(registerOutput));
	await waitForFile(source, 'Edited after closing Markdown', true);
	await page.close();
}

function editableFor(page) {
	return page.locator('.ck-editor__editable_inline');
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
		console.log('Markdown toolbar browser test passed: both pickers, format overrides, generation, template creation, reverse output saves, conflicts and nested-table save/reload');
	} finally {
		await browser?.close();
		await fs.rm(directory, { recursive: true, force: true });
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
