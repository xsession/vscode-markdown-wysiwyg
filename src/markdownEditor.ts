import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { extensionState } from './extension';
import { generateFromTemplate, extensionForFormat, GenerationError, TemplateMapping } from './codeGenerator';
import { renderTemplate, splitTemplateFile, TemplateError } from './jinjaTemplate';
import {
	buildMarkdownContext,
	fingerprintsFromDocument,
	diffFingerprints,
	findRegisterSpan,
	Fingerprint
} from './markdownTables';

const prettier = require('prettier');

const TABLE_TEMPLATE_SUFFIX = '.table-template.json';
const JINJA_TEMPLATE_EXTS = new Set(['.j2', '.jinja', '.jnt']);

function isJinjaTemplate(filePath: string): boolean {
	return JINJA_TEMPLATE_EXTS.has(path.extname(filePath).toLowerCase());
}

function readTableMapping(raw: string): TemplateMapping {
	const mapping = JSON.parse(raw.replace(/^\uFEFF/, ''));
	if (!mapping || typeof mapping.markdown !== 'string' || !mapping.markdown ||
		typeof mapping.output !== 'string' || !mapping.output ||
		typeof mapping.table !== 'string' || !mapping.table ||
		(mapping.format !== undefined && typeof mapping.format !== 'string') ||
		!mapping.columns || typeof mapping.columns !== 'object' || Array.isArray(mapping.columns)) {
		throw new GenerationError('The table template requires "markdown", "output", "table" and "columns".');
	}
	return mapping;
}

function normalizeOutputFormat(format: string): string {
	const name = format.trim().toLowerCase();
	switch (name) {
		case 'yml': return 'yaml';
		case 'htm': return 'html';
		case 'md': return 'markdown';
		default: return name;
	}
}

function mappingOutputFormat(mapping: TemplateMapping): string {
	const file = path.basename(mapping.output);
	const extension = path.extname(file).slice(1) || (file.startsWith('.') ? file.slice(1) : '');
	return normalizeOutputFormat(mapping.format || extension);
}

function assertOutputIsSeparate(output: string, ...inputs: string[]): void {
	const resolved = (filePath: string) => {
		const absolute = path.resolve(filePath);
		return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
	};
	if (inputs.some((input) => resolved(input) === resolved(output))) {
		throw new GenerationError('Choose an output folder or file name that differs from the source and template.');
	}
}

// Where generated output files are written: the markdownEditor.outputFolder
// setting (absolute, or relative to the workspace root), chosen through the
// toolbar's file-browser button.
function currentOutputFolder(): string {
	const configured = vscode.workspace.getConfiguration('markdownEditor').get<string>('outputFolder', '') || '';
	if (!configured) {
		return '';
	}
	if (path.isAbsolute(configured)) {
		return configured;
	}
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	return root ? path.join(root, configured) : configured;
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new MarkdownEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(
			MarkdownEditorProvider.viewType,
			provider,
			{
				webviewOptions: { retainContextWhenHidden: true },
			}
		);
		return providerRegistration;
	}

	static readonly viewType = 'markdownEditor.customEditor';

	constructor(private readonly context: vscode.ExtensionContext) {}

	// Live input -> output link: after a Jinja generation, editing a section
	// in the open document re-renders the output file and scrolls the output
	// editor to that section (see liveSync / doLiveSync).
	private liveSessions = new Map<
		vscode.WebviewPanel,
		{ templatePath: string; outputAbs: string; format: string; fingerprints: Fingerprint[] }
	>();
	private liveSyncTimers = new Map<vscode.WebviewPanel, NodeJS.Timeout>();

	// Debounced: one live re-render per burst of keystrokes per editor.
	private liveSync(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument): void {
		if (!this.liveSessions.has(webviewPanel)) return;
		const pending = this.liveSyncTimers.get(webviewPanel);
		if (pending) clearTimeout(pending);
		this.liveSyncTimers.set(
			webviewPanel,
			setTimeout(() => {
				this.liveSyncTimers.delete(webviewPanel);
				const session = this.liveSessions.get(webviewPanel);
				if (session) void this.doLiveSync(session, document);
			}, 400)
		);
	}

	private async doLiveSync(
		session: { templatePath: string; outputAbs: string; format: string; fingerprints: Fingerprint[] },
		document: vscode.TextDocument
	): Promise<void> {
		try {
			const text = document.getText();
			const newFingerprints = fingerprintsFromDocument(text);
			const changed = diffFingerprints(session.fingerprints, newFingerprints);
			if (changed === null) return; // nothing section-visible changed

			// Render the template against the current document text.
			const raw = await fs.promises.readFile(session.templatePath, 'utf8');
			const { params, body } = splitTemplateFile(raw);
			const context = buildMarkdownContext(text, path.basename(document.fileName));
			context.params = params;
			const output = renderTemplate(body, context);

			// Never clobber unsaved user edits in the output file.
			const outDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === session.outputAbs);
			const skipWrite = outDoc ? outDoc.isDirty : false;
			let shown = output;
			if (skipWrite) {
				try {
					shown = await fs.promises.readFile(session.outputAbs, 'utf8');
				} catch {
					shown = output;
				}
			} else {
				await fs.promises.mkdir(path.dirname(session.outputAbs), { recursive: true });
				await fs.promises.writeFile(session.outputAbs, output, 'utf8');
			}

			session.fingerprints = newFingerprints;

			// Scroll the output editor to the changed section and select it.
			const span = findRegisterSpan(shown, session.format, changed);
			if (!span) return; // section removed — the file was still updated
			const editor = vscode.window.visibleTextEditors.find(
				(ed) => ed.document.uri.fsPath === session.outputAbs
			);
			if (!editor) return;
			const endLine = Math.min(span.end, editor.document.lineCount - 1);
			const range = new vscode.Range(span.start, 0, endLine, 0);
			editor.selection = new vscode.Selection(range.start, range.end);
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		} catch (err) {
			console.warn('Markdown Editor: live sync skipped:', err);
		}
	}

	private sendOutputFolder(webviewPanel: vscode.WebviewPanel) {
		return webviewPanel.webview.postMessage({ type: 'outputFolder', folder: currentOutputFolder() });
	}

	private async pickOutputFolder(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
		const current = currentOutputFolder();
		const dirs = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			defaultUri: path.isAbsolute(current) ? vscode.Uri.file(current) : this.documentDirectory(document),
			openLabel: 'Set as generation output folder',
		});
		const dir = dirs?.[0];
		if (!dir) return;
		const target = vscode.workspace.workspaceFolders?.length
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
		await vscode.workspace.getConfiguration('markdownEditor').update('outputFolder', dir.fsPath, target);
		await this.sendOutputFolder(webviewPanel);
	}

	private documentDirectory(document: vscode.TextDocument): vscode.Uri | undefined {
		return document.isUntitled
			? vscode.workspace.workspaceFolders?.[0]?.uri
			: vscode.Uri.joinPath(document.uri, '..');
	}

	private async pickTemplate(webviewPanel: vscode.WebviewPanel, document: vscode.TextDocument) {
		const files = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			defaultUri: this.documentDirectory(document),
			openLabel: 'Select conversion template',
			filters: {
				'Conversion templates': ['j2', 'jinja', 'jnt', 'json'],
				'All files': ['*']
			}
		});
		const file = files?.[0];
		if (!file) return;
		const baseName = path.basename(file.fsPath);
		const jinja = isJinjaTemplate(baseName);
		if (!jinja && !baseName.toLowerCase().endsWith(TABLE_TEMPLATE_SUFFIX)) {
			throw new GenerationError('Choose a Jinja template (.j2, .jinja, .jnt) or a .table-template.json mapping.');
		}

		const raw = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8');
		let name: string;
		let format: string;
		if (jinja) {
			const { metadata, body } = splitTemplateFile(raw);
			if (!body.trim()) throw new GenerationError(`Template "${baseName}" has no Jinja body.`);
			name = metadata.name || baseName;
			format = normalizeOutputFormat(metadata.format || 'yaml');
		} else {
			const mapping = readTableMapping(raw);
			name = baseName.slice(0, -TABLE_TEMPLATE_SUFFIX.length);
			format = mappingOutputFormat(mapping);
		}
		await webviewPanel.webview.postMessage({
			type: 'templatePicked', path: file.fsPath, name, format, kind: jinja ? 'jinja' : 'mapping'
		});
	}

	private async executeDocumentCommand(document: vscode.TextDocument, command: string) {
		switch (command) {
			case 'markdownEditor.documentation.mindmap':
				await vscode.commands.executeCommand(command);
				break;
			case 'markdownEditor.readAloud':
				await vscode.commands.executeCommand(command, document.uri);
				break;
			case 'markdownEditor.documentation.open':
			case 'markdownEditor.documentation.listen':
				await vscode.commands.executeCommand(command, undefined, document.uri);
				break;
		}
	}

	// Called when our custom editor is opened.
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial webview HTML and settings
		webviewPanel.webview.options = { enableScripts: true };

		// Update global state when a webview is focused.
		function handleFocusChange(panel: vscode.WebviewPanel, initialLoadFlag = false) {
			console.log('handleFocusChange', panel.active);
			if (panel.active) {
				extensionState.activeDocument = document;
				extensionState.activeWebviewPanel = panel;
				// This is used in the contibution point "when" clauses indicating which icons and hotkeys to activate
				vscode.commands
					.executeCommand('setContext', 'markdownEditor.editorIsActive', true)
					.then(() => {
						console.log('markdownEditor.editorIsActive', true);
					});
			} else if (!panel.active && panel === extensionState.activeWebviewPanel) {
				vscode.commands
					.executeCommand('setContext', 'markdownEditor.editorIsActive', false)
					.then(() => {
						console.log('markdownEditor.editorIsActive', false);
					});
			}

			console.log(
				`${initialLoadFlag ? '(Initial Load)' : '(onDidChangeViewState)'} Active: ${
					panel.active
				} - ${document?.uri.toString()}`
			);
		}

		// We need to manually trigger this once inside of resolveCustomTextEditor since onDidChangeViewState does not run on initial load.
		handleFocusChange(webviewPanel, true);

		webviewPanel.onDidChangeViewState((e) => {
			handleFocusChange(e.webviewPanel);
		});

		////////////////////////////////////////////////////////////////////////////////////////
		// Hook up event handlers so that we can synchronize the webview with the text document.
		//
		// The text document acts as our model, so we have to sync changes in the document to our
		// editor and sync changes in the editor back to the document.
		//
		// Remember that a single text document can also be shared between multiple custom
		// editors (this happens for example when you split a custom editor)

		function updateWebview() {
			let text = document.getText();

			// CKEditor uses LF internally.
			text = text.replace(/(?:\r\n|\r|\n)/g, '\n');

			webviewPanel.webview.postMessage({ type: 'documentChanged', text: text });
		}

		const saveDocumentSubscription = vscode.workspace.onDidSaveTextDocument((saved) => {
			if (saved === document) updateWebview();
		});

		const onDidChangeOutputFolder = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('markdownEditor.outputFolder')) {
				void this.sendOutputFolder(webviewPanel);
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			if (extensionState.activeWebviewPanel === webviewPanel) {
				vscode.commands
					.executeCommand('setContext', 'markdownEditor.editorIsActive', false)
					.then(() => {
						console.log('markdownEditor.editorIsActive', false);
					});
			}
			const liveTimer = this.liveSyncTimers.get(webviewPanel);
			if (liveTimer) clearTimeout(liveTimer);
			this.liveSyncTimers.delete(webviewPanel);
			this.liveSessions.delete(webviewPanel);
			saveDocumentSubscription.dispose();
			onDidChangeOutputFolder.dispose();
		});

		// Receive message from the webview.
		let pendingEdit = Promise.resolve();
		webviewPanel.webview.onDidReceiveMessage(async (e) => {
			try {
				switch (e?.type) {
					case 'webviewChanged':
						if (typeof e.text === 'string') {
							const edit = pendingEdit.then(() => this.updateTextDocument(document, e.text));
							pendingEdit = edit.catch(() => undefined);
							await edit;
							this.liveSync(webviewPanel, document);
						}
						break;
					case 'initialized':
						updateWebview();
						await this.sendOutputFolder(webviewPanel);
						break;
					case 'plainPaste':
						await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
						break;
					case 'generateRequest':
						await pendingEdit;
						await this.handleGenerateRequest(e, document, webviewPanel);
						break;
					case 'pickTemplate':
						await this.pickTemplate(webviewPanel, document);
						break;
					case 'pickOutputFolder':
						await this.pickOutputFolder(webviewPanel, document);
						break;
					case 'executeCommand':
						await pendingEdit;
						await this.executeDocumentCommand(document, e.command);
						break;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				void vscode.window.showErrorMessage(`Markdown Editor: ${message}`);
			}
		});
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
	}

	// Generate output with a Jinja conversion template: read the template
	// file, render its body against the opened Markdown document, and write
	// the result into the output folder with the selected format's extension
	// (or the format the template declares).
	private async generateWithJinjaTemplate(
		e: any,
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		const templatePath: string = e.template;
		const format = typeof e.format === 'string' ? normalizeOutputFormat(e.format) : null;
		const baseName = path.basename(templatePath);

		let raw: string;
		try {
			raw = await fs.promises.readFile(templatePath, 'utf8');
		} catch (err: any) {
			vscode.window.showErrorMessage(
				`Markdown Editor: could not read template "${baseName}": ${err?.message ?? err}`
			);
			return;
		}

		const { metadata, params, body } = splitTemplateFile(raw);
		if (!body.trim()) {
			vscode.window.showErrorMessage(
				`Markdown Editor: template "${baseName}" has no Jinja body.`
			);
			return;
		}
		const requestedFormat = format ?? normalizeOutputFormat(metadata.format || 'yaml');
		if (!/^[a-z0-9_-]+$/.test(requestedFormat)) {
			throw new GenerationError('Choose a valid output format.');
		}
		if (requestedFormat === 'docx') {
			throw new GenerationError('Choose a table-template mapping to generate a Word document.');
		}

		let outAbs: string;
		let usedFolder = '';
		try {
			const context = buildMarkdownContext(document.getText(), path.basename(document.fileName));
			context.params = params;
			const text = renderTemplate(body, context);
			// Output name: the template's "output" basename when declared,
			// otherwise the opened document's basename; extension from format.
			const base = metadata.output
				? path.basename(metadata.output).replace(/\.[^.]+$/, '')
				: path.basename(document.fileName).replace(/\.[^.]+$/, '');
			usedFolder = currentOutputFolder();
			outAbs = path.join(
				usedFolder || path.dirname(templatePath),
				base + '.' + extensionForFormat(requestedFormat)
			);
			assertOutputIsSeparate(outAbs, document.fileName, templatePath);
			await fs.promises.mkdir(path.dirname(outAbs), { recursive: true });
			await fs.promises.writeFile(outAbs, text, 'utf8');
		} catch (err: any) {
			const message =
				err instanceof TemplateError ? err.message : `generation failed: ${err?.message ?? err}`;
			vscode.window.showErrorMessage(`Markdown Editor: ${message}`);
			return;
		}

		const rel = vscode.workspace.asRelativePath(outAbs, true) || outAbs;
		const folderNote = usedFolder
			? ''
			: ' (no output folder set — written next to the template file)';
		vscode.window.showInformationMessage(
			`Markdown Editor: generated ${rel} (${extensionForFormat(requestedFormat)})${folderNote}.`
		);

		// Start the live input -> output link: remember this generation, open
		// the output file beside the editor, and from now on every section
		// edit here re-renders the file and scrolls the output to that section.
		this.liveSessions.set(webviewPanel, {
			templatePath,
			outputAbs: outAbs,
			format: requestedFormat,
			fingerprints: fingerprintsFromDocument(document.getText())
		});
		void Promise.resolve(
			vscode.window.showTextDocument(vscode.Uri.file(outAbs), {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: true
			})
		).catch((err: unknown) => console.warn('Markdown Editor: could not open output file:', err));
	}

	// Handle the toolbar's Generate button (second toolbar row):
	// - Jinja templates (.j2/.jinja/.jnt): render the template against the
	//   opened Markdown document (TypeScript backend, see jinjaTemplate.ts).
	// - Legacy .table-template.json mappings: the structured column-mapping
	//   generator in codeGenerator.ts.
	private async handleGenerateRequest(
		e: any,
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		const templatePath = typeof e.template === 'string' ? e.template : null;
		const format = typeof e.format === 'string' ? normalizeOutputFormat(e.format) : null;

		if (!templatePath) {
			vscode.window.showInformationMessage(
				'Markdown Editor: select a template in the toolbar before generating.'
			);
			return;
		}

		if (isJinjaTemplate(templatePath)) {
			await this.generateWithJinjaTemplate(e, document, webviewPanel);
			return;
		}

		const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(templatePath));
		const mapping = readTableMapping(Buffer.from(raw).toString('utf8'));
		const mappingDir = path.dirname(templatePath);
		const markdownPath = path.resolve(mappingDir, mapping.markdown);
		const requestedFormat = format ?? mappingOutputFormat(mapping);
		const configuredFolder = currentOutputFolder();
		// Keep the mapped extension and directory unless the toolbar overrides them.
		const mappedOutput = path.resolve(mappingDir, mapping.output);
		const outputBase = path.basename(mappedOutput).replace(/\.[^.]+$/, '');
		const outAbs = !configuredFolder && !format
			? mappedOutput
			: path.join(configuredFolder || path.dirname(mappedOutput),
				format ? outputBase + '.' + extensionForFormat(requestedFormat) : path.basename(mappedOutput));
		assertOutputIsSeparate(outAbs, markdownPath, templatePath);
		if (mapping.docx?.template) {
			assertOutputIsSeparate(outAbs, path.resolve(mappingDir, mapping.docx.template));
		}

		const source = vscode.workspace.textDocuments.find((open) => open.uri.fsPath === markdownPath);
		const markdownText = source?.getText() ?? await fs.promises.readFile(markdownPath, 'utf8');
		await generateFromTemplate(mapping, markdownText, requestedFormat, outAbs);

		const rel = vscode.workspace.asRelativePath(outAbs, true) || outAbs;
		vscode.window.showInformationMessage(`Markdown Editor: generated ${rel} (${extensionForFormat(requestedFormat)}).`);
	}

	// Get the static html used for the editor webviews.
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const initScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'src', 'markdownEditorInitScript.js')
		);
		const ckeditorUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.context.extensionUri,
				...'ckeditor5-build-markdown/build/ckeditor.js'.split('/')
			)
		);

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		const html = String.raw; // https://prettier.io/docs/en/options.html#embedded-language-formatting
		return html/* html */ `<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}';" />

					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title>Markdown WYSIWYG Editor</title>
				</head>
				<body>
					<div id="mdwysiwyg-root"></div>
					<p id="editor-startup-error" role="alert" hidden></p>

					<script nonce="${nonce}" src="${ckeditorUri}"></script>
					<script nonce="${nonce}" src="${initScriptUri}"></script>
				</body>
			</html> `;
	}

	// Save new content to the text document
	private async updateTextDocument(document: vscode.TextDocument, text: string) {
		const formatted = prettier.format(text, { parser: 'markdown' }) as string;
		const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const normalized = formatted.replace(/(?:\r\n|\r|\n)/g, eol);
		if (normalized === document.getText()) return;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), normalized);
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error('Could not update the Markdown document.');
		}
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
