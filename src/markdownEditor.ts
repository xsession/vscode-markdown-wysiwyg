import { time } from 'console';
import * as path from 'path';
import * as vscode from 'vscode';
import { extensionState } from './extension';

const prettier = require('prettier');

// Table template mapping files (see TEMPLATE-SYNC.md). The toolbar's template
// selector lists every mapping file in the workspace.
const TEMPLATE_GLOB = '**/*.table-template.json';
const TEMPLATE_EXCLUDES =
	'{**/node_modules/**,**/dist/**,**/dist_/**,**/out/**,**/out_/**,**/.git/**}';

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

	// Push the workspace template list into the editor's toolbar template selector.
	private sendTemplates(webviewPanel: vscode.WebviewPanel) {
		void collectTemplates().then((templates) => {
			webviewPanel.webview.postMessage({ type: 'templates', templates });
		});
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
			changeDocumentSubscription.dispose();
			saveDocumentSubscription.dispose();
			onDidCreateTemplates.dispose();
			onDidDeleteTemplates.dispose();
			onDidSaveTemplate.dispose();
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage((e) => {
			console.log('onDidReceiveMessage: ', [JSON.stringify(e)]);
			switch (e.type) {
				case 'webviewChanged':
					this.updateTextDocument(document, e.text);
					return;
				case 'initialized':
					updateWebview();
					this.sendTemplates(webviewPanel);
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
					void this.handleGenerateRequest(e);
					return;
			}
		});
	}

	// Handle the toolbar's Generate button (second toolbar row).
	// Validates the selected template and reports the request. The table-sync
	// code generation engine documented in TEMPLATE-SYNC.md / DOCX-TEMPLATES.md
	// is not part of this build yet, so generation itself is pending.
	private async handleGenerateRequest(e: any): Promise<void> {
		const templatePath = typeof e.template === 'string' ? e.template : null;
		const format = typeof e.format === 'string' ? e.format : null;

		if (!templatePath) {
			vscode.window.showInformationMessage(
				'Markdown Editor: select a template in the toolbar before generating.'
			);
			return;
		}

		let mapping: any;
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

		// TODO: wire in the table-sync generation engine (see TEMPLATE-SYNC.md)
		// and produce mapping.output here.
		vscode.window.showInformationMessage(
			`Markdown Editor: generation for "${mapping.output}" (${
				format ?? mapping.format ?? 'unknown format'
			}) is not implemented in this build yet.`
		);
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
					<div id="editor"></div>

					<script nonce="${nonce}" src="${ckeditorUri}"></script>
					<script nonce="${nonce}">
						MarkdownEditor.create(document.querySelector('#editor'))
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
