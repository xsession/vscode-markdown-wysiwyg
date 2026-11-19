//@ts-check

// Share the API with the CKEditor toolbar before creating the editor.
const vscode = acquireVsCodeApi();
window.vscode = vscode;

void startEditor().catch((error) => {
	console.error('Markdown Editor could not start:', error);
	const status = document.getElementById('editor-startup-error');
	status.hidden = false;
	status.textContent = 'Markdown Editor could not start. Reopen the editor tab or open the Markdown source.';
});

async function startEditor() {
	const editor = await MarkdownEditor.create(document.getElementById('mdwysiwyg-root'));
	window.editor = editor;
	editor.timeLastModified = new Date();
	wireEditor(editor);
}

function wireEditor(editor) {
	let initialized = false;
	let applyingHostContent = false;

	/**
	 * Render the document in the webview.
	 */
	function setEditorContent(/** @type {string} */ text) {
		// We use setData instead of editor.model.change for initial content otherwise undo history starts with empty content
		if (!initialized) {
			editor.setData(text);
			initialized = true;
			return;
		}

		// If the new text doesn't match the editor's current text, we need to update it but preserve the selection.
		if (editor.getData() !== text) {
			// Save selection so we can restore it after replacing the content
			const userSelection = editor.model.document.selection.getFirstRange();

			// Replace all content but calling insertContent with the whole document range as a selection
			const selectionRange = editor.model.createRangeIn(editor.model.document.getRoot());
			const viewFragment = editor.data.processor.toView(text);
			const modelFragment = editor.data.toModel(viewFragment);
			editor.model.insertContent(modelFragment, selectionRange);

			editor.model.change((writer) => {
				try {
					writer.setSelection(userSelection);
				} catch {
					writer.setSelection(editor.model.document.getRoot(), 'end');
				}
			});
		}
	}

	function applyHostContent(text) {
		applyingHostContent = true;
		try {
			setEditorContent(text);
		} finally {
			applyingHostContent = false;
		}
	}
	// A host update can emit zero or several changes. Suppress only during that update.
	editor.model.document.on('change:data', () => {
		if (!applyingHostContent) {
			vscode.postMessage({ type: 'webviewChanged', text: editor.getData() });
		}
	});

	window.addEventListener('message', ({ data: message }) => {
		switch (message?.type) {
			case 'documentChanged':
				applyHostContent(message.text);
				vscode.setState({ text: message.text });
				break;
			case 'templatePicked':
				window.markdownToolbar.setTemplate(message.path, message.name, message.format, message.kind);
				break;
			case 'outputFolder':
				window.markdownToolbar.setOutputFolder(message.folder || '');
				break;
		}
	});

	const state = vscode.getState();
	if (typeof state?.text === 'string') applyHostContent(state.text);
	vscode.postMessage({ type: 'initialized' });
}
