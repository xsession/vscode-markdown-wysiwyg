// Table-sync code generation: reads a marked Markdown table defined by a
// *.table-template.json mapping and writes the generated output file in the
// selected format. See TEMPLATE-SYNC.md for the mapping schema.
//
// Generation creates a .table-sync.bak backup of any existing output.
import * as path from 'path';

export class GenerationError extends Error {}

export interface ColumnMapping {
	path: string[];
	type: 'string' | 'number' | 'boolean';
}

export interface TemplateMapping {
	version?: number;
	format?: string;
	markdown: string;
	output: string;
	table: string;
	root?: string[];
	key?: string;
	defaults?: Record<string, unknown>;
	columns: { [name: string]: ColumnMapping };
	docx?: { template?: string; selector?: Record<string, unknown> };
}

const EXTENSIONS: { [format: string]: string } = {
	yaml: 'yml',
	json: 'json',
	toml: 'toml',
	xml: 'xml',
	csv: 'csv',
	tsv: 'tsv',
	ini: 'ini',
	env: 'env',
	properties: 'properties',
	html: 'html',
	docx: 'docx',
	markdown: 'md',
};

/** Extension to use for a selected output format (falls back to the format name). */
export function extensionForFormat(format: string): string {
	return EXTENSIONS[format.toLowerCase()] || format.toLowerCase();
}

/** Extract the marked table as [headerRow, ...dataRows] of raw cell strings. */
export function extractTableRows(markdown: string, table: string, allowEmpty = false): string[][] {
	const open = '<!-- table-sync:' + table + ' -->';
	const close = '<!-- /table-sync:' + table + ' -->';
	const start = markdown.indexOf(open);
	const end = start === -1 ? -1 : markdown.indexOf(close, start);
	if (start === -1 || end === -1 || end <= start) {
		throw new GenerationError('Markdown is missing the table-sync block "' + table + '".');
	}
	const lines = markdown
		.slice(start + open.length, end)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length < (allowEmpty ? 2 : 3) || !/^\|?[\s:|-]+\|?$/.test(lines[1])) {
		throw new GenerationError('The "' + table + '" block needs a header row, a separator row and at least one data row.');
	}
	const parseRow = (line: string): string[] => {
		if (!line.startsWith('|') || !line.endsWith('|')) {
			throw new GenerationError('Table rows must start and end with a pipe: ' + line);
		}
		const cells: string[] = [];
		let cell = '';
		for (let i = 1; i < line.length - 1; i++) {
			const ch = line[i];
			if (ch === '\\' && line[i + 1] === '|') {
				cell += '|';
				i++;
				continue;
			}
			if (ch === '|') {
				cells.push(cell.trim());
				cell = '';
				continue;
			}
			cell += ch;
		}
		cells.push(cell.trim());
		return cells.map((c) => c.replace(/<br\s*\/?>/gi, '\n'));
	};
	return [parseRow(lines[0]), ...lines.slice(2).map(parseRow)];
}

/** Turn raw rows into objects keyed by the mapped column names (typed values). */
export function buildRows(mapping: TemplateMapping, rows: string[][]): Record<string, unknown>[] {
	const header = rows[0];
	const colIndex: { [name: string]: number } = {};
	header.forEach((name, i) => (colIndex[name] = i));
	for (const name of Object.keys(mapping.columns || {})) {
		if (colIndex[name] === undefined) {
			throw new GenerationError('The Markdown table is missing the column "' + name + '".');
		}
	}
	if (mapping.key && colIndex[mapping.key] === undefined) {
		throw new GenerationError('The Markdown table is missing the key column "' + mapping.key + '".');
	}
	return rows.slice(1).map((cells) => {
		const row: Record<string, unknown> = {};
		for (const [name, col] of Object.entries(mapping.columns)) {
			const raw = cells[colIndex[name]] ?? '';
			if (col.type === 'number') {
				row[name] = raw === '' ? null : Number(raw);
			} else if (col.type === 'boolean') {
				row[name] = raw === 'true' ? true : raw === 'false' ? false : null;
			} else {
				row[name] = raw;
			}
		}
		return row;
	});
}

/** Write the mapped rows into a nested document at the mapping's root path. */
function setAtPath(doc: Record<string, unknown>, root: string[], value: unknown): void {
	let node = doc;
	for (let i = 0; i < root.length - 1; i++) {
		const segment = root[i];
		if (typeof node[segment] !== 'object' || node[segment] === null || Array.isArray(node[segment])) {
			node[segment] = {};
		}
		node = node[segment] as Record<string, unknown>;
	}
	node[root[root.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Scalar formatting helpers
// ---------------------------------------------------------------------------

function numberText(value: unknown): string {
	return value === null || value === undefined || Number.isNaN(Number(value)) ? '' : String(value);
}
function booleanText(value: unknown): string {
	return value === true ? 'true' : value === false ? 'false' : '';
}
function cellText(name: string, value: unknown, type: string): string {
	if (type === 'number') return numberText(value);
	if (type === 'boolean') return booleanText(value);
	return String(value ?? '');
}
function quote(value: unknown): string {
	return JSON.stringify(String(value ?? ''));
}
function xmlEscape(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Adapters (fresh documents)
// ---------------------------------------------------------------------------

function emitDelimited(mapping: TemplateMapping, rows: Record<string, unknown>[], delimiter: string): string {
	const names = Object.keys(mapping.columns);
	const lines = [names.join(delimiter)];
	for (const row of rows) {
		lines.push(
			names
				.map((name) => {
					let text = cellText(name, row[name], mapping.columns[name].type);
					if (delimiter === '	') {
						// TSV consumers rarely support quoted multi-line cells — escape newlines.
						text = text.replace(/\r?\n/g, '\\n');
					}
					if (text.includes(delimiter) || text.includes('"') || text.includes('\n')) {
						return '"' + text.replace(/"/g, '""') + '"';
					}
					return text;
				})
				.join(delimiter)
		);
	}
	return lines.join('\n') + '\n';
}

function emitJson(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const doc: Record<string, unknown> = {};
	const root = mapping.root && mapping.root.length ? mapping.root : [mapping.table];
	setAtPath(doc, root, rows.map((row) => flattenMapped(mapping, row)));
	return JSON.stringify(doc, null, '\t') + '\n';
}

function flattenMapped(mapping: TemplateMapping, row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [name, col] of Object.entries(mapping.columns)) {
		let node: Record<string, unknown> = out;
		for (let i = 0; i < col.path.length - 1; i++) {
			const segment = col.path[i];
			if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {};
			node = node[segment] as Record<string, unknown>;
		}
		node[col.path[col.path.length - 1]] = row[name] ?? null;
	}
	return out;
}

function yamlValue(value: unknown): string {
	if (value === null || value === undefined) return '""';
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	const text = String(value);
	if (text === '') return '""';
	if (/^[A-Za-z0-9_./-]+$/.test(text) && !/^(true|false|null|yes|no|on|off|\d+([.,]\d*)?)$/i.test(text)) return text;
	return JSON.stringify(text);
}

function emitYaml(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const lines: string[] = [];
	const root = mapping.root && mapping.root.length ? mapping.root : [mapping.table];
	for (let i = 0; i < root.length; i++) {
		lines.push(' '.repeat(i * 2) + root[i] + (i === root.length - 1 ? (rows.length ? ':' : ' []') : ':'));
	}
	const indent = ' '.repeat(root.length * 2);
	for (const row of rows.map((r) => flattenMapped(mapping, r))) {
		lines.push(indent + '-');
		const emit = (node: Record<string, unknown>, pad: string): void => {
			for (const [key, value] of Object.entries(node)) {
				if (typeof value === 'object' && value !== null) {
					lines.push(pad + key + ':');
					emit(value as Record<string, unknown>, pad + '  ');
				} else {
					lines.push(pad + key + ': ' + yamlValue(value));
				}
			}
		};
		emit(row, indent + '  ');
	}
	return lines.join('\n') + '\n';
}

function tomlValue(value: unknown): string {
	if (value === null || value === undefined) return '""';
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(String(value));
}

function emitToml(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const root = (mapping.root && mapping.root.length ? mapping.root : [mapping.table]).join('.');
	const lines: string[] = [];
	for (const row of rows.map((r) => flattenMapped(mapping, r))) {
		lines.push('[' + '[' + root + ']' + ']');
		const emit = (node: Record<string, unknown>, prefix: string): void => {
			for (const [key, value] of Object.entries(node)) {
				const dotted = prefix ? prefix + '.' + key : key;
				if (typeof value === 'object' && value !== null) {
					emit(value as Record<string, unknown>, dotted);
				} else {
					lines.push(dotted + ' = ' + tomlValue(value));
				}
			}
		};
		emit(row, '');
		lines.push('');
	}
	return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function emitXml(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const root = mapping.root && mapping.root.length ? mapping.root : [mapping.table];
	const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
	root.forEach((segment, i) => lines.push('  '.repeat(i + 1) + '<' + segment + '>'));
	for (const row of rows) {
		lines.push('  '.repeat(root.length + 1) + '<row>');
		for (const [name, col] of Object.entries(mapping.columns)) {
			// Nested paths become nested elements.
			const buildNested = (segments: string[], depth: number, value: unknown): void => {
				const pad = '  '.repeat(root.length + 2 + depth);
				if (depth === segments.length) {
					lines.push(pad + xmlEscape(value));
					return;
				}
				lines.push(pad + '<' + segments[depth] + '>');
				buildNested(segments, depth + 1, value);
				lines.push(pad + '</' + segments[depth] + '>');
			};
			buildNested(col.path, 0, row[name] ?? null);
		}
		lines.push('  '.repeat(root.length + 1) + '</row>');
	}
	root.forEach((segment, i) => lines.push('  '.repeat(root.length - i) + '</' + segment + '>'));
	return lines.join('\n') + '\n';
}

function emitIni(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const prefix = (mapping.root && mapping.root.length ? mapping.root : [mapping.table]).join('.');
	const lines: string[] = [];
	rows.forEach((row, i) => {
		lines.push('[' + prefix + '.' + i + ']');
		for (const [name, col] of Object.entries(mapping.columns)) {
			const key = col.path.join('.');
			const value = row[name];
			if (col.type === 'string') lines.push(key + '=' + quote(value));
			else if (col.type === 'number') lines.push(key + '=' + numberText(value));
			else lines.push(key + '=' + booleanText(value));
		}
		lines.push('');
	});
	return lines.join('\n') + '\n';
}

function envSegment(value: string): string {
	if (/^[A-Za-z0-9_]+$/.test(value)) return value.toUpperCase();
	return value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function emitEnv(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const root = (mapping.root && mapping.root.length ? mapping.root : [mapping.table]).map(envSegment);
	const lines: string[] = [];
	rows.forEach((row, i) => {
		for (const [name, col] of Object.entries(mapping.columns)) {
			const key = [...root, String(i), ...col.path.map(envSegment)].join('__');
			const value = row[name];
			lines.push(key + '=' + (col.type === 'string' ? quote(value) : col.type === 'number' ? numberText(value) : booleanText(value)));
		}
	});
	return lines.join('\n') + '\n';
}

function propertiesEscape(value: unknown): string {
	return String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/=/g, '\\=')
		.replace(/:/g, '\\:')
		.replace(/\n/g, '\\n')
		.replace(/[^\x20-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function emitProperties(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const prefix = (mapping.root && mapping.root.length ? mapping.root : [mapping.table]).join('.');
	const lines: string[] = [];
	rows.forEach((row, i) => {
		for (const [name, col] of Object.entries(mapping.columns)) {
			const key = prefix + '.' + i + '.' + col.path.join('.');
			const value = row[name];
			if (col.type === 'string') lines.push(key + '=' + propertiesEscape(value));
			else if (col.type === 'number') lines.push(key + '=' + numberText(value));
			else lines.push(key + '=' + booleanText(value));
		}
	});
	return lines.join('\n') + '\n';
}

function emitHtml(mapping: TemplateMapping, rows: Record<string, unknown>[]): string {
	const names = Object.keys(mapping.columns);
	const head = '<tr>' + names.map((n) => '<th>' + xmlEscape(n) + '</th>').join('') + '</tr>';
	const body = rows
		.map((row) => '<tr>' + names.map((n) => '<td>' + xmlEscape(cellText(n, row[n], mapping.columns[n].type)) + '</td>').join('') + '</tr>')
		.join('\n');
	return (
		'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' +
		xmlEscape(mapping.table) +
		'</title>\n</head>\n<body>\n<table data-table-sync="' +
		xmlEscape(mapping.table) +
		'">\n' +
		head +
		'\n' +
		body +
		'\n</table>\n</body>\n</html>\n'
	);
}

function emitDocx(mapping: TemplateMapping, rows: Record<string, unknown>[], outAbs: string): Promise<void> {
	if (mapping.docx && mapping.docx.template) {
		throw new GenerationError('Template-based DOCX generation (corporate master) is pending in this build. Generate to a text format, or run the template wizard later.');
	}
	const { zipSync, strToU8 } = require('fflate');
	const names = Object.keys(mapping.columns);
	const cellsByRow = rows.map((r) => names.map((n) => cellText(n, r[n], mapping.columns[n].type)));
	const bodyCell = (text: string) =>
		'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">' +
		xmlEscape(text) +
		'</w:t></w:r></w:p></w:tc>';
	const trs = [
		'<w:tr>' + names.map((n) => bodyCell(n)).join('') + '</w:tr>',
		...cellsByRow.map((cells) => '<w:tr>' + cells.map((c) => bodyCell(c)).join('') + '</w:tr>'),
	];
	const documentXml =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
		'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
		'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
		trs.join('') +
		'</w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
	const contentTypes =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
	const rels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
	const docRels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
	const zip = zipSync({
		'[Content_Types].xml': strToU8(contentTypes),
		'_rels/.rels': strToU8(rels),
		'word/_rels/document.xml.rels': strToU8(docRels),
		'word/document.xml': strToU8(documentXml),
	});
	return Promise.resolve(require('fs').promises.writeFile(outAbs, Buffer.from(zip)));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function generateFromTemplate(
	mapping: TemplateMapping,
	markdown: string,
	format: string,
	outAbs: string
): Promise<void> {
	const name = format.toLowerCase();
	if (!EXTENSIONS[name]) {
		throw new GenerationError('Unknown output format: ' + format);
	}
	const rows = extractTableRows(markdown, mapping.table, true);
	const data = buildRows(mapping, rows);
	const fs = require('fs');
	const dir = path.dirname(outAbs);
	await fs.promises.mkdir(dir, { recursive: true });
	const exists = await fs.promises
		.access(outAbs)
		.then(() => true)
		.catch(() => false);
	if (exists) {
		await fs.promises.copyFile(outAbs, outAbs + '.table-sync.bak');
	}
	if (name === 'docx') {
		await emitDocx(mapping, data, outAbs);
		return;
	}
	let text: string;
	switch (name) {
		case 'csv':
			text = emitDelimited(mapping, data, ',');
			break;
		case 'tsv':
			text = emitDelimited(mapping, data, '\t');
			break;
		case 'json':
			text = emitJson(mapping, data);
			break;
		case 'yaml':
			text = emitYaml(mapping, data);
			break;
		case 'toml':
			text = emitToml(mapping, data);
			break;
		case 'xml':
			text = emitXml(mapping, data);
			break;
		case 'ini':
			text = emitIni(mapping, data);
			break;
		case 'env':
			text = emitEnv(mapping, data);
			break;
		case 'properties':
			text = emitProperties(mapping, data);
			break;
		case 'html':
			text = emitHtml(mapping, data);
			break;
		default:
			throw new GenerationError('No generator for format: ' + name);
	}
	await fs.promises.writeFile(outAbs, text, 'utf8');
}
