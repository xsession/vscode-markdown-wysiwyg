// Markdown table parsing, document helpers and template context building.
//
// The conversion templates receive a context describing the opened Markdown
// document: every pipe table is parsed into header-keyed rows so a Jinja
// template can iterate over the data, plus a set of helper functions. The
// helpers below invert generate_md.py's rendering (escaped pipes, HTML
// entities, nested <table> cells, "N byte"/"N bit" sizes, R/W access) so a
// template can turn the register-map Markdown table back into data.

import { safeLoad } from 'js-yaml';

export interface ParsedRow {
	// Raw cell texts in column order (headers with spaces are only reachable
	// via index: row['Header text'] / row.cells).
	cells: string[];
	[key: string]: unknown;
	// Register-map document extensions (set by buildRegisterRows): the prose
	// description that follows the row and the first table that follows it.
	doc?: string;
	subheaders?: string[];
	subrows?: string[][];
}

export interface ParsedTable {
	headers: string[];
	rows: ParsedRow[];
}

// --------------------------------------------------------------------------- //
// Cell / table helpers (inverse of generate_md.py cell() + nested tables)
// --------------------------------------------------------------------------- //

export function htmlUnescape(s: string): string {
	return s
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}

export function stripHtmlTags(s: string): string {
	return htmlUnescape(s.replace(/<[^>]*>/g, ''));
}

// Reverse of generate_md.py cell(): it escaped | as \| and < > as entities.
export function unescapeMarkdownCell(s: string): string {
	return htmlUnescape(s).replace(/\\\|/g, '|');
}

// Parse the first <table> in a cell into rows of unescaped cell strings.
export function parseTableRows(s: string): string[][] {
	const m = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(s);
	if (!m) return [];
	const rows: string[][] = [];
	for (const tr of m[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
		const cells: string[] = [];
		for (const td of tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []) {
			cells.push(unescapeMarkdownCell(stripHtmlTags(td)).trim());
		}
		rows.push(cells);
	}
	return rows;
}

// "4 byte" -> 32, "1 bit" -> 1, "32" -> 32, "0x20" -> 32, else 0.
export function sizeBits(s: string): number {
	const t = s.trim();
	let m = /^(\d+)\s*byte/i.exec(t);
	if (m) return parseInt(m[1], 10) * 8;
	m = /^(\d+)\s*bit/i.exec(t);
	if (m) return parseInt(m[1], 10);
	if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
	m = /^\d+$/.exec(t);
	if (m) return parseInt(m[0], 10);
	return 0;
}

// "R" -> [read], "W" -> [write], "R/W" and "RW" -> [read, write], "—" -> [].
export function accessFlags(s: string): string[] {
	const map: Record<string, string> = { R: 'read', W: 'write' };
	const out: string[] = [];
	for (const part of s.split('/')) {
		const t = part.trim();
		if (t === '' || t === '—' || t === '-') continue;
		// Joined forms like "RW" expand to their letters.
		const letters = /^[rRwW]+$/.test(t) ? t.toUpperCase().split('') : [t];
		for (const L of letters) {
			out.push(map[L] ?? L.toLowerCase());
		}
	}
	return out;
}

// Description text before the nested HTML table / <br> / array suffix.
export function descBase(s: string): string {
	const br = s.search(/<br\s*\/?>/i);
	const tbl = s.search(/<table/i);
	const arr = s.search(/\s—\s*Array:/i);
	let cut = s.length;
	for (const c of [br, tbl, arr]) {
		if (c !== -1) cut = Math.min(cut, c);
	}
	return unescapeMarkdownCell(s.slice(0, cut)).trim();
}

// "Array: 8 x u32 (4 byte elements)" -> { length: 8, bit_width: 32 } | null.
export function arrayInfo(s: string): { length: number; bit_width: number } | null {
	const m = /Array:\s*(\d+)\s*x\s*u(\d+)/i.exec(s);
	return m ? { length: parseInt(m[1], 10), bit_width: parseInt(m[2], 10) } : null;
}

// The array suffix a register-map table keeps in the Description cell,
// e.g. " — Array: 8 x u32 (4 byte elements)" (the inverse of arrayInfo).
export function arraySuffix(t: unknown): string {
	const o = (t ?? {}) as Record<string, unknown>;
	if (o.format !== 'array') return '';
	const bw = Number(o.bit_width) || 0;
	const len = Number(o.length) || 0;
	return ` — Array: ${len} x u${bw} (${Math.max(1, bw / 8)} byte elements)`;
}

export function isPadding(name: string): boolean {
	const t = name.trim();
	return t === 'reserved' || t === 'padding' || t.endsWith('_padding');
}

// Split one pipe-table line into cell texts. Handles the escaped-pipe
// convention used by generate_md.py cell() ("\|" is a literal pipe).
export function splitTableCells(line: string): string[] {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|')) s = s.slice(0, -1);
	const cells: string[] = [];
	let cur = '';
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '\\' && s[i + 1] === '|') {
			cur += '|';
			i++;
			continue;
		}
		if (c === '|') {
			cells.push(cur.trim());
			cur = '';
			continue;
		}
		cur += c;
	}
	cells.push(cur.trim());
	return cells;
}

function isSeparatorLine(line: string): boolean {
	const cells = splitTableCells(line);
	return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

export function parseMarkdownTables(markdown: string): ParsedTable[] {
	const lines = markdown.split(/\r?\n/);
	const tables: ParsedTable[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!lines[i].trim().startsWith('|')) {
			i++;
			continue;
		}
		let j = i;
		while (j < lines.length && lines[j].trim().startsWith('|')) j++;
		const block = lines.slice(i, j);
		// A table needs a header line, a |---| separator line and >= 1 data row.
		if (block.length >= 3 && isSeparatorLine(block[1])) {
			const headers = splitTableCells(block[0]);
			const rows: ParsedRow[] = [];
			for (let k = 2; k < block.length; k++) {
				const cells = splitTableCells(block[k]);
				const row: ParsedRow = { cells };
				headers.forEach((h, idx) => {
					row[h] = cells[idx] ?? '';
				});
				rows.push(row);
			}
			tables.push({ headers, rows });
		}
		i = j;
	}
	return tables;
}

// --------------------------------------------------------------------------- //
// Register-map document rows.
//
// Two document styles exist:
//  1. One continuous pipe table where each register's description and nested
//     field/enum table live INSIDE the Description cell (demo_fpga_types.md).
//  2. Each register is a single pipe row, often a lone line of its own,
//     followed by a prose description and a nested field/enum table as
//     separate lines (pab1_fpga_types.md). Bare "|" lines act as row
//     separators.
// buildRegisterRows produces a unified row list for both: the first table's
// data rows plus every stray pipe row that matches its column count, in
// document order; each row carries the prose and the first table that follow
// it (doc / subheaders / subrows).

interface TableRun {
	start: number;
	end: number;
	header: string[];
	dataRows: number[];
}

function isPipeLine(line: string): boolean {
	return line.trim().startsWith('|');
}

function findTableRuns(lines: string[]): TableRun[] {
	const runs: TableRun[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!isPipeLine(lines[i])) {
			i++;
			continue;
		}
		let j = i;
		while (j < lines.length && isPipeLine(lines[j])) j++;
		const block = lines.slice(i, j);
		if (block.length >= 3 && isSeparatorLine(block[1])) {
			runs.push({
				start: i,
				end: j,
				header: splitTableCells(block[0]),
				dataRows: block.slice(2).map((_, k) => i + 2 + k)
			});
		}
		i = j;
	}
	return runs;
}

export function buildRegisterRows(markdown: string): ParsedRow[] {
	const lines = markdown.split(/\r?\n/);
	const runs = findTableRuns(lines);
	const main = runs[0];
	if (!main) return [];
	const colCount = main.header.length;
	const nameIdx = Math.max(0, main.header.findIndex((h) => h.toLowerCase() === 'name'));

	// Candidate register rows: the main table's data rows plus stray pipe
	// lines whose cell count matches the main header (the Description column
	// may be omitted, hence colCount - 1) and whose Name cell is non-empty.
	const rowLineIdx: number[] = [];
	for (let k = 0; k < lines.length; k++) {
		if (!isPipeLine(lines[k])) continue;
		const run = runs.find((t) => k >= t.start && k < t.end);
		if (run) {
			if (run === main && run.dataRows.includes(k)) rowLineIdx.push(k);
			continue; // nested table lines are never register rows
		}
		const cells = splitTableCells(lines[k]);
		if (cells.length === colCount || cells.length === colCount - 1) {
			if ((cells[nameIdx] ?? '').trim() !== '') rowLineIdx.push(k);
		}
	}
	rowLineIdx.sort((a, b) => a - b);

	const rows: ParsedRow[] = [];
	rowLineIdx.forEach((k, n) => {
		const cells = splitTableCells(lines[k]);
		const row: ParsedRow = { cells };
		main.header.forEach((h, idx) => {
			row[h] = cells[idx] ?? '';
		});
		// Attach the prose + first table that follow this row, stopping at
		// the next register row.
		const end = n + 1 < rowLineIdx.length ? rowLineIdx[n + 1] : lines.length;
		const prose: string[] = [];
		for (let j = k + 1; j < end; j++) {
			const line = lines[j];
			if (isPipeLine(line)) break; // nested table or next row starts
			if (line.trim() !== '') prose.push(unescapeMarkdownCell(line.trim()));
		}
		row.doc = prose.join(' ');
		const sub = runs.find((t) => t.start > k && t.start < end);
		if (sub) {
			row.subheaders = sub.header;
			row.subrows = [];
			for (let j = sub.start; j < sub.end; j++) {
				if (j === sub.start + 1) continue; // |---| separator line
				row.subrows.push(splitTableCells(lines[j]));
			}
		}
		rows.push(row);
	});
	return rows;
}

// Description of a register row: attached prose when present, otherwise the
// text before the nested table / <br> / array suffix inside the Description
// cell (style 1 documents).
export function rowDoc(row: ParsedRow): string {
	if (row.doc && row.doc.trim() !== '') return row.doc.trim();
	return descBase(String(row.Description ?? ''));
}

// Data rows (header excluded) of a register row's nested table: the attached
// subtable when present, otherwise the <table> inside the Description cell.
export function rowSubRows(row: ParsedRow): string[][] {
	if (row.subrows && row.subrows.length > 1) return row.subrows.slice(1);
	if (row.subrows && row.subrows.length === 1) return [];
	return parseTableRows(String(row.Description ?? '')).slice(1);
}

export function firstHeading(markdown: string): string {
	const m = /^#{1,6}\s+(.+)$/m.exec(markdown);
	return m ? m[1].trim() : '';
}

// --------------------------------------------------------------------------- //
// Backward templates (YAML/JSON -> Markdown) and live section sync helpers.
// --------------------------------------------------------------------------- //

/**
 * Parse the opened document as a register-map data file (the output of the
 * forward templates): a YAML or JSON object with a "types" mapping. Returns
 * the parsed value, or null when the document is not one (e.g. Markdown).
 */
export function parseRegisterMapData(text: string): { types: Record<string, unknown> } | null {
	const ok = (v: unknown): v is { types: Record<string, unknown> } =>
		!!v &&
		typeof v === 'object' &&
		!Array.isArray(v) &&
		!!(v as Record<string, unknown>).types &&
		typeof (v as Record<string, unknown>).types === 'object' &&
		!Array.isArray((v as Record<string, unknown>).types);
	try {
		const v = safeLoad(text);
		if (ok(v)) return v;
	} catch {
		// not YAML — try JSON
	}
	try {
		const v = JSON.parse(text);
		if (ok(v)) return v;
	} catch {
		// not a register-map data file
	}
	return null;
}

// Object iteration helpers (the 'for' statement only iterates lists).
export function keysOf(v: unknown): string[] {
	return v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object) : [];
}
export function itemsOf(v: unknown): [string, unknown][] {
	const o = (v ?? {}) as Record<string, unknown>;
	return keysOf(o).map((k) => [k, o[k]]);
}

// Display helpers for the backward templates (inverse of the forward
// templates' size_bits / access_flags).
// 32 -> "4 byte", 16 -> "2 byte", 29 -> "29 bit"; array types -> "8 x 4 byte".
export function sizeDisplay(t: unknown): string {
	const o = (t ?? {}) as Record<string, unknown>;
	if (o.format === 'array') {
		const bw = Number(o.bit_width) || 0;
		return `${Number(o.length) || 0} x ${Math.max(1, bw / 8)} byte`;
	}
	const n = Number(o.size);
	if (!Number.isFinite(n) || n <= 0) return String(o.size ?? '');
	return n % 8 === 0 ? `${n / 8} byte` : `${n} bit`;
}
// ["read","write"] -> "RW", ["read"] -> "R", ["write"] -> "W", [] -> "—".
export function accessDisplay(flags: unknown): string {
	const list = Array.isArray(flags) ? flags.map((f) => String(f)) : [];
	const s = list.includes('read') ? 'R' : '' ;
	const w = list.includes('write') ? 'W' : '';
	return s + w || '—';
}
// "controlWord_padding" (register "controlWord") -> "reserved" (the name the
// forward templates expect in the table); everything else unchanged.
export function fieldDisplay(register: unknown, field: unknown): string {
	const f = String(field ?? '');
	return f === `${String(register ?? '')}_padding` ? 'reserved' : f;
}
// Starting bit offset of field index i in a bitfield: pairs is the
// [name, {size}] list from `t.fields | items`. 0 -> "bit 0", 16 -> "byte 2".
export function fieldOffset(pairs: unknown, i: unknown): string {
	const list = Array.isArray(pairs) ? pairs : [];
	const idx = Math.max(0, Math.trunc(Number(i)));
	let off = 0;
	for (let j = 0; j < idx && j < list.length; j++) {
		const pair = list[j];
		if (Array.isArray(pair) && pair.length > 1) {
			const f = pair[1] as Record<string, unknown>;
			off += Number(f && f.size !== undefined ? f.size : pair[1]);
		}
	}
	return off % 8 === 0 && off > 0 ? `byte ${off / 8}` : `bit ${off}`;
}
// Escape a string for a Markdown table cell (inverse of unesc_md / cell()).
// Only the pipe is escaped — that is all unesc_md reverses, so round trips
// stay stable (HTML text passes through as-is).
export function escapeMarkdownCell(s: string): string {
	return s.replace(/\|/g, '\\|');
}

// --------------------------------------------------------------------------- //
// Live input -> output section sync: section markers, spans and diffs.
// --------------------------------------------------------------------------- //

/** A register section's start/end line in a generated output file. */
export interface RegisterSpan {
	start: number;
	end: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Markdown register rows look like "| 0 | 0 | name | ..." (numeric offset +
// word cells); other formats carry a per-register "@register <name>" marker
// line emitted by the bundled templates.
const mdRowRe = /^\|\s*\d+\s*\|/;
const hasMarker = (line: string, name?: string): boolean => {
	if (name) {
		return line.includes(`@register ${name}`) || line.includes(`"@register": "${name}"`);
	}
	return line.includes('@register ') || line.includes('"@register":');
};

export function findRegisterSpan(text: string, format: string, name: string): RegisterSpan | null {
	const lines = text.split('\n');
	const rowFor = (l: string, n: string) => {
		const m = mdRowRe.exec(l);
		if (!m) return false;
		const cells = l.split('|').map((c) => c.trim());
		return (cells[3] ?? '') === n;
	};
	let start = -1;
	if (format === 'markdown') {
		start = lines.findIndex((l) => rowFor(l, name));
		if (start < 0) start = lines.findIndex((l) => l.includes(name));
	} else {
		start = lines.findIndex((l) => hasMarker(l, name));
	}
	if (start < 0) return null;
	let end = lines.length;
	for (let j = start + 1; j < lines.length; j++) {
		const isNext = format === 'markdown' ? mdRowRe.test(lines[j]) : hasMarker(lines[j]);
		if (isNext) {
			end = j;
			break;
		}
	}
	return { start, end };
}

/** [registerName, stableContentString] pairs, in document order. */
export type Fingerprint = [string, string];

// Per-section content fingerprints for the current document text: the
// register-map types (YAML/JSON input) or the parsed register rows (Markdown
// input). Used to detect which section an edit touched.
export function fingerprintsFromDocument(text: string): Fingerprint[] {
	const data = parseRegisterMapData(text);
	if (data) {
		return Object.entries(data.types).map(([k, v]) => [k, JSON.stringify(v)]);
	}
	return buildRegisterRows(text).map((r) => [
		String(r.Name ?? ''),
		JSON.stringify({ cells: r.cells, doc: r.doc ?? '', subrows: r.subrows ?? [] })
	]);
}

// First section that changed (content, addition or removal) between two
// fingerprint lists, or null when nothing section-visible changed.
export function diffFingerprints(oldFp: Fingerprint[], newFp: Fingerprint[]): string | null {
	const o = new Map(oldFp);
	const n = new Map(newFp);
	for (const [name, data] of n) {
		if (o.get(name) !== data) return name;
	}
	for (const [name] of o) {
		if (!n.has(name)) return name;
	}
	return null;
}

// Context handed to a conversion template for the opened document.
export function buildMarkdownContext(markdown: string, source: string): Record<string, unknown> {
	const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const tables = parseMarkdownTables(normalized);
	const first = tables[0] ?? null;
	// Merged register rows: the first table's data rows plus stray pipe rows
	// (one-line register entries), each with attached doc / subtable.
	const rows = buildRegisterRows(normalized);
	// Parsed register-map data (YAML/JSON documents) for the backward
	// templates; null for Markdown documents.
	const registerMap = parseRegisterMapData(normalized);
	return {
		// The full document text (line endings normalized to \n).
		markdown: normalized,
		// Basename of the opened Markdown document, e.g. "demo_fpga_types.md".
		source,
		// First heading text, or ''.
		title: firstHeading(normalized),
		// Every pipe table in the document.
		tables,
		// The first table (null when the document has none).
		table: first,
		// Register rows (objects keyed by header name plus .doc, .subrows)
		// in document order — see buildRegisterRows.
		rows,
		// Header names of the first table.
		headers: first ? first.headers : [],
		// Parsed register-map data file (YAML/JSON input) or null.
		register_map: registerMap,
		// The "types" mapping of a register-map data file, or null — iterate
		// with `for name, t in types | items`.
		types: registerMap ? registerMap.types : null,
		// Small standard helpers callable as functions in expressions.
		len: (v: unknown) => (Array.isArray(v) ? v.length : String(v ?? '').length),
		min: (v: unknown) =>
			Array.isArray(v) && v.length ? Math.min(...v.map((x) => Number(x))) : null,
		max: (v: unknown) =>
			Array.isArray(v) && v.length ? Math.max(...v.map((x) => Number(x))) : null,
		abs: (v: unknown) => Math.abs(Number(v)),
		range: (n: unknown) => {
			const count = Math.max(0, Math.trunc(Number(n)));
			return Array.from({ length: count }, (_, i) => i);
		},
		// Document-conversion helpers (filter versions are in jinjaTemplate.ts).
		size_bits: (v: unknown) => sizeBits(String(v ?? '')),
		access_flags: (v: unknown) => accessFlags(String(v ?? '')),
		desc_base: (v: unknown) => descBase(String(v ?? '')),
		desc_rows: (v: unknown) => parseTableRows(String(v ?? '')),
		array_info: (v: unknown) => arrayInfo(String(v ?? '')),
		is_padding: (v: unknown) => isPadding(String(v ?? '')),
		row_doc: (v: unknown) => (v !== null && typeof v === 'object' ? rowDoc(v as ParsedRow) : descBase(String(v ?? ''))),
		row_subrows: (v: unknown) => (v !== null && typeof v === 'object' ? rowSubRows(v as ParsedRow) : parseTableRows(String(v ?? '')).slice(1)),
		// Object iteration (the 'for' statement only iterates lists).
		keys: (v: unknown) => keysOf(v),
		items: (v: unknown) => itemsOf(v),
		// Parsers for the backward templates (null when the text doesn't parse).
		yaml_parse: (v: unknown) => {
			try {
				return safeLoad(String(v ?? ''));
			} catch {
				return null;
			}
		},
		json_parse: (v: unknown) => {
			try {
				return JSON.parse(String(v ?? ''));
			} catch {
				return null;
			}
		},
		// Backward-template display helpers (inverse of size_bits/access_flags).
		size_display: (v: unknown) => sizeDisplay(v),
		access_display: (v: unknown) => accessDisplay(v),
		field_display: (v: unknown, reg: unknown) => fieldDisplay(reg, v),
		field_offset: (v: unknown, i: unknown) => fieldOffset(v, i),
		esc_md: (v: unknown) => escapeMarkdownCell(String(v ?? '')),
		// Array Description-cell suffix (inverse of array_info), '' otherwise.
		array_suffix: (v: unknown) => arraySuffix(v),
	};
}
