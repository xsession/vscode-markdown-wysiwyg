import * as path from 'path';
import { TextDecoder } from 'util';
import * as vscode from 'vscode';
import { generateJinjaFromExample } from './jinjaExampleGenerator';

const templateExtensions = ['j2', 'jinja', 'jnt'];
const maxExampleBytes = 512 * 1024;

async function readExample(uri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
	if (!open && (await vscode.workspace.fs.stat(uri)).size > maxExampleBytes) {
		throw new Error('Choose a UTF-8 text example of at most 512 KiB.');
	}
	const bytes = open ? Buffer.from(open.getText(), 'utf8') : await vscode.workspace.fs.readFile(uri);
	if (bytes.byteLength > maxExampleBytes || bytes.includes(0)) {
		throw new Error('Choose a UTF-8 text example of at most 512 KiB.');
	}
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export interface CreatedTemplate {
	sourceUri: string;
	path: string;
	name: string;
	format: string;
}

export async function createJinjaTemplate(sourceHint?: vscode.Uri): Promise<CreatedTemplate | undefined> {
	const pick = async (openLabel: string, defaultUri?: vscode.Uri) => (await vscode.window.showOpenDialog({
		canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel, defaultUri
	}))?.[0];

	const source = await pick('Select source example', sourceHint);
	if (!source) return;
	const expected = await pick('Select expected output example', vscode.Uri.joinPath(source, '..'));
	if (!expected) return;

	const [input, output] = await Promise.all([readExample(source), readExample(expected)]);
	const result = generateJinjaFromExample(input, source.fsPath, output, expected.fsPath);
	const target = await vscode.window.showSaveDialog({
		saveLabel: 'Save verified Jinja template',
		defaultUri: vscode.Uri.joinPath(source, '..', path.parse(source.path).name + '-conversion.j2'),
		filters: { 'Jinja templates': templateExtensions }
	});
	if (!target) return;
	if (!templateExtensions.includes(path.extname(target.path).slice(1).toLowerCase())) {
		throw new Error('Save the template with a .j2, .jinja or .jnt extension.');
	}
	const key = (uri: vscode.Uri) => process.platform === 'win32' ? uri.toString().toLowerCase() : uri.toString();
	if ([source, expected].some(uri => key(uri) === key(target))) {
		throw new Error('Save the template as a separate file from both examples.');
	}

	await vscode.workspace.fs.writeFile(target, Buffer.from(result.template, 'utf8'));
	await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
	const count = result.bindings + (result.bindings === 1 ? ' source binding' : ' source bindings');
	void vscode.window.showInformationMessage('Jinja template reproduced the expected example with ' + count +
		(result.loop ? ' and a row loop.' : '.'));
	return { sourceUri: source.toString(), path: target.fsPath, name: result.name, format: result.format };
}
