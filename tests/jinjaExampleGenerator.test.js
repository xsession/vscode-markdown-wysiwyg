const assert = require('node:assert/strict');
const { safeLoad } = require('js-yaml');
const { renderTemplate, splitTemplateFile } = require('../out/jinjaTemplate');
const { renderJinjaConversion } = require('../out/jinjaConversion');
const { generateJinjaFromExample } = require('../out/jinjaExampleGenerator');
const { buildMarkdownContext } = require('../out/markdownTables');

const source = '# Ports\n\n| Name | Count |\n| --- | --- |\n| UART | 4 |\n| SPI | 8 |\n';
const modified = source.replace('# Ports', '# Interfaces') + '| I2C, fast | 12 |\n';
const filename = 'ports.md';
const render = (template, text, file = filename) => {
	const parsed = splitTemplateFile(template);
	return renderTemplate(parsed.body, { ...buildMarkdownContext(text, file), params: parsed.params });
};

const csv = 'Name,Count\r\nUART,4\r\nSPI,8\r\n';
const csvTemplate = generateJinjaFromExample(source, filename, csv, 'board.csv');
assert.equal(csvTemplate.loop, true);
assert.equal(render(csvTemplate.template, source), csv);
assert.equal(render(csvTemplate.template, modified), 'Name,Count\r\nUART,4\r\nSPI,8\r\n"I2C, fast",12\r\n');

const json = JSON.stringify({ title: 'Ports', devices: [{ label: 'UART', pins: 4 }, { label: 'SPI', pins: 8 }] }, null, 2) + '\n';
const jsonTemplate = generateJinjaFromExample(source, filename, json, 'board.json');
assert.equal(jsonTemplate.loop, true);
assert.equal(render(jsonTemplate.template, source), json);
assert.deepEqual(JSON.parse(render(jsonTemplate.template, modified)), {
	title: 'Interfaces', devices: [{ label: 'UART', pins: 4 }, { label: 'SPI', pins: 8 }, { label: 'I2C, fast', pins: 12 }]
});

const yaml = 'title: Ports\ndevices:\n  - label: UART\n    pins: 4\n  - label: SPI\n    pins: 8\n';
const yamlTemplate = generateJinjaFromExample(source, filename, yaml, 'board.yaml');
assert.equal(yamlTemplate.loop, true);
assert.equal(render(yamlTemplate.template, source), yaml);
assert.equal(renderJinjaConversion(yamlTemplate.template, source, filename).outputName, 'board.yaml');
assert.equal(renderJinjaConversion(yamlTemplate.template, source, filename, 'json').outputName, 'board.json');
assert.equal(renderJinjaConversion(jsonTemplate.template, source, filename).outputName, 'board.json');
assert.throws(() => renderJinjaConversion(jsonTemplate.template, source.replace('UART | 4', 'UART | many'), filename),
	/invalid JSON/);
assert.equal(safeLoad(render(yamlTemplate.template, modified.replace('I2C, fast', 'I2C: fast'))).devices[2].label, 'I2C: fast');

const structured = '{"devices":[{"bus":"UART","pins":4},{"bus":"SPI","pins":8}]}';
const template = generateJinjaFromExample(structured, 'ports.json', csv, 'board.csv');
assert.equal(template.loop, true);
assert.equal(render(template.template, structured.replace('UART', 'Serial'), 'ports.json'), csv.replace('UART', 'Serial'));

const literal = 'Summary for {Ports}\n\n{{ example }} {% raw %} {# example #}\n';
const literalTemplate = generateJinjaFromExample(source, filename, literal, 'sample.md');
assert.equal(render(literalTemplate.template, source), literal);
assert.equal(render(literalTemplate.template, modified), literal.replace('Ports', 'Interfaces'));
assert.throws(() => generateJinjaFromExample(source, filename, 'Unrelated content', 'output.txt'), /No unambiguous/);
assert.throws(() => generateJinjaFromExample(source, filename, 'not valid', 'output.json'), SyntaxError);
console.log('Jinja example generator: exact examples, changed values, new rows, structured inputs, and literal Jinja delimiters passed');

async function testWizard() {
	const Module = require('node:module');
	const path = require('node:path');
	const uri = name => ({ scheme: 'file', path: '/examples/' + name, fsPath: '/examples/' + name,
		toString() { return this.path; } });
	const input = uri('ports.json');
	const expected = uri('sample.csv');
	const templateTarget = uri('ports-conversion.j2');
	const outputTarget = uri('actual.csv');
	const samples = new Map([[input.path, structured], [expected.path, csv]]);
	const selections = [input, expected];
	const destinations = [templateTarget, outputTarget];
	const writes = [];
	const opened = [];
	const reported = [];
	let launch;
	let runJinjaTemplate;
	const vscode = {
		Uri: { joinPath: (base, ...parts) => uri(path.basename(path.join(base.path, ...parts))) },
		ViewColumn: { Beside: 2 },
		window: {
			showOpenDialog: async () => selections.length ? [selections.shift()] : undefined,
			showSaveDialog: async () => destinations.shift(),
			showTextDocument: async selected => opened.push(selected),
			showInformationMessage: async (_message, choice) => choice,
			showErrorMessage: message => reported.push(message)
		},
		commands: { executeCommand(command, ...args) {
			assert.equal(command, 'markdownEditor.runJinjaTemplate');
			launch = runJinjaTemplate(...args);
			return launch;
		} },
		workspace: {
			textDocuments: [],
			fs: {
				stat: async file => ({ size: Buffer.byteLength(samples.get(file.path)) }),
				readFile: async file => Buffer.from(samples.get(file.path)),
				writeFile: async (file, bytes) => {
					writes.push(file);
					samples.set(file.path, bytes.toString());
				}
			}
		}
	};
	const original = Module._load;
	let createJinjaTemplate;
	try {
		Module._load = function (id, ...args) { return id === 'vscode' ? vscode : original.call(this, id, ...args); };
		({ createJinjaTemplate } = require('../out/createJinjaTemplate'));
		({ runJinjaTemplate } = require('../out/runJinjaTemplate'));
	} finally {
		Module._load = original;
	}
	const saved = await createJinjaTemplate();
	assert.equal(saved.path, templateTarget.fsPath);
	assert.equal(await launch, outputTarget);
	assert.deepEqual(writes, [templateTarget, outputTarget]);
	assert.deepEqual(opened, [templateTarget, outputTarget]);
	assert.equal(samples.get(outputTarget.path), csv);
	assert.equal(samples.get(expected.path), csv);
	assert.deepEqual(reported, []);

	vscode.workspace.textDocuments.push({ uri: input, getText: () => structured.replace('UART', 'Serial') });
	selections.push(input, templateTarget);
	destinations.push(outputTarget);
	assert.equal(await runJinjaTemplate(), outputTarget);
	assert.equal(samples.get(outputTarget.path), csv.replace('UART', 'Serial'));
	await assert.rejects(runJinjaTemplate(input, templateTarget, input), /separate/);
	vscode.workspace.textDocuments.push({ uri: outputTarget, isDirty: true });
	await assert.rejects(runJinjaTemplate(input, templateTarget, outputTarget), /unsaved changes/);
	assert.equal(await createJinjaTemplate(), undefined);
	assert.equal(writes.length, 3);
	console.log('Template wizard and runner: JSON source, verified save, actual output, live buffer, conflicts, and cancellation passed');
}
testWizard().catch(error => { console.error(error); process.exitCode = 1; });
