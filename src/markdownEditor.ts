import { time } from 'console';
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

// Table template mapping files (see TEMPLATE-SYNC.md). The toolbar's template
// selector lists every mapping file in the workspace.
const TEMPLATE_GLOB = '**/*.table-template.json';
const TEMPLATE_EXCLUDES =
	'{**/node_modules/**,**/dist/**,**/dist_/**,**/out/**,**/out_/**,**/.git/**}';

// Jinja conversion templates (see JINJA-TEMPLATES.md): the Template button
// opens a file browser for one of these, the TypeScript backend renders it
// against the opened Markdown document.
const JINJA_TEMPLATE_EXTS = new Set(['.j2', '.jinja', '.jnt']);

export interface ToolbarTemplate {
	name: string;
	path: string;
	format?: string;
	output?: string;
}

async function collectTemplates(): Promise<ToolbarTemplate[]> {
	const uris = await vscode.workspace.findFiles(TEMPLATE_GLOB, TEMPLATE_EXCLUDES, 200);
	const templates: ToolbarTemplate[] = [];
	for (const uri of uris) {
		try {
			const raw = await vscode.workspace.fs.readFile(uri);
			const mapping = JSON.parse(Buffer.from(raw).toString('utf8'));
			templates.push({
				name: path.basename(uri.fsPath).replace(/\.table-template\.json$/, ''),
				path: uri.fsPath,
				format: typeof mapping.format === 'string' ? mapping.format : undefined,
				output: typeof mapping.output === 'string' ? mapping.output : undefined,
			});
		} catch (err) {
			console.warn('Skipping invalid table template', uri.fsPath, err);
		}
	}
	templates.sort((a, b) => a.name.localeCompare(b.name));
	return templates;
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

	// Push the workspace template list into the editor's toolbar template selector.
	private sendTemplates(webviewPanel: vscode.WebviewPanel) {
		void collectTemplates().then((templates) => {
			webviewPanel.webview.postMessage({ type: 'templates', templates });
		});
	}

	// Tell the toolbar which output folder is currently configured.
	private sendOutputFolder(webviewPanel: vscode.WebviewPanel) {
		webviewPanel.webview.postMessage({
			type: 'outputFolder',
			folder: vscode.workspace
				.getConfiguration('markdownEditor')
				.get<string>('outputFolder', '')
				|| '',
		});
	}

	// The toolbar's file-browser button: native folder picker, stored in the
	// markdownEditor.outputFolder workspace setting.
	private async pickOutputFolder(webviewPanel: vscode.WebviewPanel) {
		const dirs = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Set as generation output folder',
		});
		const dir = dirs?.[0];
		if (!dir) {
			return;
		}
		const configured = vscode.workspace.isTrusted
			? path.isAbsolute(dir.fsPath)
				? dir.fsPath
				: vscode.workspace.asRelativePath(dir.fsPath)
			: '';
		await vscode.workspace
			.getConfiguration('markdownEditor')
			.update('outputFolder', configured, vscode.ConfigurationTarget.Workspace);
		this.sendOutputFolder(webviewPanel);
	}

	// The toolbar's Template button: native file browser for a Jinja
	// conversion template. The picked file is validated here (front matter +
	// nonempty body) and reported back to the webview, which sets the
	// toolbar's template state (name, and the default output format when the
	// template declares one).
	private async pickTemplate(webviewPanel: vscode.WebviewPanel) {
		const files = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: 'Select conversion template',
			filters: {
				'Jinja templates': ['j2', 'jinja', 'jnt'],
				'All files': ['*']
			}
		});
		const file = files?.[0];
		if (!file) {
			return;
		}
		let raw: string;
		try {
			raw = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8');
		} catch (err: any) {
			vscode.window.showErrorMessage(
				`Markdown Editor: could not read template "${path.basename(file.fsPath)}": ${err?.message ?? err}`
			);
			return;
		}
		const { metadata, body } = splitTemplateFile(raw);
		if (!body.trim()) {
			vscode.window.showErrorMessage(
				`Markdown Editor: template "${path.basename(file.fsPath)}" has no Jinja body.`
			);
			return;
		}
		webviewPanel.webview.postMessage({
			type: 'templatePicked',
			path: file.fsPath,
			name: metadata.name || path.basename(file.fsPath),
			format: metadata.format
		});
	}

	// Document action buttons on the second toolbar row run these extension
	// commands on the document the webview is showing.
	private executeDocumentCommand(document: vscode.TextDocument, command: string) {
		const DOCUMENT_COMMANDS = [
			'markdownEditor.documentation.mindmap',
			'markdownEditor.readAloud',
			'markdownEditor.documentation.open',
			'markdownEditor.documentation.listen',
		];
		if (!DOCUMENT_COMMANDS.includes(command)) {
			return;
		}
		if (command === 'markdownEditor.documentation.open' || command === 'markdownEditor.documentation.listen') {
			// The explorer commands take a node argument; for the current
			// document the node id is the document uri string.
			void vscode.commands.executeCommand(command, { id: document.uri.toString() });
			return;
		}
		void vscode.commands.executeCommand(command);
	}

	// Called when our custom editor is opened.
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial webview HTML and settings
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

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

		// Initial scroll sync
		webviewPanel.webview.postMessage({
			type: 'scrollChanged',
			scrollTop: document.lineAt(0).range.start.line,
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

			// Change EOL to \n because that's what CKEditor5 uses internally
			text = text.replace(/(?:\r\n|\r|\n)/g, '\n');

			console.log('updateWebview', [JSON.stringify(text)]);
			webviewPanel.webview.postMessage({ type: 'documentChanged', text: text });
		}

		const saveDocumentSubscription = vscode.workspace.onDidSaveTextDocument((e) => {
			console.log('Saved Document');
			updateWebview();
		});

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
			console.log('Changed Document: ', [JSON.stringify(e.document.getText())]);
		});

		const onDidChangeTextEditorVisibleRanges = vscode.window.onDidChangeTextEditorVisibleRanges(
			(e) => {
				console.log('onDidChangeTextEditorVisibleRanges: ', [JSON.stringify(e)]);
				if (e.textEditor.document === document) {
					//  Sync scroll from editor to webview
					webviewPanel.webview.postMessage({
						type: 'scrollChanged',
						scrollTop: e.textEditor.visibleRanges[0].start.line,
					});
				}
			}
		);

		// Keep the toolbar's template selector in sync with the workspace.
		const isTemplateFile = (uri: vscode.Uri) => uri.fsPath.endsWith('.table-template.json');
		const onDidCreateTemplates = vscode.workspace.onDidCreateFiles((e) => {
			if (e.files.some(isTemplateFile)) {
				this.sendTemplates(webviewPanel);
			}
		});
		const onDidDeleteTemplates = vscode.workspace.onDidDeleteFiles((e) => {
			if (e.files.some(isTemplateFile)) {
				this.sendTemplates(webviewPanel);
			}
		});
		const onDidSaveTemplate = vscode.workspace.onDidSaveTextDocument((e) => {
			if (isTemplateFile(e.uri)) {
				this.sendTemplates(webviewPanel);
			}
		});
		const onDidChangeOutputFolder = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('markdownEditor.outputFolder')) {
				this.sendOutputFolder(webviewPanel);
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			console.log('Disposed1');
			if (extensionState.activeWebviewPanel === webviewPanel) {
				vscode.commands
					.executeCommand('setContext', 'markdownEditor.editorIsActive', false)
					.then(() => {
						console.log('markdownEditor.editorIsActive', false);
					});
			}
			console.log('Disposed2');
			const liveTimer = this.liveSyncTimers.get(webviewPanel);
			if (liveTimer) clearTimeout(liveTimer);
			this.liveSyncTimers.delete(webviewPanel);
			this.liveSessions.delete(webviewPanel);
			changeDocumentSubscription.dispose();
			saveDocumentSubscription.dispose();
			onDidCreateTemplates.dispose();
			onDidDeleteTemplates.dispose();
			onDidSaveTemplate.dispose();
			onDidChangeOutputFolder.dispose();
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage((e) => {
			console.log('onDidReceiveMessage: ', [JSON.stringify(e)]);
			switch (e.type) {
				case 'webviewChanged':
					this.updateTextDocument(document, e.text);
					this.liveSync(webviewPanel, document);
					return;
				case 'initialized':
					updateWebview();
					this.sendTemplates(webviewPanel);
					this.sendOutputFolder(webviewPanel);
					return;
				case 'plainPaste':
					vscode.commands.executeCommand('editor.action.clipboardPasteAction');
					return;
				case 'templateSelected':
					console.log('templateSelected', e.template);
					return;
				case 'formatSelected':
					console.log('formatSelected', e.format);
					return;
				case 'generateRequest':
					void this.handleGenerateRequest(e, document, webviewPanel);
					return;
				case 'pickTemplate':
					void this.pickTemplate(webviewPanel);
					return;
				case 'pickOutputFolder':
					void this.pickOutputFolder(webviewPanel);
					return;
				case 'executeCommand':
					this.executeDocumentCommand(document, e.command);
					return;
			}
		});
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
		const format = typeof e.format === 'string' ? e.format : null;
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
		const requestedFormat = format ?? metadata.format ?? 'yaml';

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
		const format = typeof e.format === 'string' ? e.format : null;

		if (!templatePath) {
			vscode.window.showInformationMessage(
				'Markdown Editor: select a template in the toolbar before generating.'
			);
			return;
		}

		if (JINJA_TEMPLATE_EXTS.has(path.extname(templatePath).toLowerCase())) {
			await this.generateWithJinjaTemplate(e, document, webviewPanel);
			return;
		}

		let mapping: TemplateMapping;
		try {
			const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(templatePath));
			mapping = JSON.parse(Buffer.from(raw).toString('utf8'));
		} catch (err: any) {
			vscode.window.showErrorMessage(
				`Markdown Editor: could not read template "${path.basename(templatePath)}": ${
					err?.message ?? err
				}`
			);
			return;
		}

		if (!mapping || typeof mapping.markdown !== 'string' || typeof mapping.output !== 'string') {
			vscode.window.showErrorMessage(
				`Markdown Editor: template "${path.basename(templatePath)}" is missing "markdown" or "output".`
			);
			return;
		}
		if (!mapping.table || typeof mapping.table !== 'string') {
			vscode.window.showErrorMessage(
				`Markdown Editor: template "${path.basename(templatePath)}" is missing "table".`
			);
			return;
		}

		const mappingDir = path.dirname(templatePath);
		const markdownPath = path.resolve(mappingDir, mapping.markdown);
		const requestedFormat = format ?? mapping.format ?? path.extname(mapping.output).slice(1);
		// The selected format decides the output file extension.
		let outputBase = path.basename(mapping.output).replace(/\.[^.]+$/, '');
		let outAbs: string;
		try {
			const markdownText = await fs.promises.readFile(markdownPath, 'utf8');
			const outputFolder = currentOutputFolder();
			outAbs = path.join(outputFolder || mappingDir, outputBase + '.' + extensionForFormat(requestedFormat));
			await generateFromTemplate(mapping, markdownText, requestedFormat, outAbs);
		} catch (err: any) {
			const message = err instanceof GenerationError ? err.message : `generation failed: ${err?.message ?? err}`;
			vscode.window.showErrorMessage(`Markdown Editor: ${message}`);
			return;
		}

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

					<script nonce="${nonce}" src="${ckeditorUri}"></script>
					<script nonce="${nonce}">
						MarkdownEditor.create(document.querySelector('#mdwysiwyg-root'))
							.then((editor) => {
								window.editor = editor;
								editor.timeLastModified = new Date();
								console.log('CKEditor instance:', editor);
							})
							.catch((error) => {
								console.error('CKEditor Initialization Error:', error);
							});
					</script>
					<script nonce="${nonce}" src="${initScriptUri}"></script>
				</body>
			</html> `;
	}

	// Save new content to the text document
	private updateTextDocument(document: vscode.TextDocument, text: any) {
		console.log('VS Code started updateTextDocument', [JSON.stringify(text)]);

		let rawText = text;

		// Autoformat the markdown text using Prettier
		text = prettier.format(text, {
			parser: 'markdown',
		});

		let prettierText = text;

		// Standardize text EOL character to match document
		// https://code.visualstudio.com/api/references/vscode-api#EndOfLine
		const eol_chars = document?.eol == 2 ? '\r\n' : '\n';
		text = text.replace(/(?:\r\n|\r|\n)/g, eol_chars);

		let finalText = text;
		let fileText = document?.getText();

		if (text != fileText) {
			// TODO - Apply edits to the document instead of replacing the whole thing
			const newEdit = new vscode.WorkspaceEdit();
			newEdit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
			vscode.workspace.applyEdit(newEdit);

			// console.debug('Updating Document because content changed');
			// console.debug('rawText', JSON.stringify(rawText));
			// console.debug('prettierText', JSON.stringify(prettierText));
			// console.debug('finalText', JSON.stringify(finalText));
			// console.debug('fileText', JSON.stringify(fileText));
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
