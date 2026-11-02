import {ProjectListening} from './projectListening';
import {LocalAssistant} from './localAssistant';
import {DocumentLoader} from './documentLoader';
import {isSupportedDocument, documentExtensions, importDocument} from './documentFormats';
import { DocumentationExplorer } from './documentationExplorer';
import { VoiceManager } from './voiceManager';
import { PiperReader } from './piperReader';
import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditor';

export const extensionState: {
	activeDocument: vscode.TextDocument | undefined;
	activeWebviewPanel: vscode.WebviewPanel | undefined;
} = {
	// Need to manually track the current webview & document, since with a
	// CustomTextEditor, vscode.window.activeTextEditor is always undefined
	// https://github.com/microsoft/vscode/issues/102110#issuecomment-656868579
	activeDocument: undefined,
	activeWebviewPanel: undefined,
};

export function activate(context: vscode.ExtensionContext) {
	const voices: VoiceManager = new VoiceManager(context, text => reader.notify(text));
	let project:ProjectListening;
	const reader: PiperReader = new PiperReader(voices, context.workspaceState, {
		prepareSource:(uri,text)=>project?.state.source(uri,text)||text,
		opened:(previous,current)=>project?.onOpen(previous,current),
		position:(current,heard,completed)=>project?.onPosition(current,heard,completed),
		finished:current=>project.onFinished(current),
		action:(action,message)=>project.action(action,message),
		pronunciation:()=>project?.state.pronunciations||[],
		language:()=>project?.state.languageMode||'manual',
		highlight:current=>project?.highlight(current)
	});
	context.subscriptions.push(reader);
	const loader = new DocumentLoader();
	const explorer=new DocumentationExplorer(context,reader,loader);
	project=new ProjectListening(context,reader,voices,loader,explorer,new LocalAssistant(context.extensionPath));
	context.subscriptions.push(loader,explorer,project);
	for(const [command,action] of [['diagnostics','diagnostics'],['queue','queueProject'],['tour','tour']])context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.workspace.'+command,async()=>{try{if(!reader.snapshot())await reader.open('# Listening workspace\n\nOpen a document, build a project tour, or add files to the listening queue.','Listening workspace','workspace:',false);await project.action(action,{});}catch(error){vscode.window.showErrorMessage(String(error));}}));
	for(const action of ['play','stop','next','previous','nextHeading','previousHeading','context','back','bookmark','pause'])context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.listen.'+action,()=>reader.control(action)));
	const mindmapButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
	mindmapButton.text = '$(type-hierarchy) Mind map';
	mindmapButton.tooltip = 'Open project documentation mind map (10 document formats)';
	mindmapButton.command = 'markdownEditor.documentation.mindmap';
	mindmapButton.show();context.subscriptions.push(mindmapButton);
	context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.readDocument', async (uri?: vscode.Uri) => {
		try {
			if (!uri) uri = (await vscode.window.showOpenDialog({canSelectMany:false,filters:{Documents:documentExtensions}}))?.[0];
			if (!uri) return;
			const imported = await loader.load(uri);
			await reader.open(imported.markdown, uri.path.split('/').pop() || 'Document',uri.toString(),true);
		} catch(error) { vscode.window.showErrorMessage(String(error)); }
	}));
	for (const selectionOnly of [false, true]) {
		context.subscriptions.push(vscode.commands.registerCommand(selectionOnly ? 'markdownEditor.readSelection' : 'markdownEditor.readAloud', async () => {
			try {
				const editor = vscode.window.activeTextEditor;
				const document = editor ? editor.document : extensionState.activeWebviewPanel?.active ? extensionState.activeDocument : undefined;
				if (!document || !isSupportedDocument(document.uri.path)) { await vscode.commands.executeCommand('markdownEditor.readDocument'); return; }
				if (selectionOnly && (!editor || editor.selection.isEmpty)) throw new Error('Select Markdown text in the source editor first.');
				const imported = selectionOnly && editor ? await importDocument(Buffer.from(document.getText(editor.selection),'utf8'),document.uri.path) : await loader.load(document.uri);
				await reader.open(imported.markdown, document.uri.path.split('/').pop() || 'Markdown', document.uri.toString() + (selectionOnly ? '#selection' : ''), true);
			} catch (error) { vscode.window.showErrorMessage(String(error)); }
		}));
	}

	context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.listeningGuide', async () => {
		try {
			const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'research', 'listening-large-documents.md');
			const document = await vscode.workspace.openTextDocument(uri);
			await reader.open(document.getText(), 'Listening research guide', uri.toString(), true);
		} catch (error) { vscode.window.showErrorMessage(String(error)); }
	}));

	// Register our custom editor providers
	context.subscriptions.push(MarkdownEditorProvider.register(context));

	// Helper method to register commands and push subscription
	function registerCommand(command: string, callback: (...args: any[]) => any) {
		context.subscriptions.push(vscode.commands.registerCommand(command, callback));
	}

	registerCommand('markdownEditor.openCustomEditor', async (uri: vscode.Uri) => {
		// Sanity check. These cases shouldn't happen
		if (vscode.window.activeTextEditor === undefined) {
			vscode.window.showErrorMessage('No active text editor.');
			return;
		}
		if (vscode.window.activeTextEditor?.document.languageId !== 'markdown') {
			vscode.window.showErrorMessage('Active editor is not markdown.');
			return;
		}

		// Set URI to active editor if not provided
		uri = uri ?? vscode.window.activeTextEditor?.document.uri;

		vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
			vscode.commands.executeCommand('vscode.openWith', uri, MarkdownEditorProvider.viewType);
		});
	});

	registerCommand('markdownEditor.openDefaultEditor', async (uri: vscode.Uri) => {
		// Sanity check. These cases shouldn't happen
		if (extensionState?.activeDocument?.uri === undefined) {
			vscode.window.showErrorMessage('extensionState?.activeDocument?.uri is undefined.');
			return;
		}

		uri = uri ?? extensionState?.activeDocument?.uri;
		vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
			vscode.commands.executeCommand('vscode.openWith', uri, 'default');
		});
	});
}
