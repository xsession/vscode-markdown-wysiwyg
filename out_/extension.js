"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = exports.extensionState = void 0;
const projectListening_1 = require("./projectListening");
const localAssistant_1 = require("./localAssistant");
const documentLoader_1 = require("./documentLoader");
const documentFormats_1 = require("./documentFormats");
const documentationExplorer_1 = require("./documentationExplorer");
const voiceManager_1 = require("./voiceManager");
const piperReader_1 = require("./piperReader");
const vscode = require("vscode");
const markdownEditor_1 = require("./markdownEditor");
exports.extensionState = {
    // Need to manually track the current webview & document, since with a
    // CustomTextEditor, vscode.window.activeTextEditor is always undefined
    // https://github.com/microsoft/vscode/issues/102110#issuecomment-656868579
    activeDocument: undefined,
    activeWebviewPanel: undefined,
};
function activate(context) {
    const voices = new voiceManager_1.VoiceManager(context, text => reader.notify(text));
    let project;
    const reader = new piperReader_1.PiperReader(voices, context.workspaceState, {
        prepareSource: (uri, text) => (project === null || project === void 0 ? void 0 : project.state.source(uri, text)) || text,
        opened: (previous, current) => project === null || project === void 0 ? void 0 : project.onOpen(previous, current),
        position: (current, heard, completed) => project === null || project === void 0 ? void 0 : project.onPosition(current, heard, completed),
        finished: current => project.onFinished(current),
        action: (action, message) => project.action(action, message),
        pronunciation: () => (project === null || project === void 0 ? void 0 : project.state.pronunciations) || [],
        language: () => (project === null || project === void 0 ? void 0 : project.state.languageMode) || 'manual',
        highlight: current => project === null || project === void 0 ? void 0 : project.highlight(current)
    });
    context.subscriptions.push(reader);
    const loader = new documentLoader_1.DocumentLoader();
    const explorer = new documentationExplorer_1.DocumentationExplorer(context, reader, loader);
    project = new projectListening_1.ProjectListening(context, reader, voices, loader, explorer, new localAssistant_1.LocalAssistant(context.extensionPath));
    context.subscriptions.push(loader, explorer, project);
    for (const [command, action] of [['diagnostics', 'diagnostics'], ['queue', 'queueProject'], ['tour', 'tour']])
        context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.workspace.' + command, async () => { try {
            if (!reader.snapshot())
                await reader.open('# Listening workspace\n\nOpen a document, build a project tour, or add files to the listening queue.', 'Listening workspace', 'workspace:', false);
            await project.action(action, {});
        }
        catch (error) {
            vscode.window.showErrorMessage(String(error));
        } }));
    for (const action of ['play', 'stop', 'next', 'previous', 'nextHeading', 'previousHeading', 'context', 'back', 'bookmark', 'pause'])
        context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.listen.' + action, () => reader.control(action)));
    const mindmapButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
    mindmapButton.text = '$(type-hierarchy) Mind map';
    mindmapButton.tooltip = 'Open project documentation mind map (10 document formats)';
    mindmapButton.command = 'markdownEditor.documentation.mindmap';
    mindmapButton.show();
    context.subscriptions.push(mindmapButton);
    context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.readDocument', async (uri) => {
        var _a;
        try {
            if (!uri)
                uri = (_a = (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Documents: documentFormats_1.documentExtensions } }))) === null || _a === void 0 ? void 0 : _a[0];
            if (!uri)
                return;
            const imported = await loader.load(uri);
            await reader.open(imported.markdown, uri.path.split('/').pop() || 'Document', uri.toString(), true);
        }
        catch (error) {
            vscode.window.showErrorMessage(String(error));
        }
    }));
    for (const selectionOnly of [false, true]) {
        context.subscriptions.push(vscode.commands.registerCommand(selectionOnly ? 'markdownEditor.readSelection' : 'markdownEditor.readAloud', async () => {
            var _a;
            try {
                const editor = vscode.window.activeTextEditor;
                const document = editor ? editor.document : ((_a = exports.extensionState.activeWebviewPanel) === null || _a === void 0 ? void 0 : _a.active) ? exports.extensionState.activeDocument : undefined;
                if (!document || !(0, documentFormats_1.isSupportedDocument)(document.uri.path)) {
                    await vscode.commands.executeCommand('markdownEditor.readDocument');
                    return;
                }
                if (selectionOnly && (!editor || editor.selection.isEmpty))
                    throw new Error('Select Markdown text in the source editor first.');
                const imported = selectionOnly && editor ? await (0, documentFormats_1.importDocument)(Buffer.from(document.getText(editor.selection), 'utf8'), document.uri.path) : await loader.load(document.uri);
                await reader.open(imported.markdown, document.uri.path.split('/').pop() || 'Markdown', document.uri.toString() + (selectionOnly ? '#selection' : ''), true);
            }
            catch (error) {
                vscode.window.showErrorMessage(String(error));
            }
        }));
    }
    context.subscriptions.push(vscode.commands.registerCommand('markdownEditor.listeningGuide', async () => {
        try {
            const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'research', 'listening-large-documents.md');
            const document = await vscode.workspace.openTextDocument(uri);
            await reader.open(document.getText(), 'Listening research guide', uri.toString(), true);
        }
        catch (error) {
            vscode.window.showErrorMessage(String(error));
        }
    }));
    // Register our custom editor providers
    context.subscriptions.push(markdownEditor_1.MarkdownEditorProvider.register(context));
    // Helper method to register commands and push subscription
    function registerCommand(command, callback) {
        context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    }
    registerCommand('markdownEditor.openCustomEditor', async (uri) => {
        var _a, _b;
        // Sanity check. These cases shouldn't happen
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('No active text editor.');
            return;
        }
        if (((_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document.languageId) !== 'markdown') {
            vscode.window.showErrorMessage('Active editor is not markdown.');
            return;
        }
        // Set URI to active editor if not provided
        uri = uri !== null && uri !== void 0 ? uri : (_b = vscode.window.activeTextEditor) === null || _b === void 0 ? void 0 : _b.document.uri;
        vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
            vscode.commands.executeCommand('vscode.openWith', uri, markdownEditor_1.MarkdownEditorProvider.viewType);
        });
    });
    registerCommand('markdownEditor.openDefaultEditor', async (uri) => {
        var _a, _b;
        // Sanity check. These cases shouldn't happen
        if (((_a = exports.extensionState === null || exports.extensionState === void 0 ? void 0 : exports.extensionState.activeDocument) === null || _a === void 0 ? void 0 : _a.uri) === undefined) {
            vscode.window.showErrorMessage('extensionState?.activeDocument?.uri is undefined.');
            return;
        }
        uri = uri !== null && uri !== void 0 ? uri : (_b = exports.extensionState === null || exports.extensionState === void 0 ? void 0 : exports.extensionState.activeDocument) === null || _b === void 0 ? void 0 : _b.uri;
        vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
            vscode.commands.executeCommand('vscode.openWith', uri, 'default');
        });
    });
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map