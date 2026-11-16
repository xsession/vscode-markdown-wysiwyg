"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentLoader = exports.configuredFilters = void 0;
const vscode = require("vscode");
const documentFormats_1 = require("./documentFormats");
function configuredFilters(state) {
    const config = vscode.workspace.getConfiguration('markdownEditor.piper');
    return { skipCode: config.get('skipCode', !config.get('readCodeBlocks', false)), skipUrls: config.get('skipUrls', true), skipHeaders: config.get('skipHeaders', true), skipFooters: config.get('skipFooters', true), ...state === null || state === void 0 ? void 0 : state.get('piper.readingFilters', {}) };
}
exports.configuredFilters = configuredFilters;
class DocumentLoader {
    constructor() {
        this.converted = new Map();
        this.changed = new vscode.EventEmitter();
        this.onDidChange = this.changed.event;
        this.registration = vscode.workspace.registerTextDocumentContentProvider('markdown-listening', this);
    }
    async load(uri) {
        var _a;
        const ext = (_a = uri.path.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        const binary = ['pdf', 'docx', 'odt', 'epub', 'rtf'].includes(ext || '');
        if ((await vscode.workspace.fs.stat(uri)).size > 64 * 1024 * 1024)
            throw new Error('Document exceeds the 64 MiB input limit. Split the document first.');
        let data;
        if (binary)
            data = Buffer.from(await vscode.workspace.fs.readFile(uri));
        else {
            const doc = await vscode.workspace.openTextDocument(uri);
            data = Buffer.from(doc.getText(), 'utf8');
        }
        return (0, documentFormats_1.importDocument)(data, uri.path);
    }
    provideTextDocumentContent(uri) { return this.converted.get(uri.toString()) || 'Document is no longer indexed. Refresh the documentation index.'; }
    async show(uri, imported, line = 0) {
        let target = uri;
        if (imported.extracted) {
            target = vscode.Uri.parse('markdown-listening:/' + encodeURIComponent(uri.toString()) + '.md');
            this.converted.set(target.toString(), imported.markdown);
            this.changed.fire(target);
        }
        const document = await vscode.workspace.openTextDocument(target), editor = await vscode.window.showTextDocument(document);
        const position = new vscode.Position(Math.min(line, document.lineCount - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    }
    dispose() { this.registration.dispose(); this.changed.dispose(); this.converted.clear(); }
}
exports.DocumentLoader = DocumentLoader;
//# sourceMappingURL=documentLoader.js.map