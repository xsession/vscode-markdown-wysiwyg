import * as path from 'path';
import { safeLoad } from 'js-yaml';
import { buildMarkdownContext, ParsedTable } from './markdownTables';
import { renderTemplate, splitTemplateFile, yamlScalar } from './jinjaTemplate';

type Scalar = string | number | boolean;
type Binding = { expression: string; value: Scalar };
type Collection = { expression: string; records: Binding[][] };

const aliases = new Map([['yml', 'yaml'], ['md', 'markdown'], ['htm', 'html']]);
const isScalar = (value: unknown): value is Scalar =>
	typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const index = (key: string | number) => '[' + JSON.stringify(key) + ']';
const literal = (value: string) => value.replace(/\{[{%#]|\{$/g, token => '{{ ' + JSON.stringify(token) + ' }}');
const addressable = (key: string) => !/[\x00-\x1f]|\}\}|%\}/.test(key);

function objectBindings(value: unknown, expression: string, bindings: Binding[], depth = 0) {
	if (bindings.length >= 400 || depth > 6) return;
	if (isScalar(value)) {
		bindings.push({ expression, value });
	} else if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value).slice(0, 100)) {
			if (addressable(key)) objectBindings(item, expression + index(Array.isArray(value) ? Number(key) : key), bindings, depth + 1);
		}
	}
}

function sourceBindings(sourceText: string, sourceName: string) {
	const context = buildMarkdownContext(sourceText, sourceName);
	const bindings: Binding[] = [];
	if (context.title) bindings.push({ expression: 'title', value: String(context.title) });
	bindings.push({ expression: 'source', value: sourceName });
	if (String(context.markdown).trim()) bindings.push({ expression: 'markdown', value: String(context.markdown) });

	const collections: Collection[] = [];
	let prologue = '';
	for (const [tableIndex, table] of (context.tables as ParsedTable[]).slice(0, 8).entries()) {
		const expression = 'tables[' + tableIndex + '].rows';
		const records = table.rows.map(row => table.headers.flatMap((header, col) =>
			row.cells[col] && addressable(header) ? [{ expression: 'row' + index(header), value: row[header] as Scalar }] : []));
		collections.push({ expression, records });
	}

	const extension = path.extname(sourceName).toLowerCase();
	if (['.json', '.yaml', '.yml'].includes(extension)) {
		const json = extension === '.json';
		const data = json ? JSON.parse(sourceText.replace(/^\uFEFF/, '')) : safeLoad(sourceText);
		prologue = '{% set example_data = ' + (json ? 'json_parse' : 'yaml_parse') + '(markdown) %}';
		objectBindings(data, 'example_data', bindings);
		const addCollection = (value: unknown, expression: string, depth = 0) => {
			if (depth > 3 || collections.length >= 12 || !value || typeof value !== 'object') return;
			if (Array.isArray(value)) {
				if (value.length > 1 && value.length <= 200) {
					const records = value.map(record => {
						const fields: Binding[] = [];
						objectBindings(record, 'row', fields);
						return fields;
					});
					collections.push({ expression, records });
				}
			} else {
				for (const [key, child] of Object.entries(value).slice(0, 40)) {
					if (addressable(key)) addCollection(child, expression + index(key), depth + 1);
				}
			}
		};
		addCollection(data, 'example_data');
	} else {
		for (const { expression, records } of collections) {
			for (const [rowIndex, row] of records.slice(0, 100).entries()) {
				for (const binding of row) {
					if (isScalar(binding.value) && bindings.length < 400) {
						bindings.push({ expression: expression + index(rowIndex) + binding.expression.slice(3), value: binding.value });
					}
				}
			}
		}
	}
	return { context, bindings, collections, prologue };
}

interface Match { sample: string; expression: string }
function substitutions(bindings: Binding[], format: string): Match[] {
	const matches = new Map<string, string | undefined>();
	const add = (sample: string, expression: string) => {
		if (!sample) return;
		if (!matches.has(sample)) matches.set(sample, expression);
		else if (matches.get(sample) !== expression) matches.set(sample, undefined);
	};
	for (const { value, expression } of bindings) {
		const raw = String(value);
		if (typeof value === 'string' && ['json', 'yaml'].includes(format)) add(JSON.stringify(value), expression + ' | tojson');
		if (format === 'yaml' && typeof value === 'string' && yamlScalar(value) === raw) {
			add(raw, expression + ' | yaml_scalar');
			continue;
		}
		if (format === 'json' && typeof value === 'string' && !/^(?:true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?)$/.test(raw)) continue;
		if (format === 'csv' || format === 'tsv') {
			const isCsv = format === 'csv';
			const needsQuotes = (isCsv ? /[,"\r\n]/ : /[\t"\r\n]/).test(raw);
			add(needsQuotes ? '"' + raw.replace(/"/g, '""') + '"' : raw, expression + (isCsv ? ' | csv_q' : ' | tsv_q'));
		} else if (raw.length >= 3 || /^-?\d+(?:\.\d+)?$/.test(raw)) {
			add(raw, expression);
		}
	}
	return [...matches].flatMap(([sample, expression]) => expression ? [{ sample, expression }] : [])
		.sort((a, b) => b.sample.length - a.sample.length);
}

function findLocations(text: string, format: string): (sample: string) => number[] {
	if (format === 'json') {
		// Match full JSON value tokens. A number inside a string or a
		// string property name is not an interchangeable value.
		const tokens = /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
		const offsets = new Map<string, number[]>();
		for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
			if (/^\s*:/.test(text.slice(tokens.lastIndex))) continue;
			const seen = offsets.get(token[0]) ?? [];
			seen.push(token.index);
			offsets.set(token[0], seen);
		}
		return sample => offsets.get(sample) ?? [];
	}
	const delim = format === 'csv' ? ',' : format === 'tsv' ? '\t' : undefined;
	const edge = (char?: string) => !char || char === delim || char === '\r' || char === '\n';
	const word = (char?: string) => Boolean(char && /[\p{L}\p{N}_]/u.test(char));
	return sample => {
		const result: number[] = [];
		let from = 0;
		for (;;) {
			const start = text.indexOf(sample, from);
			if (start < 0) return result;
			const end = start + sample.length;
			from = end;
			if (delim) {
				if (!edge(text[start - 1]) || !edge(text[end])) continue;
			} else {
				if ((word(sample[0]) && word(text[start - 1])) ||
					(word(sample[sample.length - 1]) && word(text[end]))) continue;
				if (format === 'yaml' && /^\s*:/.test(text.slice(end))) continue;
			}
			result.push(start);
		}
	};
}

function bindText(text: string, matches: Match[], format: string) {
	const spans: Array<{ start: number; end: number; expression: string }> = [];
	const locate = findLocations(text, format);
	for (const { sample, expression } of matches) {
		for (const start of locate(sample)) {
			const end = start + sample.length;
			spans.push({ start, end, expression });
		}
	}
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	let next = 0;
	let body = '';
	let count = 0;
	for (const span of spans) {
		if (span.start < next) continue;
		count++;
		body += literal(text.slice(next, span.start)) + '{{ ' + span.expression + ' }}';
		next = span.end;
	}
	return { body: body + literal(text.slice(next)), bindings: count };
}

function inferLoop(expected: string, collection: Collection, format: string) {
	const records = collection.records;
	if (records.length < 2 || records.length > 200) return undefined;
	const eol = expected.includes('\r\n') ? '\r\n' : '\n';
	const lines = expected.split(eol);
	if (lines.length > 4000 || expected.length > 128 * 1024) return undefined;
	const varying = records[0].filter(first => {
		const values = records.map(row => row.find(binding => binding.expression === first.expression)?.value);
		return values.every(value => value !== undefined) && new Set(values).size > 1;
	});
	const matchers = records.map(row => substitutions(row.filter(item =>
		varying.some(first => first.expression === item.expression)), format));
	const locate = findLocations(expected, format);
	for (const anchor of varying.slice(0, 6)) {
		const positions = records.map((row, rowIndex) => {
			const value = row.find(item => item.expression === anchor.expression)!.value;
			for (const option of matchers[rowIndex]) {
				if (option.sample !== String(value) && option.sample !== JSON.stringify(value)) continue;
				const found = locate(option.sample);
				if (found.length === 1) return expected.slice(0, found[0]).split(eol).length - 1;
			}
			return -1;
		});
		const width = positions[1] - positions[0];
		if (positions[0] < 0 || width < 1 || width > 48 ||
			!positions.every((line, i) => line === positions[0] + i * width)) continue;
		for (let offset = 0; offset < width; offset++) {
			const start = positions[0] - offset, stop = start + width * records.length;
			if (start < 0 || stop > lines.length) continue;
			const chunks = records.map((_, i) => lines.slice(start + i * width, start + (i + 1) * width).join(eol));
			const comma = format === 'json' && !chunks[chunks.length - 1].endsWith(',') &&
				chunks.slice(0, -1).every(chunk => chunk.endsWith(','));
			const parts = chunks.map((chunk, i) => bindText(comma && i < chunks.length - 1 ? chunk.slice(0, -1) : chunk, matchers[i], format));
			if (!parts[0].bindings || !parts.every(part => part.body === parts[0].body)) continue;
			return {
				prefix: start ? lines.slice(0, start).join(eol) + eol : '',
				suffix: stop < lines.length ? eol + lines.slice(stop).join(eol) : '',
				body: '{% for row in ' + collection.expression + ' %}' + parts[0].body +
					'{% if not loop.last %}' + (comma ? ',' : '') + eol + '{% endif %}{% endfor %}',
				bindings: parts[0].bindings
			};
		}
	}
}

export function generateJinjaFromExample(sourceText: string, sourceFile: string, expected: string, expectedFile: string) {
	if (!expected.trim()) throw new Error('The expected output example is empty.');
	const sourceName = path.basename(sourceFile);
	const exampleName = path.basename(expectedFile);
	const extension = (exampleName === '.env' ? 'env' : path.extname(exampleName).slice(1)).toLowerCase();
	const format = aliases.get(extension) || (/^[a-z0-9_-]+$/.test(extension) ? extension : 'txt');
	if (format === 'docx') throw new Error('Jinja templates generate text. Choose a text output example.');
	if (format === 'json') JSON.parse(expected);
	if (format === 'yaml') safeLoad(expected);
	const { context, bindings, collections, prologue } = sourceBindings(sourceText, sourceName);
	const matched = substitutions(bindings, format);
	let result = bindText(expected, matched, format);
	let loop = false;
	for (const collection of collections) {
		const inferred = inferLoop(expected, collection, format);
		if (!inferred) continue;
		const prefix = bindText(inferred.prefix, matched, format);
		const suffix = bindText(inferred.suffix, matched, format);
		const body = prefix.body + inferred.body + suffix.body;
		if (renderTemplate(prologue + body, context) !== expected) continue;
		result = { body, bindings: prefix.bindings + inferred.bindings + suffix.bindings };
		loop = true;
		break;
	}
	if (renderTemplate(prologue + result.body, context) !== expected) {
		throw new Error('The inferred template did not reproduce the expected output.');
	}
	if (result.bindings === 0) {
		throw new Error('No unambiguous source values matched the expected output. Try examples with distinctive values or two corresponding table rows.');
	}
	const name = path.basename(sourceName, path.extname(sourceName)).replace(/[\r\n'"]/g, ' ').trim() + ' conversion';
	const output = /^['"]|['"]$|[\r\n]/.test(exampleName) ? '' : 'output: ' + exampleName + '\n';
	const template = '---\nname: ' + name + '\nformat: ' + format + '\n' + output + '---\n' + prologue + result.body;
	const parsed = splitTemplateFile(template);
	if (renderTemplate(parsed.body, { ...context, params: parsed.params }) !== expected) {
		throw new Error('The generated template could not be verified with its metadata.');
	}
	return { template, name, format, bindings: result.bindings, loop };
}
