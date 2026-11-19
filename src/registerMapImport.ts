import { isDeepStrictEqual } from 'util';
import { GenerationError } from './codeGenerator';
import {
	accessDisplay, fieldDisplay, fieldOffset, locateRegisterRows, parseRegisterMapData, rowSubRows,
	sizeBits, sizeDisplay, splitTableCells, unescapeMarkdownCell
} from './markdownTables';
import { markdownCell, pipeRow } from './outputImport';

type Data = Record<string, unknown>;

function record(value: unknown): Data {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value as Data;
	throw new GenerationError('The register map contains an invalid object.');
}

function text(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string' && typeof value !== 'number') {
		throw new GenerationError('The register map contains an invalid cell value.');
	}
	return String(value);
}

function integer(value: unknown): number {
	const number = typeof value === 'number' ? value : NaN;
	if (!Number.isSafeInteger(number)) throw new GenerationError('Register sizes and enum values must be integers.');
	return number;
}

function htmlCell(value: string): string {
	return value.replace(/[&<>|\r\n`*_~\[\]]/g, char => '&#' + char.charCodeAt(0) + ';');
}

function nestedTable(headers: string[], cells: string[][]): string {
	const row = (type: string, values: string[]) =>
		'<tr>' + values.map(value => '<' + type + '>' + htmlCell(value) + '</' + type + '>').join('') + '</tr>';
	return '<table><thead>' + row('th', headers) + '</thead><tbody>' + cells.map(values => row('td', values)).join('') + '</tbody></table>';
}

function tableRows(name: string, type: Data, previousRows: string[][]): { headers: string[]; cells: string[][] } | undefined {
	if (type.format === 'enum') {
		return { headers: ['Value', 'Name'], cells: Object.entries(record(type.values)).map(([label, value]) => [String(integer(value)), label]) };
	}
	if (type.format === 'bitfield') {
		const fields = Object.entries(record(type.fields));
		const oldNames = previousRows.map(row => row[1]);
		const sameOffsets = fields.length === previousRows.length && fields.every(([field, value], i) =>
			fieldDisplay(name, field) === oldNames[i] && integer(record(value).size) === sizeBits(previousRows[i][2]));
		return {
			headers: ['Offset', 'Name', 'Size', 'Type', 'Description'],
			cells: fields.map(([field, value], index) => {
				const data = record(value);
				const size = integer(data.size);
				if (size <= 0) throw new GenerationError('Field sizes must be positive.');
				const unchanged = sameOffsets ? previousRows[index] : undefined;
				return [
					unchanged?.[0] ?? fieldOffset(fields, index),
					fieldDisplay(name, field),
					unchanged?.[2] ?? sizeDisplay(data),
					unchanged?.[3] ?? 'u' + size,
					text(data.doc)
				];
			})
		};
	}
}

function inlineDescription(original: string, changedDoc: string | undefined, changedSub: { headers: string[]; cells: string[][] } | undefined, removeSub: boolean, array: string | undefined) {
	const start = original.search(/<table\b/i);
	const end = original.toLowerCase().lastIndexOf('</table>') + '</table>'.length;
	const hadTable = start >= 0 && end > start;
	let description = hadTable ? original.slice(0, start) : original;
	const suffix = hadTable ? original.slice(end) : '';
	if (changedDoc !== undefined) {
		const arraySuffix = /\s*—\s*Array:.*$/i.exec(description)?.[0] ?? '';
		description = htmlCell(changedDoc) + arraySuffix;
	}
	if (array !== undefined) {
		description = description.replace(/\s*—\s*Array:.*$/i, '').trimEnd();
		if (array) description += (description ? ' ' : '') + array;
	}
	if (changedSub) {
		const separator = description && !/(?:<br\s*\/?\s*>|<\/p>)\s*$/i.test(description) ? '<br>' : '';
		return description + separator + nestedTable(changedSub.headers, changedSub.cells) + suffix;
	}
	return description + (hadTable && !removeSub ? original.slice(start, end) : '') + suffix;
}

export function importRegisterMap(markdown: string, previousOutput: string, output: string): string {
	const before = parseRegisterMapData(previousOutput);
	const after = parseRegisterMapData(output);
	if (!before || !after) throw new GenerationError('The output must contain a valid register types mapping.');
	const registers = (data: NonNullable<typeof before>) =>
		new Map(Object.entries(data.types).filter(([, entry]) => record(entry).format !== 'struct'));
	const previous = registers(before);
	const edited = registers(after);
	if (previous.size !== edited.size || [...previous.keys()].some(name => !edited.has(name))) {
		throw new GenerationError('Add, remove or rename registers in Markdown, where their offsets are defined.');
	}
	const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
	const lines = markdown.split(/\r?\n/);
	const located = locateRegisterRows(markdown);
	const headers = splitTableCells(lines[(located[0]?.line ?? 0) - 2] ?? '');
	const canonical = ['Offset', 'Word', 'Name', 'Size', 'Format', 'Access', 'Description'];
	if (!canonical.every(column => headers.includes(column))) throw new GenerationError('Cannot locate the register-map header.');
	if (located.some((entry, index) => located.findIndex(other => other.row.Name === entry.row.Name) !== index)) {
		throw new GenerationError('The Markdown register names must be unique.');
	}
	for (const { row, line, end, sub } of located.reverse()) {
		const name = String(row.Name);
		if (!previous.has(name)) continue;
		const old = record(previous.get(name));
		const next = record(edited.get(name));
		const cells = [...row.cells];
		const set = (column: string, value: string) => { cells[headers.indexOf(column)] = value; };
		const changedType = old.format !== next.format;
		if (changedType) set('Format', markdownCell(text(next.format)));
		if (next.format !== 'array' && (changedType || old.size !== next.size)) {
			if (integer(next.size) <= 0) throw new GenerationError('Register sizes must be positive.');
			set('Size', sizeDisplay(next));
		}
		const flags = (data: Data) => data.fpga && record(data.fpga).flags;
		if (!isDeepStrictEqual(flags(old), flags(next))) {
			const access = flags(next);
			if (!Array.isArray(access) || access.some(flag => flag !== 'read' && flag !== 'write')) {
				throw new GenerationError('Register flags must contain read and/or write.');
			}
			set('Access', accessDisplay(access));
		}
		const oldDoc = text(old.doc);
		const doc = oldDoc === text(next.doc) ? undefined : text(next.doc);
		let array: string | undefined;
		if (next.format === 'array' && (changedType || next.length !== old.length || next.bit_width !== old.bit_width)) {
			const length = integer(next.length), width = integer(next.bit_width);
			if (length <= 0 || width <= 0) throw new GenerationError('Array length and bit width must be positive.');
			set('Size', length * Math.ceil(width / 8) + ' byte');
			array = '— Array: ' + length + ' x u' + width + ' (' + Math.ceil(width / 8) + ' byte elements)';
		} else if (old.format === 'array' && changedType) array = '';
		const changedSub = changedType || !isDeepStrictEqual(old.fields, next.fields) || !isDeepStrictEqual(old.values, next.values);
		const oldRows = sub ? sub.dataRows.map(i => splitTableCells(lines[i])) : rowSubRows(row);
		const replacement = changedSub ? tableRows(name, next, oldRows) : undefined;
		const attached = Boolean(sub || row.doc?.trim());
		if (attached) {
			if (changedSub && (sub || replacement)) {
				const table = replacement ? [
					pipeRow(replacement.headers), pipeRow(replacement.headers.map(() => '---')),
					...replacement.cells.map(values => pipeRow(values.map(markdownCell)))
				] : [];
				if (sub) lines.splice(sub.start, sub.end - sub.start, ...table);
				else {
					const afterProse = Math.min(end, line + 2 + (row.doc?.trim() ? 1 : 0));
					lines.splice(afterProse, 0, '', ...table, '');
				}
			}
			if (doc !== undefined) {
				let first = line + 1;
				while (first < (sub?.start ?? end) && !lines[first].trim()) first++;
				let last = first;
				while (last < (sub?.start ?? end) && !/^[|#]/.test(lines[last].trim())) last++;
				while (last > first && !lines[last - 1].trim()) last--;
				const currentDoc = lines.slice(first, last).map(value => unescapeMarkdownCell(value.trim())).filter(Boolean).join(' ');
				if (oldDoc && currentDoc !== oldDoc) {
					throw new GenerationError('Cannot safely locate the source description for ' + name + '.');
				}
				lines.splice(first, last - first, ...(doc ? doc.split(/\r?\n/) : []));
			}
			if (array !== undefined) set('Description', inlineDescription(text(row.Description), undefined, undefined, false, array));
		} else if (doc !== undefined || changedSub || array !== undefined) {
			set('Description', inlineDescription(text(row.Description), doc, replacement, changedSub && !replacement, array));
		}
		if (!isDeepStrictEqual(cells, row.cells)) lines[line] = pipeRow(cells.map(markdownCell));
	}
	return lines.join(eol);
}
