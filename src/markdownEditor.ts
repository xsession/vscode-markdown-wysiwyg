import type { CreatedTemplate } from './createJinjaTemplate';
import { normalizeOutputFormat, renderJinjaConversion } from './jinjaConversion';
import { assertOutputDocumentIsClean, readJinjaText, sameJinjaFile } from './runJinjaTemplate';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { extensionState } from './extension';
import { generateFromTemplate, extensionForFormat, GenerationError, TemplateMapping } from './codeGenerator';
import { canImportMapping, importMappedOutput, preserveMappingMarkers } from './outputImport';
import { importRegisterMap } from './registerMapImport';
import { renderTemplate, splitTemplateFile } from './jinjaTemplate';
import {
	buildMarkdownContext,
	fingerprintsFromDocument,
	diffFingerprints,
	findRegisterSpan
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

interface OutputLink {
	sourcePath: string;
	outputAbs: string;
	format: string;
	sourceBaseline: string;
	outputBaseline: string;
	templatePath?: string;
	reverse?: (markdown: string, previous: string, output: string) => string | Promise<string>;
	watcher?: vscode.FileSystemWatcher;
	saveSubscription?: vscode.Disposable;
	forwardTimer?: NodeJS.Timeout;
	reverseTimer?: NodeJS.Timeout;
	queue: Promise<void>;
	disposed: boolean;
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
		return vscode.Disposable.from(providerRegistration, { dispose: () => provider.disposeLinks() });
	}

	static readonly viewType = 'markdownEditor.customEditor';

	constructor(private readonly context: vscode.ExtensionContext) {}

	private readonly liveSessions = new Map<vscode.WebviewPanel, OutputLink>();
	private readonly outputLinks = new Map<string, OutputLink>();

	private stopLink(link: OutputLink): void {
		link.disposed = true;
		if (link.forwardTimer) clearTimeout(link.forwardTimer);
		if (link.reverseTimer) clearTimeout(link.reverseTimer);
		link.watcher?.dispose();
		link.saveSubscription?.dispose();
		this.outputLinks.delete(link.outputAbs);
		for (const [panel, active] of this.liveSessions) {
			if (active === link) this.liveSessions.delete(panel);
		}
	}

	private disposeLinks(): void {
		for (const link of this.outputLinks.values()) this.stopLink(link);
	}

	private async releaseOutput(output: string): Promise<void> {
		const link = this.outputLinks.get(path.resolve(output));
		if (!link) return;
		this.stopLink(link);
		await link.queue;
	}

	private startLink(panel: vscode.WebviewPanel, config: Omit<OutputLink, 'queue' | 'disposed'>): void {
		const previous = this.outputLinks.get(config.outputAbs);
		if (previous) this.stopLink(previous);
		const active = this.liveSessions.get(panel);
		if (active && !active.reverse) this.stopLink(active);
		else if (active?.forwardTimer) clearTimeout(active.forwardTimer);
		const link: OutputLink = { ...config, queue: Promise.resolve(), disposed: false };
		this.liveSessions.set(panel, link);
		this.outputLinks.set(link.outputAbs, link);
		if (!link.reverse) return;

		const pattern = new vscode.RelativePattern(path.dirname(link.outputAbs), '*');
		link.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, true);
		const handle = (uri: vscode.Uri) => {
			if (uri.fsPath !== link.outputAbs) return;
			if (link.reverseTimer) clearTimeout(link.reverseTimer);
			link.reverseTimer = setTimeout(() => {
				void this.queueLink(link, () => this.importOutput(link));
			}, 300);
		};
		link.watcher.onDidChange(handle);
		link.watcher.onDidCreate(handle);
		link.saveSubscription = vscode.workspace.onDidSaveTextDocument(saved => {
			if (saved.uri.fsPath === link.outputAbs) handle(saved.uri);
		});
	}

	private queueLink(link: OutputLink, operation: () => Promise<void>): Promise<void> {
		const run = link.queue.then(async () => {
			if (!link.disposed) await operation();
		});
		link.queue = run.catch(err => {
			if (!link.disposed) void vscode.window.showWarningMessage('Markdown Editor: ' + (err instanceof Error ? err.message : String(err)));
		});
		return link.queue;
	}

	private async importOutput(link: OutputLink): Promise<void> {
		if (!link.reverse) return;
		const outputDocument = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === link.outputAbs);
		if (outputDocument?.isDirty) return;
		const output = await fs.promises.readFile(link.outputAbs, 'utf8');
		if (output === link.outputBaseline) return;

		const source = await vscode.workspace.openTextDocument(vscode.Uri.file(link.sourcePath));
		if (source.isDirty || source.getText() !== link.sourceBaseline) {
			throw new GenerationError('Output sync paused because the Markdown source also changed. Both files were kept.');
		}
		const markdown = await link.reverse(link.sourceBaseline, link.outputBaseline, output);
		if (link.disposed || source.isDirty || source.getText() !== link.sourceBaseline || outputDocument?.isDirty ||
			await fs.promises.readFile(link.outputAbs, 'utf8') !== output) return;
		if (link.disposed || source.isDirty || source.getText() !== link.sourceBaseline) return;

		if (markdown !== link.sourceBaseline) {
			const edit = new vscode.WorkspaceEdit();
			edit.replace(source.uri, new vscode.Range(0, 0, source.lineCount, 0), markdown);
			if (!(await vscode.workspace.applyEdit(edit))) throw new GenerationError('Could not apply output changes to Markdown.');
			if (source.getText() !== markdown || !(await source.save())) throw new GenerationError('Output changes are in the Markdown editor. Save the source to finish syncing.');
			link.sourceBaseline = source.getText();
		}
		link.outputBaseline = output;
	}

	private liveSync(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
		const link = this.liveSessions.get(panel);
		if (!link?.templatePath || document.uri.fsPath !== link.sourcePath) return;
		if (link.forwardTimer) clearTimeout(link.forwardTimer);
		link.forwardTimer = setTimeout(() => {
			void this.queueLink(link, () => this.doLiveSync(link, document));
		}, 400);
	}

	private async doLiveSync(link: OutputLink, document: vscode.TextDocument): Promise<void> {
		const source = document.getText();
		if (source === link.sourceBaseline || !link.templatePath) return;
		const outputDocument = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === link.outputAbs);
		if (outputDocument?.isDirty) return;
		if (await fs.promises.readFile(link.outputAbs, 'utf8') !== link.outputBaseline) {
			throw new GenerationError('Output sync paused because the generated file also changed. Both files were kept.');
		}
		const raw = await readJinjaText(vscode.Uri.file(link.templatePath));
		const { output } = renderJinjaConversion(raw, source, document.fileName, link.format);
		if (link.disposed || outputDocument?.isDirty || document.getText() !== source) return;
		if (await fs.promises.readFile(link.outputAbs, 'utf8') !== link.outputBaseline ||
			link.disposed || outputDocument?.isDirty || document.getText() !== source) return;
		const changed = diffFingerprints(fingerprintsFromDocument(link.sourceBaseline), fingerprintsFromDocument(source));
		if (output !== link.outputBaseline) {
			await fs.promises.writeFile(link.outputAbs, output, 'utf8');
			link.outputBaseline = output;
		}
		link.sourceBaseline = source;
		const span = changed && findRegisterSpan(output, link.format, changed);
		const editor = vscode.window.visibleTextEditors.find(ed => ed.document.uri.fsPath === link.outputAbs);
		if (!span || !editor) return;
		const range = new vscode.Range(span.start, 0, Math.min(span.end, editor.document.lineCount - 1), 0);
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}

	private reverseJinja(templatePath: string, format: string, reverse: string | undefined): OutputLink['reverse'] {
		const bundled = /^(?:register-map-to-yaml|register-map-to-json)\.(?:j2|jinja|jnt)$/i.test(path.basename(templatePath));
		if ((reverse === 'register-map' || (!reverse && bundled)) && ['yaml', 'json'].includes(format)) {
			return importRegisterMap;
		}
		if (!reverse || reverse === 'register-map') return undefined;
		const reversePath = path.resolve(path.dirname(templatePath), reverse);
		return async (markdown, previous, output) => {
			const { params, body } = splitTemplateFile(await fs.promises.readFile(reversePath, 'utf8'));
			const context = buildMarkdownContext(output, 'generated.' + extensionForFormat(format));
			context.params = params;
			context.original_markdown = markdown;
			context.previous_output = previous;
			const result = renderTemplate(body, context);
			if (!result.trim()) throw new GenerationError('The reverse template returned empty Markdown.');
			return result;
		};
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

	private async executeDocumentCommand(document: vscode.TextDocument, command: string, panel: vscode.WebviewPanel) {
		switch (command) {
			case 'markdownEditor.createJinjaTemplate': {
				const template = await vscode.commands.executeCommand<CreatedTemplate | undefined>(command, document.uri);
				if (template && sameJinjaFile(vscode.Uri.parse(template.sourceUri), document.uri)) {
					await panel.webview.postMessage({ type: 'templatePicked', kind: 'jinja', ...template });
				}
				break;
			}
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

		let pendingEdit = Promise.resolve();
		let synchronizedText: string | undefined;

		function updateWebview() {
			synchronizedText = document.getText();
			// CKEditor uses LF internally.
			const text = synchronizedText.replace(/(?:\r\n|\r|\n)/g, '\n');
			webviewPanel.webview.postMessage({ type: 'documentChanged', text });
		}

		const saveDocumentSubscription = vscode.workspace.onDidSaveTextDocument(async (saved) => {
			if (saved !== document) return;
			await pendingEdit;
			// The editor already contains edits it sent. Replacing them on
			// auto-save risks resetting the selection and undo history.
			if (document.getText() !== synchronizedText) updateWebview();
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
			const link = this.liveSessions.get(webviewPanel);
			if (link?.forwardTimer) clearTimeout(link.forwardTimer);
			if (link && !link.reverse) this.stopLink(link);
			this.liveSessions.delete(webviewPanel);
			saveDocumentSubscription.dispose();
			onDidChangeOutputFolder.dispose();
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage(async (e) => {
			try {
				switch (e?.type) {
					case 'webviewChanged':
						if (typeof e.text === 'string') {
							const edit = pendingEdit.then(async () => {
								synchronizedText = await this.updateTextDocument(document, e.text);
							});
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
						await this.executeDocumentCommand(document, e.command, webviewPanel);
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
		const raw = await readJinjaText(vscode.Uri.file(templatePath));
		const sourceBaseline = document.getText();
		const override = typeof e.format === 'string' ? e.format : undefined;
		const { metadata, output, outputName, format: requestedFormat } =
			renderJinjaConversion(raw, sourceBaseline, document.fileName, override);
		const usedFolder = currentOutputFolder();
		const outAbs = path.join(usedFolder || path.dirname(templatePath), outputName);
		assertOutputIsSeparate(outAbs, document.fileName, templatePath);
		assertOutputDocumentIsClean(vscode.Uri.file(outAbs));
		await this.releaseOutput(outAbs);
		await fs.promises.mkdir(path.dirname(outAbs), { recursive: true });
		assertOutputDocumentIsClean(vscode.Uri.file(outAbs));
		await fs.promises.writeFile(outAbs, output, 'utf8');

		const rel = vscode.workspace.asRelativePath(outAbs, true) || outAbs;
		const folderNote = usedFolder
			? ''
			: ' (no output folder set — written next to the template file)';
		vscode.window.showInformationMessage(
			`Markdown Editor: generated ${rel} (${extensionForFormat(requestedFormat)})${folderNote}.`
		);

		if (document.uri.scheme === 'file') {
			this.startLink(webviewPanel, {
				templatePath, outputAbs: path.resolve(outAbs), format: requestedFormat,
				sourcePath: document.uri.fsPath, sourceBaseline, outputBaseline: output,
				reverse: this.reverseJinja(templatePath, requestedFormat, metadata.reverse)
			});
		}

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
		await this.releaseOutput(outAbs);
		await generateFromTemplate(mapping, markdownText, requestedFormat, outAbs);
		if (canImportMapping(requestedFormat)) {
			this.startLink(webviewPanel, {
				sourcePath: markdownPath, outputAbs: path.resolve(outAbs), format: requestedFormat,
				sourceBaseline: markdownText, outputBaseline: await fs.promises.readFile(outAbs, 'utf8'),
				reverse: (markdown, previous, output) => importMappedOutput(markdown, previous, output, mapping, requestedFormat)
			});
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
					<p id="editor-startup-error" role="alert" hidden></p>

					<script nonce="${nonce}" src="${ckeditorUri}"></script>
					<script nonce="${nonce}" src="${initScriptUri}"></script>
				</body>
			</html> `;
	}

	// Save new content to the text document
	private async updateTextDocument(document: vscode.TextDocument, text: string) {
		const input = preserveMappingMarkers(document.getText(), text);
		const formatted = prettier.format(input, { parser: 'markdown' }) as string;
		const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const normalized = formatted.replace(/(?:\r\n|\r|\n)/g, eol);
		if (normalized === document.getText()) return normalized;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), normalized);
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error('Could not update the Markdown document.');
		}
		return normalized;
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
