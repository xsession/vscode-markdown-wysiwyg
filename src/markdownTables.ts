// Markdown table parsing, document helpers and template context building.
//
// The conversion templates receive a context describing the opened Markdown
// document: every pipe table is parsed into header-keyed rows so a Jinja
// template can iterate over the data, plus a set of helper functions. The
// helpers below invert generate_md.py's rendering (escaped pipes, HTML
// entities, nested <table> cells, "N byte"/"N bit" sizes, R/W access) so a
// template can turn the register-map Markdown table back into data.

export interface ParsedRow {
	// Raw cell texts in column order (headers with spaces are only reachable
	// via index: row['Header text'] / row.cells).
	cells: string[];
	[key: string]: string | string[];
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

// "R" -> [read], "W" -> [write], "R/W" -> [read, write], "—" -> [].
export function accessFlags(s: string): string[] {
	const map: Record<string, string> = { R: 'read', W: 'write' };
	return s
		.split('/')
		.map((p) => {
			const t = p.trim();
			return map[t] ?? t.toLowerCase();
		})
		.filter((p) => p !== '' && p !== '—' && p !== '-');
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

export function firstHeading(markdown: string): string {
	const m = /^#{1,6}\s+(.+)$/m.exec(markdown);
	return m ? m[1].trim() : '';
}

// Context handed to a conversion template for the opened document.
export function buildMarkdownContext(markdown: string, source: string): Record<string, unknown> {
	const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const tables = parseMarkdownTables(normalized);
	const first = tables[0] ?? null;
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
		// Rows of the first table: objects keyed by header name plus .cells.
		rows: first ? first.rows : [],
		// Header names of the first table.
		headers: first ? first.headers : [],
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
		is_padding: (v: unknown) => isPadding(String(v ?? ''))
	};
}
