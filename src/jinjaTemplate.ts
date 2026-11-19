// Jinja-style template engine (TypeScript backend).
//
// A small, dependency-free renderer for the subset of the Jinja2 language used
// by the format-conversion templates bundled with this extension. It lets a
// single `.j2` file describe how the opened Markdown document converts into
// the selected output format, with the heavy lifting (Markdown table parsing,
// HTML cell helpers, size/access parsing) exposed as filters and context
// functions so templates stay declarative.
//
// Supported syntax:
//   {{ expression }}            output an expression
//   {%- ... %} / {{- ... -}}    '-' next to a delimiter trims adjacent whitespace
//   {# comment #}               comments (never rendered)
//   {% for x in seq %} ... {% endfor %}          (also "for a, b in seq")
//   {% if cond %} ... {% elif cond %} ... {% else %} ... {% endif %}
//   {% set name = expr %}
//   {% raw %} ... {% endraw %}
//
// Expressions:
//   literals: numbers (incl. 0x hex), 'single' / "double" strings,
//             true / false / none / null
//   names, name.attr, name[index], calls: len(x), min(x), max(x), abs(x),
//     range(n) plus context-provided functions (size_bits, desc_rows, ...)
//   operators: + - * / // %  == != < > <= >=  and or not  (left-associative)
//   'a if cond else b'
//   filters: expr | filter | filter(args); an attribute or [index] may follow
//     the filter result, e.g. r.Description | array_info.bit_width

import { safeLoad as yamlSafeLoad } from 'js-yaml';

import {
	buildMarkdownContext,
	sizeBits,
	accessFlags,
	descBase,
	parseTableRows,
	arrayInfo,
	isPadding,
	htmlUnescape,
	stripHtmlTags,
	unescapeMarkdownCell,
	rowDoc,
	rowSubRows,
	keysOf,
	itemsOf,
	sizeDisplay,
	accessDisplay,
	fieldDisplay,
	fieldOffset,
	escapeMarkdownCell,
	arraySuffix,
	ParsedRow
} from './markdownTables';

export class TemplateError extends Error {}

// --------------------------------------------------------------------------- //
// AST
// --------------------------------------------------------------------------- //

type ExprNode =
	| { t: 'num'; v: number }
	| { t: 'str'; v: string }
	| { t: 'bool'; v: boolean }
	| { t: 'none' }
	| { t: 'list'; items: ExprNode[] }
	| { t: 'name'; name: string }
	| { t: 'member'; base: ExprNode; prop: string }
	| { t: 'index'; base: ExprNode; key: ExprNode }
	| { t: 'slice'; base: ExprNode; start: ExprNode | null; stop: ExprNode | null }
	| { t: 'call'; fn: ExprNode; args: ExprNode[] }
	| { t: 'unary'; op: '-' | 'not'; v: ExprNode }
	| { t: 'bin'; op: string; l: ExprNode; r: ExprNode }
	| { t: 'and'; l: ExprNode; r: ExprNode }
	| { t: 'or'; l: ExprNode; r: ExprNode }
	| { t: 'ternary'; cond: ExprNode; a: ExprNode; b: ExprNode }
	| { t: 'filter'; base: ExprNode; name: string; args: ExprNode[] };

type Node =
	| { kind: 'text'; value: string }
	| { kind: 'expr'; expr: ExprNode }
	| { kind: 'for'; targets: string[]; iter: ExprNode; body: Node[] }
	| { kind: 'if'; branches: { cond: ExprNode | null; body: Node[] }[] }
	| { kind: 'set'; name: string; value: ExprNode };

// --------------------------------------------------------------------------- //
// Template lexer
// --------------------------------------------------------------------------- //

interface TemplateToken {
	kind: 'text' | 'expr' | 'stmt' | 'comment';
	value: string;
	trimLeft: boolean;
	trimRight: boolean;
}

function lexTemplate(source: string): TemplateToken[] {
	const tokens: TemplateToken[] = [];
	let textStart = 0;
	let i = 0;
	while (i < source.length) {
		const isExpr = source.startsWith('{{', i);
		const isStmt = source.startsWith('{%', i);
		const isComment = source.startsWith('{#', i);
		if (!isExpr && !isStmt && !isComment) {
			i++;
			continue;
		}
		const close = isExpr ? '}}' : isStmt ? '%}' : '#}';
		const end = source.indexOf(close, i + 2);
		if (end === -1) {
			throw new TemplateError(`unterminated ${close} starting at offset ${i}`);
		}
		if (i > textStart) {
			tokens.push({ kind: 'text', value: source.slice(textStart, i), trimLeft: false, trimRight: false });
		}
		const openMark = source[i + 2] === '-';
		const closeMark = end > i + 2 && source[end - 1] === '-';
		const value = source.slice(i + (openMark ? 3 : 2), end - (closeMark ? 1 : 0)).trim();
		// {% raw %} ... {% endraw %}: emit the content as plain text,
		// un-tokenized, so inner {{ }} / {% %} survive verbatim.
		if (isStmt && value === 'raw') {
			const afterRaw = end + 2;
			const m = /\{%\s*endraw\s*%\}/.exec(source.slice(afterRaw));
			if (!m) throw new TemplateError('raw block not closed with endraw');
			tokens.push({
				kind: 'text',
				value: source.slice(afterRaw, afterRaw + m.index),
				trimLeft: false,
				trimRight: false
			});
			textStart = afterRaw + m.index + m[0].length;
			i = textStart;
			continue;
		}
		tokens.push({
			kind: isExpr ? 'expr' : isStmt ? 'stmt' : 'comment',
			value,
			trimLeft: openMark,
			trimRight: closeMark
		});
		textStart = end + 2;
		i = textStart;
	}
	if (textStart < source.length) {
		tokens.push({ kind: 'text', value: source.slice(textStart), trimLeft: false, trimRight: false });
	}
	return tokens;
}

// Apply '-' whitespace control: trimLeft removes trailing whitespace from the
// previous text token, trimRight removes leading whitespace from the next one.
function applyTrim(tokens: TemplateToken[]): void {
	const trimPrev = (from: number) => {
		for (let j = from - 1; j >= 0; j--) {
			if (tokens[j].kind !== 'text') continue;
			tokens[j].value = tokens[j].value.replace(/\s+$/, '');
			return;
		}
	};
	const trimNext = (from: number) => {
		for (let j = from + 1; j < tokens.length; j++) {
			if (tokens[j].kind !== 'text') continue;
			tokens[j].value = tokens[j].value.replace(/^\s+/, '');
			return;
		}
	};
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t.kind === 'text') continue;
		if (t.trimLeft) trimPrev(i);
		if (t.trimRight) trimNext(i);
	}
}

// --------------------------------------------------------------------------- //
// Expression tokenizer / parser
// --------------------------------------------------------------------------- //

interface Tok {
	type: 'ident' | 'number' | 'string' | 'op' | 'eof';
	value: string;
}

function tokenizeExpression(src: string): Tok[] {
	const toks: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
			const m = /^0[xX][0-9a-fA-F]+|^\d+(\.\d+)?/.exec(src.slice(i));
			if (!m) throw new TemplateError(`bad number near '${src.slice(i)}' in expression`);
			toks.push({ type: 'number', value: m[0] });
			i += m[0].length;
			continue;
		}
		if (/[A-Za-z_]/.test(c)) {
			const m = /^[A-Za-z_]\w*/.exec(src.slice(i));
			if (!m) throw new TemplateError(`bad identifier near '${src.slice(i)}' in expression`);
			toks.push({ type: 'ident', value: m[0] });
			i += m[0].length;
			continue;
		}
		if (c === '"' || c === "'") {
			let j = i + 1;
			let out = '';
			while (j < src.length && src[j] !== c) {
				if (src[j] === '\\' && j + 1 < src.length) {
					const e = src[j + 1];
					out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
					j += 2;
					continue;
				}
				out += src[j];
				j++;
			}
			if (j >= src.length) {
				throw new TemplateError(`unterminated string in expression: ${src}`);
			}
			toks.push({ type: 'string', value: out });
			i = j + 1;
			continue;
		}
		const two = src.slice(i, i + 2);
		if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '//') {
			toks.push({ type: 'op', value: two });
			i += 2;
			continue;
		}
		if ('+-*/%|().[]:<>,'.includes(c)) {
			toks.push({ type: 'op', value: c });
			i++;
			continue;
		}
		throw new TemplateError(`unexpected character '${c}' in expression: ${src}`);
	}
	toks.push({ type: 'eof', value: '' });
	return toks;
}

class ExpressionParser {
	private pos = 0;
	constructor(private readonly toks: Tok[]) {}

	private peek(): Tok {
		return this.toks[this.pos];
	}
	private next(): Tok {
		const t = this.toks[this.pos];
		if (t.type === 'eof') throw new TemplateError('unexpected end of expression');
		this.pos++;
		return t;
	}
	private matchIdent(name: string): boolean {
		const t = this.peek();
		if (t.type === 'ident' && t.value === name) {
			this.pos++;
			return true;
		}
		return false;
	}
	private peekOp(ops: string[]): string | null {
		const t = this.peek();
		if (t.type === 'op' && ops.includes(t.value)) return t.value;
		return null;
	}
	private matchOp(ops: string[]): boolean {
		if (this.peekOp(ops)) {
			this.pos++;
			return true;
		}
		return false;
	}
	private expectOp(op: string): void {
		if (!this.matchOp([op])) {
			throw new TemplateError(`expected '${op}' in expression`);
		}
	}

	parse(): ExprNode {
		const e = this.parseTernary();
		if (this.peek().type !== 'eof') {
			throw new TemplateError(`unexpected token '${this.peek().value}' in expression`);
		}
		return e;
	}

	private parseTernary(): ExprNode {
		const a = this.parseOr();
		if (this.matchIdent('if')) {
			const cond = this.parseOr();
			if (!this.matchIdent('else')) {
				throw new TemplateError("ternary 'if' requires 'else'");
			}
			return { t: 'ternary', cond, a, b: this.parseTernary() };
		}
		return a;
	}

	private parseOr(): ExprNode {
		let l = this.parseAnd();
		while (this.matchIdent('or')) l = { t: 'or', l, r: this.parseAnd() };
		return l;
	}

	private parseAnd(): ExprNode {
		if (this.matchIdent('not')) return { t: 'unary', op: 'not', v: this.parseAnd() };
		let l = this.parseCompare();
		while (this.matchIdent('and')) l = { t: 'and', l, r: this.parseCompare() };
		return l;
	}

	private parseCompare(): ExprNode {
		let l = this.parseConcat();
		for (;;) {
			const op = this.peekOp(['==', '!=', '<', '>', '<=', '>=']);
			if (!op) break;
			this.pos++;
			l = { t: 'bin', op, l, r: this.parseConcat() };
		}
		return l;
	}

	private parseConcat(): ExprNode {
		let l = this.parseMul();
		while (this.peekOp(['+', '-'])) {
			const op = this.next().value;
			l = { t: 'bin', op, l, r: this.parseMul() };
		}
		return l;
	}

	private parseMul(): ExprNode {
		let l = this.parseFilterExpr();
		while (this.peekOp(['*', '/', '//', '%'])) {
			const op = this.next().value;
			l = { t: 'bin', op, l, r: this.parseFilterExpr() };
		}
		return l;
	}

	private parseFilterExpr(): ExprNode {
		let e = this.parseUnary();
		while (this.matchOp(['|'])) {
			const nameTok = this.next();
			if (nameTok.type !== 'ident') {
				throw new TemplateError('expected a filter name after |');
			}
			let args: ExprNode[] = [];
			if (this.peek().type === 'op' && this.peek().value === '(') {
				this.pos++;
				if (!this.matchOp([')'])) {
					args = [];
					for (;;) {
						args.push(this.parseExpression());
						if (this.matchOp([','])) continue;
						this.expectOp(')');
						break;
					}
				}
			}
			e = { t: 'filter', base: e, name: nameTok.value, args };
			// An attribute or [index] may follow the filter result.
			for (;;) {
				if (this.matchOp(['.'])) {
					const p = this.next();
					if (p.type !== 'ident') throw new TemplateError('expected an attribute name after .');
					e = { t: 'member', base: e, prop: p.value };
				} else if (this.matchOp(['['])) {
					if (this.matchOp([':'])) {
						const stop = this.peekOp([']']) ? null : this.parseExpression();
						this.expectOp(']');
						e = { t: 'slice', base: e, start: null, stop };
					} else {
						const start = this.parseExpression();
						if (this.matchOp([':'])) {
							const stop = this.peekOp([']']) ? null : this.parseExpression();
							this.expectOp(']');
							e = { t: 'slice', base: e, start, stop };
						} else {
							this.expectOp(']');
							e = { t: 'index', base: e, key: start };
						}
					}
				} else {
					break;
				}
			}
		}
		return e;
	}

	private parseExpression(): ExprNode {
		return this.parseTernary();
	}

	private parseUnary(): ExprNode {
		if (this.matchOp(['-'])) return { t: 'unary', op: '-', v: this.parseUnary() };
		if (this.matchOp(['+'])) return this.parseUnary();
		return this.parsePostfix();
	}

	private parsePostfix(): ExprNode {
		let e = this.parsePrimary();
		for (;;) {
			if (this.matchOp(['.'])) {
				const p = this.next();
				if (p.type !== 'ident') throw new TemplateError('expected an attribute name after .');
				if (this.matchOp(['('])) {
					e = { t: 'call', fn: { t: 'member', base: e, prop: p.value }, args: this.parseCallArgs() };
				} else {
					e = { t: 'member', base: e, prop: p.value };
				}
			} else if (this.matchOp(['['])) {
				if (this.matchOp([':'])) {
					const stop = this.peekOp([']']) ? null : this.parseExpression();
					this.expectOp(']');
					e = { t: 'slice', base: e, start: null, stop };
				} else {
					const start = this.parseExpression();
					if (this.matchOp([':'])) {
						const stop = this.peekOp([']']) ? null : this.parseExpression();
						this.expectOp(']');
						e = { t: 'slice', base: e, start, stop };
					} else {
						this.expectOp(']');
						e = { t: 'index', base: e, key: start };
					}
				}
			} else if (this.matchOp(['('])) {
				e = { t: 'call', fn: e, args: this.parseCallArgs() };
			} else {
				break;
			}
		}
		return e;
	}

	private parseCallArgs(): ExprNode[] {
		const args: ExprNode[] = [];
		if (this.matchOp([')'])) return args;
		for (;;) {
			args.push(this.parseExpression());
			if (this.matchOp([','])) continue;
			this.expectOp(')');
			return args;
		}
	}

	private parsePrimary(): ExprNode {
		const tok = this.next();
		if (tok.type === 'number') return { t: 'num', v: Number(tok.value) };
		if (tok.type === 'string') return { t: 'str', v: tok.value };
		if (tok.type === 'ident') {
			switch (tok.value) {
				case 'true':
				case 'True':
					return { t: 'bool', v: true };
				case 'false':
				case 'False':
					return { t: 'bool', v: false };
				case 'none':
				case 'None':
				case 'null':
					case 'undefined':
					return { t: 'none' };
			}
			return { t: 'name', name: tok.value };
		}
		if (tok.type === 'op' && tok.value === '(') {
			const e = this.parseTernary();
			this.expectOp(')');
			return e;
		}
		if (tok.type === 'op' && tok.value === '[') {
			// List literal: [a, b, c]
			const items: ExprNode[] = [];
			if (this.matchOp([']'])) return { t: 'list', items };
			for (;;) {
				items.push(this.parseExpression());
				if (this.matchOp([','])) continue;
				this.expectOp(']');
				return { t: 'list', items };
			}
		}
		throw new TemplateError(`unexpected token '${tok.value}' in expression`);
	}
}

// --------------------------------------------------------------------------- //
// Template parser
// --------------------------------------------------------------------------- //

function stmtName(value: string): string {
	return value.split(/\s+/)[0];
}

function parseTemplate(tokens: TemplateToken[]): Node[] {
	let pos = 0;

	const parseBlock = (endTags: Set<string>): Node[] => {
		const nodes: Node[] = [];
		while (pos < tokens.length) {
			const t = tokens[pos];
			if (t.kind === 'text') {
				nodes.push({ kind: 'text', value: t.value });
				pos++;
				continue;
			}
			if (t.kind === 'comment') {
				pos++;
				continue;
			}
			if (t.kind === 'expr') {
				nodes.push({ kind: 'expr', expr: new ExpressionParser(tokenizeExpression(t.value)).parse() });
				pos++;
				continue;
			}
			const first = stmtName(t.value);
			if (endTags.has(first)) return nodes;
			pos++;
			if (first === 'for') {
				const m = /^for\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\s+(.+)$/.exec(t.value);
				if (!m) throw new TemplateError(`invalid for statement: ${t.value}`);
				const targets = m[1].split(',').map((s) => s.trim());
				const iter = new ExpressionParser(tokenizeExpression(m[2])).parse();
				const body = parseBlock(new Set(['endfor']));
				const closing = tokens[pos];
				if (!closing || closing.kind !== 'stmt' || stmtName(closing.value) !== 'endfor') {
					throw new TemplateError('for block not closed with endfor');
				}
				pos++;
				nodes.push({ kind: 'for', targets, iter, body });
			} else if (first === 'if') {
				const branches: { cond: ExprNode | null; body: Node[] }[] = [];
				const firstCond = new ExpressionParser(tokenizeExpression(t.value.slice(2).trim())).parse();
				branches.push({ cond: firstCond, body: parseBlock(new Set(['elif', 'else', 'endif'])) });
				let closing = stmtName(tokens[pos].value);
				while (closing === 'elif') {
					const cond = new ExpressionParser(tokenizeExpression(tokens[pos].value.slice(4).trim())).parse();
					pos++;
					branches.push({ cond, body: parseBlock(new Set(['elif', 'else', 'endif'])) });
					closing = stmtName(tokens[pos].value);
				}
				if (closing === 'else') {
					pos++;
					branches.push({ cond: null, body: parseBlock(new Set(['endif'])) });
					closing = stmtName(tokens[pos].value);
				}
				if (closing !== 'endif') {
					throw new TemplateError(`if block closed by '${closing}', expected endif`);
				}
				pos++;
				nodes.push({ kind: 'if', branches });
			} else if (first === 'set') {
				const m = /^set\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(t.value);
				if (!m) throw new TemplateError(`invalid set statement: ${t.value}`);
				nodes.push({ kind: 'set', name: m[1], value: new ExpressionParser(tokenizeExpression(m[2])).parse() });
			} else {
				throw new TemplateError(`unknown tag '${first}'`);
			}
		}
		return nodes;
	};

	return parseBlock(new Set());
}

// --------------------------------------------------------------------------- //
// Evaluation
// --------------------------------------------------------------------------- //

interface Scope {
	vars: Record<string, unknown>;
	parent: Scope | null;
}

const newScope = (parent: Scope | null = null): Scope => ({ vars: {}, parent });

function truthy(v: unknown): boolean {
	if (v === null || v === undefined) return false;
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v.length > 0;
	if (Array.isArray(v)) return v.length > 0;
	return true;
}

function toNumber(v: unknown, what: string): number {
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (typeof v === 'string') {
		const s = v.trim();
		if (/^0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
		const n = Number(s);
		if (Number.isFinite(n)) return n;
	}
	throw new TemplateError(`cannot convert ${JSON.stringify(v ?? null)} to a number (${what})`);
}

function concat(l: unknown, r: unknown): unknown {
	if (typeof l === 'string' || typeof r === 'string') {
		return `${l ?? ''}${r ?? ''}`;
	}
	if (typeof l === 'number' && typeof r === 'number') return l + r;
	if (typeof l === 'boolean' || typeof r === 'boolean') {
		return `${l ?? ''}${r ?? ''}`;
	}
	throw new TemplateError('cannot apply + to these values');
}

function looseEqual(l: unknown, r: unknown): boolean {
	if (l === null || l === undefined) l = null;
	if (r === null || r === undefined) r = null;
	if (l === null || r === null) return l === r;
	if (typeof l === 'number' && typeof r === 'string') return l === toNumber(r, '==');
	if (typeof r === 'number' && typeof l === 'string') return toNumber(l, '==') === r;
	return l === r;
}

function compare(op: string, l: unknown, r: unknown): boolean {
	const a = toNumber(l, op);
	const b = toNumber(r, op);
	switch (op) {
		case '<':
			return a < b;
		case '>':
			return a > b;
		case '<=':
			return a <= b;
		case '>=':
			return a >= b;
	}
	return false;
}

function stringify(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'number') return String(v);
	if (typeof v === 'function') return '';
	try {
		const s = JSON.stringify(v);
		return s === undefined ? '' : s;
	} catch {
		return '';
	}
}

function resolveName(name: string, scope: Scope, context: Record<string, unknown>): unknown {
	let s: Scope | null = scope;
	while (s) {
		if (Object.prototype.hasOwnProperty.call(s.vars, name)) return s.vars[name];
		s = s.parent;
	}
	if (Object.prototype.hasOwnProperty.call(context, name)) return context[name];
	return undefined;
}

// --------------------------------------------------------------------------- //
// Filters
// --------------------------------------------------------------------------- //

type FilterFn = (value: unknown, ...args: unknown[]) => unknown;

function parseIntValue(v: unknown, what: string): number {
	const n = toNumber(v, what);
	return Math.trunc(n);
}

// RFC 4180: quote the field when it contains the delimiter, a quote or a
// newline; double any embedded quotes.
function csvQuote(s: string): string {
	return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function tsvQuote(s: string): string {
	return /[	\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function makeFilters(): Record<string, FilterFn> {
	return {
		upper: (v) => String(v ?? '').toUpperCase(),
		lower: (v) => String(v ?? '').toLowerCase(),
		capitalize: (v) => {
			const s = String(v ?? '');
			return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
		},
		title: (v) => String(v ?? '').replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()),
		trim: (v) => String(v ?? '').trim(),
		strip: (v) => String(v ?? '').trim(),
		ltrim: (v) => String(v ?? '').replace(/^\s+/, ''),
		lstrip: (v) => String(v ?? '').replace(/^\s+/, ''),
		rtrim: (v) => String(v ?? '').replace(/\s+$/, ''),
		rstrip: (v) => String(v ?? '').replace(/\s+$/, ''),
		replace: (v, old, rep) => String(v ?? '').split(String(old ?? '')).join(String(rep ?? '')),
		split: (v, sep) => {
			const s = String(v ?? '');
			if (sep === undefined || sep === null || sep === '') {
				return s.trim() ? s.trim().split(/\s+/) : [];
			}
			return s.split(String(sep));
		},
		join: (v, sep) => (Array.isArray(v) ? v.map((x) => stringify(x)).join(String(sep ?? '')) : String(v ?? '')),
		int: (v, def) => {
			const s = String(v ?? '').trim();
			const n = /^0[xX][0-9a-fA-F]+$/.test(s) ? parseInt(s, 16) : Number(s);
			return Number.isFinite(n) ? Math.trunc(n) : (def ?? 0);
		},
		float: (v, def) => {
			const n = Number(String(v ?? '').trim());
			return Number.isFinite(n) ? n : (def ?? 0);
		},
		length: (v) => (Array.isArray(v) ? v.length : String(v ?? '').length),
		count: (v) => (Array.isArray(v) ? v.length : String(v ?? '').length),
		first: (v) => (Array.isArray(v) && v.length ? v[0] : null),
		last: (v) => (Array.isArray(v) && v.length ? v[v.length - 1] : null),
		default: (v, def) => (v === null || v === undefined || v === '' ? (def ?? null) : v),
		tojson: (v) => JSON.stringify(v === null || v === undefined ? null : v),
		sort: (v) =>
			Array.isArray(v) ? [...v].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : v,
		reversed: (v) => (Array.isArray(v) ? [...v].reverse() : v),
		unique: (v) => (Array.isArray(v) ? [...new Set(v)] : v),
		min: (v) => (Array.isArray(v) && v.length ? Math.min(...v.map((x) => toNumber(x, 'min'))) : null),
		max: (v) => (Array.isArray(v) && v.length ? Math.max(...v.map((x) => toNumber(x, 'max'))) : null),
		abs: (v) => Math.abs(toNumber(v, 'abs')),
		round: (v, n) => {
			const d = n === undefined || n === null ? 0 : toNumber(n, 'round');
			const f = 10 ** d;
			return Math.round(toNumber(v, 'round') * f) / f;
		},
		strip_tags: (v) => stripHtmlTags(String(v ?? '')),
		html_unescape: (v) => htmlUnescape(String(v ?? '')),
		unesc_md: (v) => unescapeMarkdownCell(String(v ?? '')),
		table_rows: (v) => parseTableRows(String(v ?? '')),
		// YAML double-quoted scalar (JSON string escaping is valid YAML).
		yaml_q: (v) => JSON.stringify(String(v ?? '')),
		// RFC 4180 CSV field: quoted when it contains a comma, quote or newline.
		csv_q: (v) => csvQuote(String(v ?? '')),
		// TSV field: quoted when it contains a tab or newline.
		tsv_q: (v) => tsvQuote(String(v ?? '')),
		// XML text/attribute escaping (& first, then < > ").
		xml_escape: (v) =>
			String(v ?? '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;'),
		// Document-conversion helpers (see markdownTables / helpers below).
		size_bits: (v) => sizeBits(String(v ?? '')),
		access_flags: (v) => accessFlags(String(v ?? '')),
		desc_base: (v) => descBase(String(v ?? '')),
		desc_rows: (v) => parseTableRows(String(v ?? '')),
		row_doc: (v) =>
			v !== null && typeof v === 'object' ? rowDoc(v as ParsedRow) : descBase(String(v ?? '')),
		row_subrows: (v) =>
			v !== null && typeof v === 'object'
				? rowSubRows(v as ParsedRow)
				: parseTableRows(String(v ?? '')).slice(1),
		// Object iteration (the 'for' statement only iterates lists).
		keys: (v) => keysOf(v),
		items: (v) => itemsOf(v),
		// Parsers (null when the text doesn't parse) — backward templates.
		yaml_parse: (v) => {
			try {
				return yamlSafeLoad(String(v ?? ''));
			} catch {
				return null;
			}
		},
		json_parse: (v) => {
			try {
				return JSON.parse(String(v ?? ''));
			} catch {
				return null;
			}
		},
		// Backward-template display helpers (inverse of size_bits/access_flags).
		size_display: (v) => sizeDisplay(v),
		access_display: (v) => accessDisplay(v),
		field_display: (v, reg) => fieldDisplay(reg, v),
		field_offset: (v, i) => fieldOffset(v, i),
		esc_md: (v) => escapeMarkdownCell(String(v ?? '')),
		// Array Description-cell suffix (inverse of array_info), '' otherwise.
		array_suffix: (v) => arraySuffix(v),
		array_info: (v) => arrayInfo(String(v ?? '')),
		is_padding: (v) => isPadding(String(v ?? ''))
	};
}

let FILTERS: Record<string, FilterFn> | null = null;
const applyFilter = (name: string, v: unknown, args: unknown[]): unknown => {
	if (!FILTERS) FILTERS = makeFilters();
	const fn = FILTERS[name];
	if (!fn) {
		const known = Object.keys(FILTERS).sort().join(', ');
		throw new TemplateError(`unknown filter '${name}' (available: ${known})`);
	}
	return fn(v, ...args);
};

function evalExpr(node: ExprNode, scope: Scope, context: Record<string, unknown>): unknown {
	switch (node.t) {
		case 'num':
			return node.v;
		case 'str':
			return node.v;
		case 'bool':
			return node.v;
		case 'none':
			return null;
		case 'list':
			return node.items.map((it) => evalExpr(it, scope, context));
		case 'name': {
			const v = resolveName(node.name, scope, context);
			return v === undefined ? null : v;
		}
		case 'member': {
			const base = evalExpr(node.base, scope, context);
			if (base === null || base === undefined || typeof base !== 'object') return null;
			const v = (base as Record<string, unknown>)[node.prop];
			return v === undefined ? null : v;
		}
		case 'index': {
			const base = evalExpr(node.base, scope, context);
			const key = evalExpr(node.key, scope, context);
			if (base === null || base === undefined) return null;
			if (Array.isArray(base)) {
				let i =
					typeof key === 'number' ? Math.trunc(key) : parseInt(String(key ?? ''), 10);
				if (!Number.isFinite(i)) return null;
				if (i < 0) i += base.length;
				const v = base[i];
				return v === undefined ? null : v;
			}
			if (typeof base === 'object') {
				const v = (base as Record<string, unknown>)[String(key ?? '')];
				return v === undefined ? null : v;
			}
			return null;
		}
		case 'slice': {
			const base = evalExpr(node.base, scope, context);
			const start = node.start === null ? null : toNumber(evalExpr(node.start, scope, context), 'slice');
			const stop = node.stop === null ? null : toNumber(evalExpr(node.stop, scope, context), 'slice');
			const resolve = (v: number, length: number) => {
				if (v < 0) v += length;
				return Math.max(0, Math.min(length, v));
			};
			if (Array.isArray(base)) {
				const s = resolve(start ?? 0, base.length);
				const e2 = resolve(stop ?? base.length, base.length);
				return base.slice(s, e2);
			}
			if (typeof base === 'string') {
				const s = resolve(start ?? 0, base.length);
				const e2 = resolve(stop ?? base.length, base.length);
				return base.slice(s, e2);
			}
			return null;
		}
		case 'call': {
			const fn = evalExpr(node.fn, scope, context);
			if (typeof fn !== 'function') {
				throw new TemplateError('value is not callable');
			}
			const args = node.args.map((a) => evalExpr(a, scope, context));
			return (fn as (...a: unknown[]) => unknown)(...args);
		}
		case 'unary': {
			if (node.op === '-') return -toNumber(evalExpr(node.v, scope, context), '-');
			return !truthy(evalExpr(node.v, scope, context));
		}
		case 'and': {
			const l = evalExpr(node.l, scope, context);
			return truthy(l) ? evalExpr(node.r, scope, context) : l;
		}
		case 'or': {
			const l = evalExpr(node.l, scope, context);
			return truthy(l) ? l : evalExpr(node.r, scope, context);
		}
		case 'ternary':
			return truthy(evalExpr(node.cond, scope, context))
				? evalExpr(node.a, scope, context)
				: evalExpr(node.b, scope, context);
		case 'bin': {
			const l = evalExpr(node.l, scope, context);
			const r = evalExpr(node.r, scope, context);
			switch (node.op) {
				case '+':
					return concat(l, r);
				case '-':
					return toNumber(l, '-') - toNumber(r, '-');
				case '*':
					return toNumber(l, '*') * toNumber(r, '*');
				case '/': {
					const d = toNumber(r, '/');
					if (d === 0) throw new TemplateError('division by zero');
					return toNumber(l, '/') / d;
				}
				case '//': {
					const d = toNumber(r, '//');
					if (d === 0) throw new TemplateError('division by zero');
					return Math.floor(toNumber(l, '//') / d);
				}
				case '%': {
					const d = toNumber(r, '%');
					if (d === 0) throw new TemplateError('modulo by zero');
					return toNumber(l, '%') % d;
				}
				case '==':
					return looseEqual(l, r);
				case '!=':
					return !looseEqual(l, r);
				default:
					return compare(node.op, l, r);
			}
		}
		case 'filter':
			return applyFilter(node.name, evalExpr(node.base, scope, context), node.args.map((a) => evalExpr(a, scope, context)));
	}
}

function renderNodes(nodes: Node[], scope: Scope, context: Record<string, unknown>): string {
	let out = '';
	for (const n of nodes) {
		switch (n.kind) {
			case 'text':
				out += n.value;
				break;
			case 'expr':
				out += stringify(evalExpr(n.expr, scope, context));
				break;
			case 'set':
				scope.vars[n.name] = evalExpr(n.value, scope, context);
				break;
			case 'if': {
				const branch = n.branches.find((b) => b.cond === null || truthy(evalExpr(b.cond, scope, context)));
				if (branch) out += renderNodes(branch.body, scope, context);
				break;
			}
			case 'for': {
				const seq = evalExpr(n.iter, scope, context);
				if (seq !== null && seq !== undefined && !Array.isArray(seq)) {
					throw new TemplateError("'for' expects a list, got " + (typeof seq === 'object' ? 'an object' : typeof seq));
				}
				const arr: unknown[] = seq === null || seq === undefined ? [] : (seq as unknown[]);
				const frame = newScope(scope);
				arr.forEach((item, i) => {
					if (n.targets.length === 1) {
						frame.vars[n.targets[0]] = item;
					} else {
						n.targets.forEach((t, j) => {
							if (Array.isArray(item)) frame.vars[t] = item[j];
							else if (item !== null && typeof item === 'object') frame.vars[t] = (item as Record<string, unknown>)[t];
							else frame.vars[t] = null;
						});
					}
					frame.vars['loop'] = {
						index: i + 1,
						index0: i,
						first: i === 0,
						last: i === arr.length - 1,
						length: arr.length,
						revindex: arr.length - i
					};
					out += renderNodes(n.body, frame, context);
				});
				break;
			}
		}
	}
	return out;
}

// --------------------------------------------------------------------------- //
// Document-conversion helpers live in markdownTables.ts (inverse of
// generate_md.py's cell()/nested-table rendering); re-exported here so both
// modules can be used from either compiled file.
// --------------------------------------------------------------------------- //
export {
	htmlUnescape,
	stripHtmlTags,
	unescapeMarkdownCell,
	parseTableRows,
	sizeBits,
	accessFlags,
	descBase,
	arrayInfo,
	isPadding
} from './markdownTables';

// --------------------------------------------------------------------------- //
// Template file handling (front matter + body) and public entry points.
// --------------------------------------------------------------------------- //

export interface TemplateFile {
	metadata: Record<string, string>;
	// Front-matter keys that are not reserved (name/format/output).
	params: Record<string, string>;
	body: string;
}

export function splitTemplateFile(raw: string): TemplateFile {
	const src = raw.replace(/^\uFEFF/, '');
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
	if (!m) return { metadata: {}, params: {}, body: src };
	const metadata: Record<string, string> = {};
	for (const line of m[1].split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(t);
		if (kv) metadata[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
	}
	const params: Record<string, string> = {};
	for (const [k, v] of Object.entries(metadata)) {
		if (k !== 'name' && k !== 'format' && k !== 'output') params[k] = v;
	}
	return { metadata, params, body: src.slice(m[0].length) };
}

// Built-in functions available in every template context (the Markdown
// context adds/overrides with document-specific helpers).
const DEFAULT_CONTEXT: Record<string, unknown> = {
	len: (v: unknown) => (Array.isArray(v) ? v.length : String(v ?? '').length),
	min: (v: unknown) =>
		Array.isArray(v) && v.length ? Math.min(...v.map((x) => Number(x))) : null,
	max: (v: unknown) =>
		Array.isArray(v) && v.length ? Math.max(...v.map((x) => Number(x))) : null,
	abs: (v: unknown) => Math.abs(Number(v)),
	range: (n: unknown) => {
		const count = Math.max(0, Math.trunc(Number(n)));
		return Array.from({ length: count }, (_, i) => i);
	}
};

export function renderTemplate(source: string, context: Record<string, unknown> = {}): string {
	const tokens = lexTemplate(source);
	applyTrim(tokens);
	const nodes = parseTemplate(tokens);
	return renderNodes(nodes, newScope(), { ...DEFAULT_CONTEXT, ...context });
}

export function renderMarkdownTemplate(templateBody: string, markdown: string, source: string): string {
	return renderTemplate(templateBody, buildMarkdownContext(markdown, source));
}
