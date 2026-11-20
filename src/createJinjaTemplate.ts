import * as path from 'path';
import * as vscode from 'vscode';
import { generateJinjaFromExample } from './jinjaExampleGenerator';
import { pickJinjaFile, readJinjaText, sameJinjaFile } from './runJinjaTemplate';

const templateExtensions = ['j2', 'jinja', 'jnt'];
const maxExampleBytes = 512 * 1024;

export interface CreatedTemplate {
	sourceUri: string;
	path: string;
	name: string;
	format: string;
}

export async function createJinjaTemplate(sourceHint?: vscode.Uri): Promise<CreatedTemplate | undefined> {
	const source = await pickJinjaFile('Select source example', sourceHint);
	if (!source) return;
	const expected = await pickJinjaFile('Select expected output example', vscode.Uri.joinPath(source, '..'));
	if (!expected) return;

	const [input, output] = await Promise.all([readJinjaText(source, maxExampleBytes), readJinjaText(expected, maxExampleBytes)]);
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
	if ([source, expected].some(uri => sameJinjaFile(uri, target))) {
		throw new Error('Save the template as a separate file from both examples.');
	}

	await vscode.workspace.fs.writeFile(target, Buffer.from(result.template, 'utf8'));
	void Promise.resolve(vscode.window.showTextDocument(target, {
		viewColumn: vscode.ViewColumn.Beside, preserveFocus: true
	})).catch((error: unknown) => {
		void vscode.window.showWarningMessage('Template saved, but VS Code could not open it: ' + String(error));
	});
	const count = result.bindings + (result.bindings === 1 ? ' source binding' : ' source bindings');
	void Promise.resolve(vscode.window.showInformationMessage(
		'Jinja template saved and verified with ' + count + (result.loop ? ' and a row loop.' : '.'),
		'Run Template'
	)).then(choice => {
		if (choice === 'Run Template') return vscode.commands.executeCommand('markdownEditor.runJinjaTemplate', source, target);
	}).catch((error: unknown) => {
		void vscode.window.showErrorMessage('Markdown Editor: ' + String(error));
	});

	return { sourceUri: source.toString(), path: target.fsPath, name: result.name, format: result.format };
}
