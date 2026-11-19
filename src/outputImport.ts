import { safeLoad } from 'js-yaml';
import { splitTableCells } from './markdownTables';
import { extractTableRows, GenerationError, TemplateMapping } from './codeGenerator';

type Row = Record<string, unknown>;

function lookup(value: unknown, keys: string[]): unknown {
	for (const key of keys) {
		if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
		value = (value as Row)[key];
	}
	return value;
}

function delimited(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [], value = '', quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch !== '"') value += ch;
			else if (text[i + 1] === '"') { value += '"'; i++; }
			else quoted = false;
		} else if (ch === '"' && !value) quoted = true;
		else if (ch === delimiter) { row.push(value); value = ''; }
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(value);
			if (row.length > 1 || row[0] !== '') rows.push(row);
			row = [];
			value = '';
		} else value += ch;
	}
	if (quoted) throw new GenerationError('The output has an unclosed quoted field.');
	if (row.length || value) rows.push([...row, value]);
	return rows;
}

function columnsFromGrid(grid: string[][], names: string[]): Row[] {
	const [header, ...rows] = grid;
	if (!header || names.some(name => header.filter(h => h === name).length !== 1)) {
		throw new GenerationError('The output table is missing mapped columns or contains duplicate headers.');
	}
	return rows.map(row => {
		if (row.length !== header.length) throw new GenerationError('An output row has a different number of columns than its header.');
		return Object.fromEntries(names.map(name => [name, row[header.indexOf(name)]]));
	});
}

interface ElementNode {
	type: string;
	name: string;
	attribs: Record<string, string>;
	children: ElementNode[];
	data?: string;
}
const children = (node: ElementNode) => (node.children || []).filter(c => !!c.name);
const textContent = (node: ElementNode): string => node.data ?? (node.children || []).map(textContent).join('');
function descendants(node: ElementNode, name: string): ElementNode[] {
	return children(node).flatMap(child => child.name === name ? [child] : descendants(child, name));
}

function markupRows(text: string, mapping: TemplateMapping, format: string): Row[] {
	const doc = require('htmlparser2').parseDocument(text, { xmlMode: format === 'xml', decodeEntities: true }) as ElementNode;
	const names = Object.keys(mapping.columns);
	if (format === 'html') {
		const tables = descendants(doc, 'table').filter(table => table.attribs['data-table-sync'] === mapping.table);
		if (tables.length !== 1 || descendants(tables[0], 'table').length) {
			throw new GenerationError('The output needs one matching HTML table with plain cells.');
		}
		const grid = descendants(tables[0], 'tr').map(row => children(row).map(cell => {
			if (!['td', 'th'].includes(cell.name) || children(cell).length || cell.attribs.colspan || cell.attribs.rowspan) {
				throw new GenerationError('Merged or formatted HTML output cells cannot be imported.');
			}
			return textContent(cell);
		}));
		return columnsFromGrid(grid, names);
	}
	const find = (node: ElementNode | undefined, keys: string[]) =>
		keys.reduce<ElementNode | undefined>((parent, key) => parent && children(parent).find(child => child.name === key), node);
	const root = find(doc, mapping.root?.length ? mapping.root : [mapping.table]);
	if (!root) throw new GenerationError('The XML output is missing the mapped root element.');
	return children(root).filter(node => node.name === 'row').map(row =>
		Object.fromEntries(names.map(name => {
			const node = find(row, mapping.columns[name].path);
			return [name, node && textContent(node).trim()];
		})));
}

function propertyUnescape(value: string) {
	return value.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (_match, hex, char) =>
		hex ? String.fromCharCode(parseInt(hex, 16)) : ({ n: '\n', r: '\r', t: '\t' } as Row)[char] ?? char);
}

function lineRows(text: string, mapping: TemplateMapping, format: string): Row[] {
	const rootPath = mapping.root?.length ? mapping.root : [mapping.table];
	const envName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
	const root = format === 'env' ? rootPath.map(envName).join('__') : rootPath.join('.');
	const sep = format === 'env' ? '__' : '.';
	const paths = new Map(Object.entries(mapping.columns).map(([name, column]) =>
		[(format === 'env' ? column.path.map(envName) : column.path).join(sep), name]));
	if (paths.size !== Object.keys(mapping.columns).length) throw new GenerationError('Mapped output column names collide.');
	const entries: Row[] = [];
	const indexed = new Map<number, Row>();
	let active: Row | undefined;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || /^[#;!]/.test(line)) continue;
		if (format === 'toml' && line.startsWith('[')) {
			active = line === '[[' + root + ']]' ? {} : undefined;
			if (active) entries.push(active);
			continue;
		}
		if (format === 'ini' && line.startsWith('[')) {
			const section = line.slice(1, -1);
			const index = section.startsWith(root + '.') ? section.slice(root.length + 1) : '';
			active = /^\d+$/.test(index) ? {} : undefined;
			if (active) indexed.set(Number(index), active);
			continue;
		}
		const equals = line.indexOf('=');
		if (equals < 0) continue;
		let key = line.slice(0, equals).trim();
		let row = active;
		if (format === 'env' || format === 'properties') {
			if (!key.startsWith(root + sep)) continue;
			const parts = key.slice(root.length + sep.length).split(sep);
			const index = parts.shift() ?? '';
			if (!/^\d+$/.test(index)) continue;
			row = indexed.get(Number(index)) ?? {};
			indexed.set(Number(index), row);
			key = parts.join(sep);
		}
		const name = paths.get(key);
		if (!row || name === undefined) continue;
		if (Object.prototype.hasOwnProperty.call(row, name)) throw new GenerationError('Duplicate output field: ' + key);
		const rawValue = line.slice(equals + 1).trim();
		row[name] = rawValue.startsWith('"') && format !== 'properties'
			? JSON.parse(rawValue)
			: format === 'properties' ? propertyUnescape(rawValue) : rawValue;
	}
	return format === 'toml' ? entries : [...indexed].sort(([a], [b]) => a - b).map(([, row]) => row);
}

function outputRows(output: string, mapping: TemplateMapping, format: string): Row[] {
	const text = output.replace(/^\uFEFF/, '');
	const names = Object.keys(mapping.columns);
	switch (format) {
		case 'yaml':
		case 'json': {
			const value = format === 'json' ? JSON.parse(text) : safeLoad(text);
			const rows = lookup(value, mapping.root?.length ? mapping.root : [mapping.table]);
			if (!Array.isArray(rows)) throw new GenerationError('The output is missing the mapped row list.');
			return rows.map(row => Object.fromEntries(names.map(name => [name, lookup(row, mapping.columns[name].path)])));
		}
		case 'csv': return columnsFromGrid(delimited(text, ','), names);
		case 'tsv': return columnsFromGrid(delimited(text, '\t'), names);
		case 'xml':
		case 'html': return markupRows(text, mapping, format);
		default: return lineRows(text, mapping, format);
	}
}

export function canImportMapping(format: string): boolean {
	return ['yaml', 'json', 'csv', 'tsv', 'xml', 'html', 'toml', 'ini', 'env', 'properties'].includes(format);
}

export function markdownCell(value: unknown): string {
	return String(value ?? '').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

export function pipeRow(cells: string[]): string {
	return '| ' + cells.join(' | ') + ' |';
}

export function importMappedOutput(markdown: string, previousOutput: string, output: string, mapping: TemplateMapping, format: string): string {
	const old = extractTableRows(markdown, mapping.table, true);
	const [header, ...rows] = old;
	const outputData = outputRows(output, mapping, format);
	const previousData = outputRows(previousOutput, mapping, format);
	const key = mapping.key;
	if (key && !mapping.columns[key]) throw new GenerationError('The key column must be mapped to import the output.');
	const keyed = new Map<string, string[]>();
	if (key) {
		for (const row of rows) {
			const id = row[header.indexOf(key)];
			if (!id || keyed.has(id)) throw new GenerationError('The source key column must contain unique nonempty IDs.');
			keyed.set(id, row);
		}
	}
	const seen = new Set<string>();
	const mapped = outputData.map((row, index) => {
		const id = key ? String(row[key] ?? '') : '';
		if (key && (!id || seen.has(id))) throw new GenerationError('The output key column must contain unique nonempty IDs.');
		seen.add(id);
		const previous = key ? keyed.get(id) : rows[index];
		const oldValues = key ? previousData.find(old => String(old[key] ?? '') === id) : previousData[index];
		return header.map((column, col) => {
			const definition = Object.prototype.hasOwnProperty.call(mapping.columns, column) ? mapping.columns[column] : undefined;
			if (!definition) return previous?.[col] ?? '';
			const value = row[column];
			if (previous && oldValues && value === oldValues[column]) return previous[col] ?? '';
			if (value === undefined || (value !== null && typeof value === 'object')) {
				throw new GenerationError('Missing or invalid output value for ' + column + '.');
			}
			if (value === null || value === '') return '';
			if (definition.type === 'number' && (typeof value === 'boolean' || !Number.isFinite(Number(value)))) {
				throw new GenerationError('Expected a numeric value for ' + column + '.');
			}
			if (definition.type === 'boolean' && !['true', 'false'].includes(String(value))) {
				throw new GenerationError('Expected true or false for ' + column + '.');
			}
			if (definition.type === 'number') return String(Number(value));
			return format === 'tsv' ? String(value).replace(/\\n/g, '\n') : String(value);
		});
	});
	if (rows.length === mapped.length && JSON.stringify(mapped) === JSON.stringify(rows)) return markdown;
	// Reject ambiguous empty output for format dialects that cannot distinguish
	// an empty managed section from a wrong root or a damaged output file.
	if (!mapped.length && ['toml', 'ini', 'env', 'properties'].includes(format) && rows.length) {
		throw new GenerationError('No mapped output rows were found.');
	}
	const open = '<!-- table-sync:' + mapping.table + ' -->';
	const close = '<!-- /table-sync:' + mapping.table + ' -->';
	const start = markdown.indexOf(open) + open.length;
	const end = markdown.indexOf(close, start);
	const block = markdown.slice(start, end);
	const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
	const lines = block.split(/\r?\n/);
	const separator = lines.findIndex(line => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-') &&
		line.trim().split('|').filter(Boolean).every(cell => /^\s*:?-+:?\s*$/.test(cell)));
	if (separator < 0) throw new GenerationError('Cannot locate the Markdown table separator.');
	return markdown.slice(0, start) + [...lines.slice(0, separator + 1), ...mapped.map(row => pipeRow(row.map(markdownCell))), ''].join(eol) + markdown.slice(end);
}


// CKEditor discards HTML comments. Reattach mapping markers to the matching
// table before writing visual edits back to the Markdown document.
export function preserveMappingMarkers(previous: string, edited: string): string {
	const patterns = /^\s*<!-- table-sync:([^\r\n]+?) -->[^\S\r\n]*\r?\n([^\r\n]+)\r?\n/gm;
	const matches: RegExpExecArray[] = [];
	for (let match = patterns.exec(previous); match; match = patterns.exec(previous)) {
		if (!edited.includes('<!-- table-sync:' + match[1] + ' -->')) matches.push(match);
	}
	if (!matches.length) return edited;
	const lines = edited.split('\n');
	const inserts: Array<{ start: number; end: number; name: string }> = [];
	for (const [, name, header] of matches) {
		const columns = JSON.stringify(splitTableCells(header));
		const candidates = lines.flatMap((line, index) => {
			if (!line.trimStart().startsWith('|') || JSON.stringify(splitTableCells(line)) !== columns) return [];
			const separator = lines[index + 1];
			return separator && splitTableCells(separator).every(cell => /^:?-+:?$/.test(cell)) ? [index] : [];
		});
		if (!candidates.length) continue;
		if (candidates.length !== 1 || inserts.some(insertion => insertion.start === candidates[0])) {
			throw new GenerationError('Cannot identify the marked table "' + name + '" after editing. Modify its structure in Markdown source.');
		}
		const start = candidates[0];
		let end = start + 2;
		while (end < lines.length && lines[end].trimStart().startsWith('|')) end++;
		inserts.push({ start, end, name });
	}
	for (const { start, end, name } of inserts.sort((a, b) => b.start - a.start)) {
		lines.splice(end, 0, '<!-- /table-sync:' + name + ' -->');
		lines.splice(start, 0, '<!-- table-sync:' + name + ' -->');
	}
	return lines.join('\n');
}
