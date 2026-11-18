const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderTemplate, splitTemplateFile, sizeBits, accessFlags, descBase, arrayInfo, parseTableRows } = require('../out/jinjaTemplate');
const { parseMarkdownTables, buildMarkdownContext, splitTableCells, buildRegisterRows, rowDoc, rowSubRows } = require('../out/markdownTables');

const eq = (a, b, msg) => assert.strictEqual(a, b, msg);

// --------------------------------------------------------------------------- //
// Expression language
// --------------------------------------------------------------------------- //
eq(renderTemplate('{{ 1 + 2 * 3 }}'), '7', 'precedence');
eq(renderTemplate('{{ (1 + 2) * 3 }}'), '9', 'grouping');
eq(renderTemplate('{{ 7 / 2 }}'), '3.5', 'float division');
eq(renderTemplate('{{ 7 // 2 }}'), '3', 'floor division');
eq(renderTemplate('{{ 7 % 3 }}'), '1', 'modulo');
eq(renderTemplate('{{ -5 + 8 }}'), '3', 'unary minus');
eq(renderTemplate('{{ "abc" + "def" }}'), 'abcdef', 'string concat');
eq(renderTemplate('{{ 10 - 4 }}'), '6', 'binary minus');
eq(renderTemplate('{{ "a" if 1 > 0 else "b" }}'), 'a', 'ternary true');
eq(renderTemplate('{{ "a" if 0 else "b" }}'), 'b', 'ternary false');
eq(renderTemplate('{{ 0x10 }}'), '16', 'hex literal');
eq(renderTemplate('{{ not false and true }}'), 'true', 'logic');
eq(renderTemplate('{{ 2 < 3 and 3 <= 3 and 4 != 4 }}'), 'false', 'comparison chain');
eq(renderTemplate('{{ missing }}'), '', 'undefined renders empty (Jinja leniency)');
eq(renderTemplate('{{ [1, 2, 3][1] }}'), '2', 'list literal index');
eq(renderTemplate('{{ [10, 20, 30, 40][1:3] }}'), '[20,30]', 'slice -> array stringify');
eq(renderTemplate('{{ "abcdef"[1:3] }}'), 'bc', 'string slice');
eq(renderTemplate('{{ len([1, 2, 3]) }}'), '3', 'len() call');
eq(renderTemplate('{{ min([3, 1, 2]) }}'), '1', 'min() call');
eq(renderTemplate('{{ max([3, 1, 2]) }}'), '3', 'max() call');
eq(renderTemplate('{{ abs(-4) }}'), '4', 'abs() call');
eq(renderTemplate('{{ range(3) }}'), '[0,1,2]', 'range() call');

// Member + call chaining
eq(renderTemplate('{{ x.y.z }}', { x: { y: { z: 'deep' } } }), 'deep', 'member chain');
eq(renderTemplate('{{ f(1, 2) }}', { f: (a, b) => a + b }), '3', 'call with args');
eq(renderTemplate('{{ obj.method(2) }}', { obj: { method: (n) => n * 4 } }), '8', 'method call');

// --------------------------------------------------------------------------- //
// Statements: for / if / set / raw / comments
// --------------------------------------------------------------------------- //
eq(
	renderTemplate('{% for x in items %}{{ x }}{% if not loop.last %}, {% endif %}{% endfor %}', { items: ['a', 'b', 'c'] }),
	'a, b, c',
	'for + loop.last'
);
eq(
	renderTemplate('{% for x in items %}{{ loop.index }}:{{ x }};{% endfor %}', { items: ['a', 'b'] }),
	'1:a;2:b;',
	'loop.index'
);
eq(
	renderTemplate('{% for x in items %}{% if loop.first %}F{% endif %}{% endfor %}', { items: ['a', 'b'] }),
	'F',
	'loop.first'
);
eq(
	renderTemplate('{% for a, b in pairs %}{{ a }}={{ b }};{% endfor %}', { pairs: [['x', 1], ['y', 2]] }),
	'x=1;y=2;',
	'tuple unpack in for'
);
eq(renderTemplate('{% for x in missing %}nope{% endfor %}done'), 'done', 'for over null is empty');
eq(
	renderTemplate('{% if flag %}yes{% elif other %}mid{% else %}no{% endif %}'),
	'no',
	'if/elif/else'
);
eq(renderTemplate('{% if 2 > 1 %}a{% elif 1 %}b{% endif %}'), 'a', 'elif skipped');
let setOut = '';
setOut = renderTemplate('{% set n = 4 %}{% set n = n * 3 %}{{ n }}');
eq(setOut, '12', 'set reassign');
eq(renderTemplate('{# a comment #}text'), 'text', 'comment removed');
eq(renderTemplate('{% raw %}{{ not rendered }}{% endraw %}'), '{{ not rendered }}', 'raw block');
assert.throws(() => renderTemplate('{% bogus %}'), /unknown tag/, 'unknown tag throws');
assert.throws(() => renderTemplate('{{ x | no_such_filter }}', { x: 1 }), /unknown filter/, 'unknown filter throws');
assert.throws(() => renderTemplate('{% for x in items %}'), /endfor/, 'unclosed for throws');
assert.throws(() => renderTemplate('{{ 1 + }}'), /unexpected|expected/, 'bad expression throws');

// Whitespace control
eq(renderTemplate('a{%- if true %}   b   {%- endif %}   c'), 'a   b   c', 'trim left keeps inner spaces');
eq(renderTemplate('a{%- if true -%} b {%- endif -%}c'), 'abc', 'trim right');
eq(renderTemplate('{{- "x" -}}'), 'x', 'expr trim both sides');
eq(renderTemplate('{#-  -#}abc'), 'abc', 'comment trim');
eq(renderTemplate('keep  \n  spaces'), 'keep  \n  spaces', 'text untouched without tags');

// --------------------------------------------------------------------------- //
// Filters
// --------------------------------------------------------------------------- //
const F = (tpl, ctx) => renderTemplate(tpl, ctx);
eq(F('{{ v | upper }}', { v: 'abc' }), 'ABC', 'upper');
eq(F('{{ v | lower }}', { v: 'ABC' }), 'abc', 'lower');
eq(F('{{ v | capitalize }}', { v: 'hello world' }), 'Hello world', 'capitalize');
eq(F('{{ v | trim }}', { v: '  x  ' }), 'x', 'trim');
eq(F('{{ v | replace("a", "b") }}', { v: 'banana' }), 'bbnbnb', 'replace all');
eq(F('{{ v | split(",") | join(" | ") }}', { v: 'a,b' }), 'a | b', 'split/join chain');
eq(F('{{ v | int }}', { v: '42' }), '42', 'int');
eq(F('{{ v | int }}', { v: '0x10' }), '16', 'int hex');
eq(F('{{ v | int(7) }}', { v: 'oops' }), '7', 'int default');
eq(F('{{ v | length }}', { v: 'abcd' }), '4', 'length string');
eq(F('{{ v | length }}', { v: [1, 2] }), '2', 'length list');
eq(F('{{ v | first }}', { v: ['a', 'b'] }), 'a', 'first');
eq(F('{{ v | last }}', { v: ['a', 'b'] }), 'b', 'last');
eq(F('{{ v | default("d") }}', { v: null }), 'd', 'default');
eq(F('{{ v | default("d") }}', { v: 'x' }), 'x', 'default keeps value');
eq(F('{{ v | sort | join(",") }}', { v: [3, 1, 2] }), '1,2,3', 'sort');
eq(F('{{ v | reversed | join(",") }}', { v: [1, 2] }), '2,1', 'reversed');
eq(F('{{ v | unique | join(",") }}', { v: [1, 1, 2] }), '1,2', 'unique');
eq(F('{{ v | tojson }}', { v: { a: 1 } }), '{"a":1}', 'tojson');
eq(F('{{ v | yaml_q }}', { v: 'a: b' }), '"a: b"', 'yaml_q quotes');
eq(F('{{ v | yaml_q }}', { v: 'line1\nline2' }), '"line1\\nline2"', 'yaml_q escapes newline');
eq(F('{{ v | strip_tags }}', { v: '<b>bold</b> &amp; more' }), 'bold & more', 'strip_tags');
eq(F('{{ v | html_unescape }}', { v: '&lt;tag&gt; &#65;' }), '<tag> A', 'html_unescape');
eq(F('{{ v | unesc_md }}', { v: 'a \\| b &lt;c&gt;' }), 'a | b <c>', 'unesc_md');

// Filter result postfix (member on filter output)
eq(F('{{ v | array_info.length }}', { v: 'Array: 8 x u32 (4 byte elements)' }), '8', 'filter + member');

// --------------------------------------------------------------------------- //
// Document-conversion helpers
// --------------------------------------------------------------------------- //
eq(sizeBits('4 byte'), 32, 'sizeBits byte');
eq(sizeBits('1 bit'), 1, 'sizeBits bit');
eq(sizeBits('32'), 32, 'sizeBits plain');
eq(sizeBits('0x20'), 32, 'sizeBits hex');
eq(sizeBits('nope'), 0, 'sizeBits fallback');
assert.deepStrictEqual(accessFlags('R/W'), ['read', 'write'], 'accessFlags RW');
assert.deepStrictEqual(accessFlags('RW'), ['read', 'write'], 'accessFlags joined RW');
assert.deepStrictEqual(accessFlags('R'), ['read'], 'accessFlags R');
assert.deepStrictEqual(accessFlags('—'), [], 'accessFlags em dash');
eq(
	descBase('Top-level control register<br><table><tr><th>x</th></tr></table>'),
	'Top-level control register',
	'descBase cuts at <br>'
);
eq(descBase('Scratch, 8 words. — Array: 8 x u32 (4 byte elements)'), 'Scratch, 8 words.', 'descBase cuts array suffix');
assert.deepStrictEqual(arrayInfo('— Array: 8 x u32 (4 byte elements)'), { length: 8, bit_width: 32 }, 'arrayInfo');
eq(arrayInfo('no array here'), null, 'arrayInfo null');
assert.deepStrictEqual(
	parseTableRows('<table><tr><th>V</th><th>N</th></tr><tr><td>0</td><td>Unknown</td></tr></table>'),
	[['V', 'N'], ['0', 'Unknown']],
	'parseTableRows'
);
assert.deepStrictEqual(parseTableRows('no table'), [], 'parseTableRows empty');

// --------------------------------------------------------------------------- //
// Markdown pipe tables
// --------------------------------------------------------------------------- //
const md = [
	'# Demo map',
	'',
	'| Offset | Name | Note |',
	'|--------|------|------|',
	'| 0 | regA | has \\| pipe |',
	'| 4 | regB | plain |',
	'',
	'| a | b |',
	'| - | - |',
	'| 1 | 2 |'
].join('\n');
const tables = parseMarkdownTables(md);
eq(tables.length, 2, 'two tables found');
eq(tables[0].headers.join(','), 'Offset,Name,Note', 'headers');
eq(tables[0].rows.length, 2, 'row count');
eq(tables[0].rows[0].Name, 'regA', 'header-keyed row');
eq(tables[0].rows[0].Note, 'has | pipe', 'escaped pipe unescaped');
eq(tables[1].rows[0].a, '1', 'second table');
assert.deepStrictEqual(splitTableCells('| x | \\| | y |'), ['x', '|', 'y'], 'splitTableCells escaped pipe');
// Not a table: header + separator only (no data row).
eq(parseMarkdownTables('| a |\n| - |\n').length, 0, 'no data rows -> no table');
const ctx = buildMarkdownContext(md, 'demo.md');
eq(ctx.source, 'demo.md', 'context source');
eq(ctx.title, 'Demo map', 'context title');
eq(ctx.rows[0].Name, 'regA', 'context rows');
eq(ctx.headers.length, 3, 'context headers');

// --------------------------------------------------------------------------- //
// Template file front matter
// --------------------------------------------------------------------------- //
const tf = splitTemplateFile('---\nname: X to YAML\nformat: yaml\nstruct_name: myRegs\n---\nbody {{ 1 }}');
eq(tf.metadata.name, 'X to YAML', 'front matter name');
eq(tf.metadata.format, 'yaml', 'front matter format');
eq(tf.params.struct_name, 'myRegs', 'params carry non-reserved keys');
eq(tf.body, 'body {{ 1 }}', 'body after front matter');
const tf2 = splitTemplateFile('plain body, no front matter');
eq(tf2.body, 'plain body, no front matter', 'no front matter -> whole file is body');

// --------------------------------------------------------------------------- //
// End-to-end: bundled template against the register-map demo (from
// yaml_template_examples/generic), expected output derived from
// demo_fpga_types.yaml (see tests/fixtures/).
// --------------------------------------------------------------------------- //
const root = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'templates', 'register-map-to-yaml.j2'), 'utf8');
const { metadata, params, body } = splitTemplateFile(raw);
eq(metadata.name, 'Register map to YAML', 'bundled template name');
eq(metadata.format, 'yaml', 'bundled template format');
eq(params.struct_name, 'demoFpgaRegs', 'bundled template struct param');

const demoMd = fs.readFileSync(path.join(__dirname, 'fixtures', 'register-map-demo.md'), 'utf8');
const demoCtx = buildMarkdownContext(demoMd, 'demo_fpga_types.md');
demoCtx.params = params;
const out = renderTemplate(body, demoCtx);
const expected = fs.readFileSync(path.join(__dirname, 'fixtures', 'register-map-demo.expected.yaml'), 'utf8');
eq(out, expected, 'rendered output matches expected YAML byte-for-byte');

// Structural checks on the generated YAML (line-based; no YAML dep in the
// extension). The structure must mirror demo_fpga_types.yaml:
const lines = out.split('\n');
const line = (s) => lines.filter((l) => l === s);
eq(line('types:').length, 1, 'types root');
eq(line('  deviceId:').length, 1, 'deviceId register');
eq(line('    format: enum').length, 1, 'enum format');
eq(line('      Unknown: 0').length, 1, 'enum value decimal');
eq(line('      DemoBoardA: 256').length, 1, 'enum value 0x100 as decimal');
assert(line('      flags: [read, write]').length >= 1, 'R/W flags expanded');
eq(line('    format: bitfield').length, 2, 'two bitfield registers');
eq(line('      controlWord_padding:').length, 1, 'padding name reconstructed');
eq(line('        size: 29').length, 1, 'padding size from nested table');
eq(line('    format: array').length, 1, 'array register');
eq(line('    size: calc').length, 1, 'array size calc');
eq(line('    bit_width: 32').length, 1, 'array bit width from suffix');
eq(line('    length: 8').length, 1, 'array length from suffix');
eq(line('    format: struct').length, 1, 'struct target from front matter');
eq(line('      deviceId: EXT__deviceId').length, 1, 'struct field reference');
// Struct fields in document order, one per row.
const structIdx = lines.indexOf('  demoFpgaRegs:');
const structFields = lines
	.slice(structIdx)
	.filter((l) => l.startsWith('      ') && l.includes(': EXT__'));
assert.deepStrictEqual(
	structFields,
	['      deviceId: EXT__deviceId', '      controlWord: EXT__controlWord', '      sampleCount: EXT__sampleCount', '      scratchArray: EXT__scratchArray'],
	'struct field order'
);
// The generated file is valid YAML: every non-empty line is a comment, a key,
// or a "key: value" pair with 2-space indentation steps (no tabs).
for (const l of lines) {
	if (!l.trim()) continue;
	assert(!l.includes('\t'), 'no tabs in generated YAML: ' + l);
	assert(/^\s*(#.*)?$/.test(l) || /^\s*[^:\s][^:]*:(\s+.*)?$/.test(l), 'YAML line shape: ' + l);
}

// --------------------------------------------------------------------------- //
// Register-map document style 2: one-line register rows + prose + nested
// tables as separate lines (pab1_fpga_types.md), merged into register rows.
// --------------------------------------------------------------------------- //
const pab1Md = fs.readFileSync(path.join(__dirname, 'fixtures', 'pab1-register-map.md'), 'utf8');
const pab1Rows = buildRegisterRows(pab1Md);
eq(pab1Rows.length, 12, 'pab1: all 12 register rows found');
assert.deepStrictEqual(
	pab1Rows.map((r) => r.Name),
	['firmwareVersion', 'hwVersion', 'pciExpressType', 'pcieEngine', 'dataChannelInterface', 'numOfDataChannels', 'c2hStreamBufferStatus', 'testDataControl', 'blockSize', 'bandwidthControl', 'acqControl', 'streamBufferSize'],
	'pab1: rows in document order'
);
// First row (inside the header table): prose + nested table attached.
eq(pab1Rows[0].Format, 'bitfield', 'pab1: format cell');
assert.deepStrictEqual(accessFlags(pab1Rows[0].Access), ['read', 'write'], 'pab1: RW access');
eq(rowDoc(pab1Rows[0]), 'Firmware version', 'pab1: attached prose doc');
eq(rowSubRows(pab1Rows[0]).length, 2, 'pab1: subtable data rows (header/separator dropped)');
eq(rowSubRows(pab1Rows[0])[0][1], 'minorVersion', 'pab1: subtable field name');
// Lone-line register (no Description column in the row): doc + enum values.
eq(rowDoc(pab1Rows[1]), 'HW version', 'pab1: lone-row doc');
assert.deepStrictEqual(rowSubRows(pab1Rows[1]).map((v) => v[1]), ['Non-defined', 'AC701', 'Z0', 'Z1'], 'pab1: enum value names');
// Inline-Description register (no attached prose): rowDoc falls back to the cell.
assert(rowDoc(pab1Rows[8]).startsWith('Block size.'), 'pab1: inline doc fallback');
eq(rowSubRows(pab1Rows[8]).length, 0, 'pab1: uint register has no subtable');

// End-to-end: same bundled template, style-2 document, user-set struct name.
const pab1Ctx = buildMarkdownContext(pab1Md, 'pab1_fpga_types.md');
pab1Ctx.params = { struct_name: 'pab1FpgaRegs' };
const pab1Out = renderTemplate(body, pab1Ctx);
const pab1Expected = fs.readFileSync(path.join(__dirname, 'fixtures', 'pab1-register-map.expected.yaml'), 'utf8');
eq(pab1Out, pab1Expected, 'pab1 rendered output matches expected YAML byte-for-byte');
const p1 = pab1Out.split('\n');
const p1line = (s) => p1.filter((l) => l === s);
eq(p1line('  hwVersion:').length, 1, 'pab1: lone-line register in output');
eq(p1line('    format: enum').length, 3, 'pab1: three enum registers');
eq(p1line('      AXI-Stream: 1').length, 1, 'pab1: enum value');
eq(p1line('      flags: [read, write]').length, 5, 'pab1: RW/R-W flags expanded');
eq(p1line('      flags: [read]').length, 7, 'pab1: read-only flags');
eq(p1line('      testDataControl_padding:').length, 1, 'pab1: padding reconstructed');
eq(p1line('  pab1FpgaRegs:').length, 1, 'pab1: struct from params');
eq(p1.filter((l) => l.includes(': EXT__')).length, 12, 'pab1: struct has all 12 registers');

console.log('Jinja template engine, markdown tables and register-map-to-yaml.j2 passed');
