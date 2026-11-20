import * as path from 'path';
import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { renderJinjaConversion } from './jinjaConversion';

const templateExtensions = ['j2', 'jinja', 'jnt'];

export async function pickJinjaFile(openLabel: string, defaultUri?: vscode.Uri, template = false): Promise<vscode.Uri | undefined> {
	const files = await vscode.window.showOpenDialog({
		canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel, defaultUri,
		filters: template ? { 'Jinja templates': templateExtensions } : undefined
	});
	return files?.[0];
}

export function assertJinjaFilename(uri: vscode.Uri): void {
	if (!templateExtensions.includes(path.extname(uri.path).slice(1).toLowerCase())) {
		throw new Error('Choose a .j2, .jinja or .jnt template file.');
	}
}

export function sameJinjaFile(left: vscode.Uri, right: vscode.Uri): boolean {
	if (left.scheme === 'file' && right.scheme === 'file') {
		const a = path.resolve(left.fsPath), b = path.resolve(right.fsPath);
		return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
	}
	return left.toString() === right.toString();
}

export async function readJinjaText(uri: vscode.Uri, maxBytes?: number): Promise<string> {
	const open = vscode.workspace.textDocuments.find(document => sameJinjaFile(document.uri, uri));
	const textLimit = 'Choose a UTF-8 text file' + (maxBytes ? ' of at most ' + maxBytes / 1024 + ' KiB.' : '.');
	if (!open && maxBytes && (await vscode.workspace.fs.stat(uri)).size > maxBytes) throw new Error(textLimit);
	const bytes = open ? Buffer.from(open.getText(), 'utf8') : await vscode.workspace.fs.readFile(uri);
	if ((maxBytes && bytes.byteLength > maxBytes) || bytes.includes(0)) throw new Error(textLimit);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error(textLimit);
	}
}

export function assertOutputDocumentIsClean(destination: vscode.Uri): void {
	if (vscode.workspace.textDocuments.some(document => document.isDirty && sameJinjaFile(document.uri, destination))) {
		throw new Error('The output file has unsaved changes. Save or close it before generating.');
	}
}

export async function runJinjaTemplate(source?: vscode.Uri, template?: vscode.Uri, destination?: vscode.Uri): Promise<vscode.Uri | undefined> {
	source ??= await pickJinjaFile('Select source file', vscode.window.activeTextEditor?.document.uri);
	if (!source) return;
	template ??= await pickJinjaFile('Select Jinja template', vscode.Uri.joinPath(source, '..'), true);
	if (!template) return;
	assertJinjaFilename(template);
	const [input, definition] = await Promise.all([readJinjaText(source), readJinjaText(template)]);
	const result = renderJinjaConversion(definition, input, path.posix.basename(source.path));
	const outputUri = destination ?? await vscode.window.showSaveDialog({
		saveLabel: 'Save generated output',
		defaultUri: vscode.Uri.joinPath(source, '..', result.outputName)
	});
	if (!outputUri) return;
	if ([source, template].some(uri => sameJinjaFile(uri, outputUri))) {
		throw new Error('Choose an output file separate from the source and template.');
	}
	assertOutputDocumentIsClean(outputUri);
	await vscode.workspace.fs.writeFile(outputUri, Buffer.from(result.output, 'utf8'));
	await vscode.window.showTextDocument(outputUri, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
	return outputUri;
}
