const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateFromTemplate } = require('../out/codeGenerator');
const { importMappedOutput } = require('../out/outputImport');
const { importRegisterMap } = require('../out/registerMapImport');
const { buildMarkdownContext, rowDoc, rowSubRows } = require('../out/markdownTables');
const { splitTemplateFile, renderTemplate } = require('../out/jinjaTemplate');
const { safeLoad } = require('js-yaml');

async function main() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-output-import-'));
	try {
		const mapping = {
			table: 'devices', root: ['project', 'devices'], key: 'ID',
			columns: {
				ID: { path: ['id'], type: 'string' },
				Label: { path: ['detail', 'label'], type: 'string' },
				Count: { path: ['count'], type: 'number' },
				Enabled: { path: ['enabled'], type: 'boolean' }
			}
		};
		const source = '# Intro\n\n<!-- table-sync:devices -->\n| ID | Label | Count | Enabled | Notes |\n| --- | --- | --- | --- | --- |\n| ONE | Old value | 2 | true | Keep this |\n| TWO | Second | 3 | true | Keep this too |\n<!-- /table-sync:devices -->\n\n# End\n';
		const newOutput = source.replace('Old value | 2 | true', 'New \\| value | 7 | false');
		for (const format of ['yaml', 'json', 'toml', 'xml', 'csv', 'tsv', 'ini', 'env', 'properties', 'html']) {
			const file = path.join(dir, 'test.' + format);
			await generateFromTemplate(mapping, source, format, file);
			const before = await fs.readFile(file, 'utf8');
			await generateFromTemplate(mapping, newOutput, format, file);
			const after = await fs.readFile(file, 'utf8');
			assert.equal(importMappedOutput(source, before, after, mapping, format), newOutput, format);
			assert.equal(importMappedOutput(source, before, before, mapping, format), source, format);
		}
		const before = '{"project":{"devices":[{"id":"ONE","detail":{"label":"Old value"},"count":2,"enabled":true},{"id":"TWO","detail":{"label":"Second"},"count":3,"enabled":true}]}}';
		const output = '{"project":{"devices":[{"id":"TWO","detail":{"label":"Edited"},"count":3,"enabled":true},{"id":"THREE","detail":{"label":"New"},"count":1,"enabled":false}]}}';
		const merged = importMappedOutput(source, before, output, mapping, 'json');
		assert.match(merged, /\| TWO \| Edited \| 3 \| true \| Keep this too \|/);
		assert.match(merged, /\| THREE \| New \| 1 \| false \|  \|/);
		assert.doesNotMatch(merged, /\| ONE \|/);
		assert.throws(() => importMappedOutput(source, before, '{}', mapping, 'json'), /missing the mapped row list/);

		for (const [file, format, name, field] of [
			['register-map-demo.md', 'json', 'controlWord', 'enable'],
			['pab1-register-map.md', 'yaml', 'firmwareVersion', 'minorVersion']
		]) {
			const original = await fs.readFile(path.join(__dirname, 'fixtures', file), 'utf8');
			const template = await fs.readFile(path.join(__dirname, '..', 'templates', 'register-map-to-' + format + '.j2'), 'utf8');
			const { body, params } = splitTemplateFile(template);
			const baseline = renderTemplate(body, { ...buildMarkdownContext(original, file), params });
			const data = format === 'yaml' ? safeLoad(baseline) : JSON.parse(baseline);
			const target = data.types[name];
			target.doc = 'Updated register | description';
			target.fpga.flags = ['read'];
			target.fields[field].doc = 'Updated field | description';
			const revised = importRegisterMap(original, baseline, JSON.stringify(data));
			const rows = buildMarkdownContext(revised, file).rows;
			const initial = buildMarkdownContext(original, file).rows;
			const row = rows.find(item => item.Name === name);
			assert.equal(rowDoc(row), 'Updated register | description', file);
			assert.equal(row.Access, 'R');
			assert.equal(rowSubRows(row).find(parts => parts[1] === field)[4], 'Updated field | description', file);
			assert.deepEqual(rows.map(item => item.Offset), initial.map(item => item.Offset), file);
			assert.equal(importRegisterMap(original, baseline, baseline), original, file);
			delete data.types[name];
			assert.throws(() => importRegisterMap(original, baseline, JSON.stringify(data)), /offsets/);
		}
		console.log('Reverse output: ten mapped text formats, row identity, malformed data, and both register-map styles passed');
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
