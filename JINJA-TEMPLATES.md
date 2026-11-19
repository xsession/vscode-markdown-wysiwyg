# Jinja conversion templates

The toolbar's **Template** button opens the native file browser and picks a
Jinja conversion template (`.j2`, `.jinja`, `.jnt`). The template describes
how the opened Markdown document converts into the selected output format; a
TypeScript backend inside the extension (no Python, no external runtime)
renders it when you press **Generate**.

```
Template button ──file browser──▶ template.j2 (front matter + Jinja body)
Generate button ──▶ TypeScript renderer (src/jinjaTemplate.ts)
                  context = parsed Markdown (tables, rows, helpers)
                  output  ──▶ <output folder>/<name>.<ext>
```

## Template file format

An optional YAML front matter, then the Jinja body:

```
---
name: Register map to YAML     # shown on the toolbar button
format: yaml                   # default output format (auto-selected)
output: board.yaml             # optional: output file basename
struct_name: demoFpgaRegs      # any other key becomes a template param
---
# body: {{ source }} has {{ rows | length }} rows
...
```

- `name` — display name on the Template button.
- `format` — one of the Format dropdown ids (`yaml`, `json`, `toml`, `xml`,
  `csv`, `tsv`, `ini`, `env`, `properties`, `html`, `markdown`; `docx` is
  binary and cannot be produced by a text template). Picking the template
  auto-selects it; the dropdown can still override it. The id sets the output
  file extension.
- `output` — output file basename (extension from the format). Without it the
  opened document's basename is used.
- every other key is available in the body as `params.<key>`.

Output is written to `markdownEditor.outputFolder` (set with the toolbar's
output-folder button) or, when that is empty, next to the template file.

## Context given to templates

Provided by `src/markdownTables.ts`:

| Value | Meaning |
| --- | --- |
| `source` | basename of the opened Markdown document |
| `title` | first heading text (or `''`) |
| `markdown` | full document text, `\n` normalized |
| `tables` | every pipe table: `{ headers: [...], rows: [...] }` |
| `table` | the first table (or `null`) |
| `rows` / `headers` | register rows in document order (the first table's data rows plus one-line register rows), and the first table's headers |
| `register_map` | the opened document parsed as a register-map data file (YAML/JSON with a `types` mapping), or `null` for Markdown documents |
| `types` | the `types` mapping of a register-map data file, or `null` — iterate with `for name, t in types \| items` |
| `params` | front-matter params of the picked template |

Each row object is keyed by header name (`r.Name`) plus a raw `r.cells`
array; headers containing spaces need index access: `r['File size']`.

Register rows additionally carry `r.doc` (the prose description that
follows the row, if any) and `r.subrows`/`r.subheaders` (the first table
that follows the row, if any) — see `row_doc` / `row_subrows` below.

## Built-in helpers (filters or functions)

Document-conversion helpers that invert `generate_md.py`'s rendering — usable
as filters (`r.Description | desc_base`) or calls (`desc_base(r.Description)`):

| Helper | Result |
| --- | --- |
| `size_bits("4 byte")` | `32` (`"1 bit"`→1, `"32"`→32, `"0x20"`→32) |
| `access_flags("R/W")` | `["read", "write"]` (`"RW"` too; `"R"`→`["read"]`, `"—"`→`[]`) |
| `desc_base(text)` | description text before the nested `<table>` / `<br>` / ` — Array:` suffix, unescaped |
| `desc_rows(text)` | the first nested `<table>` in a cell as rows of strings (row 0 = header) |
| `table_rows(text)` | same as `desc_rows` (alias) |
| `row_doc(r)` | a register row's description: the prose following the row when present, else `desc_base(r.Description)` — works for both register-map styles |
| `row_subrows(r)` | a register row's nested field/enum table as data rows (header excluded): the table following the row when present, else the one inside `r.Description` |
| `array_info(text)` | `{ length, bit_width }` from an `Array: N x uW` suffix, or `null` |
| `is_padding(name)` | true for `reserved` / `*_padding` |
| `unesc_md(text)` | reverse of `cell()`: `\|`→`|`, `&lt;`→`<`, `&gt;`→`>` |
| `esc_md(text)` | escape a string for a Markdown table cell (inverse of `unesc_md`) |
| `strip_tags(text)` | remove HTML tags, decode entities |
| `yaml_q(text)` | double-quoted YAML scalar (safe for any text) |
| `csv_q(text)` | RFC 4180 CSV field (quoted when needed, inner quotes doubled) |
| `tsv_q(text)` | TSV field (quoted when it contains a tab/newline) |
| `xml_escape(text)` | XML text/attribute escaping (`&` `<` `>` `"` first) |

Backward-template helpers (inverse of the forward ones):

| Helper | Result |
| --- | --- |
| `keys(obj)` | the object's keys as a list (the `for` tag only iterates lists) |
| `items(obj)` | `[key, value]` pairs for `for name, t in types \| items` |
| `yaml_parse(text)` | the text as parsed YAML, or `null` |
| `json_parse(text)` | the text as parsed JSON, or `null` |
| `size_display(t)` | a type/field's size as shown in a table: `32`→`4 byte`, `29`→`29 bit`, arrays→`8 x 4 byte` |
| `access_display(flags)` | `["read","write"]`→`RW`, `["read"]`→`R`, `[]`→`—` |
| `field_display(name, reg)` | `"<reg>_padding"`→`reserved` (the table spelling), anything else unchanged |
| `field_offset(pairs, i)` | starting offset of field `i` in `t.fields \| items`: `bit 3` / `byte 2` |
| `array_suffix(t)` | ` — Array: 8 x u32 (4 byte elements)` for array types (inverse of `array_info`), `''` otherwise |

General filters: `upper`, `lower`, `capitalize`, `trim`, `replace`, `split`,
`join`, `int`, `float`, `length`, `first`, `last`, `default`, `sort`,
`reversed`, `unique`, `min`, `max`, `abs`, `round`, `tojson`,
`html_unescape`.

Functions (all contexts): `len(x)`, `min(x)`, `max(x)`, `abs(x)`, `range(n)`.

## Supported Jinja syntax

- `{{ expr }}` and `{% ... %}` tags, with `-` whitespace control
  (`{%- -%}` trims adjacent whitespace — the idiom for clean indented output).
- `{# comment #}`, `{% raw %} ... {% endraw %}`.
- `{% for x in seq %}` (and `for a, b in seq`), with `loop.index`,
  `loop.index0`, `loop.first`, `loop.last`, `loop.length`, `loop.revindex`.
- `{% if %} / {% elif %} / {% else %}`, `{% set name = expr %}`.
- Expressions: numbers (incl. `0x` hex), strings, `true/false/none`,
  list literals `[a, b]`, slices `seq[1:]`, `seq[a:b]`, `.attr`, `obj[key]`,
  calls, `+ - * / // %`, `== != < > <= >=`, `and or not`,
  `a if cond else b`, filters `| f | g(args)`, and an attribute/index after a
  filter result (`r.Description | array_info.bit_width`).
- Undefined names render empty and index/member access on missing values
  returns `null` (Jinja leniency); unknown filters/tags raise a clear error.

## Built-in templates (`templates/`)

All forward templates accept both register-map styles (single table with
nested Description cells, or one-line rows + prose + nested tables), take
`struct_name` from the front matter (remove the line to skip the struct
section), and emit a per-register `@register <name>` marker line that the
live sync uses (see below).

| Template | Input | Output | Notes |
| --- | --- | --- | --- |
| `register-map-to-yaml.j2` | register map `.md` | `*_fpga_types.yaml` | inverse of `generate_md.py`: enums, bitfields (padding→`<reg>_padding`), arrays, struct with `EXT__` refs |
| `register-map-to-json.j2` | register map `.md` | `*_fpga_types.json` | same data model as the YAML, `@register` as a JSON key |
| `register-map-to-toml.j2` | register map `.md` | `*_fpga_types.toml` | `[types.<name>]` tables, fields/values as sub-tables |
| `register-map-to-xml.j2` | register map `.md` | `*_fpga_types.xml` | `<fpgaTypes><register>` document, `xml_escape`d |
| `register-map-to-csv.j2` | register map `.md` | CSV | long form, one row per field/value/register: `name,kind,item,size_bits,length,access,doc` (RFC 4180) |
| `register-map-to-tsv.j2` | register map `.md` | TSV | same columns, tab-separated |
| `register-map-to-ini.j2` | register map `.md` | INI | one `[register]` section per register, `<field>.size/.doc` keys |
| `register-map-to-env.j2` | register map `.md` | `.env` | flat `KEY=VALUE`, dashes→underscores, docs omitted |
| `register-map-to-properties.j2` | register map `.md` | `.properties` | dotted keys `<reg>.fields.<f>.size` etc. |
| `register-map-to-html.j2` | register map `.md` | HTML page | one `<section>` per register with a field/value table |
| `yaml-to-register-map.j2` | `*_fpga_types.yaml` | register map `.md` | **backward**: open the generated YAML, Generate with the Markdown format |
| `json-to-register-map.j2` | `*_fpga_types.json` | register map `.md` | **backward**: same, from the JSON twin |

Known normalizations (the data files are lossy projections — the backward
templates re-derive what they can):
- enum values are emitted as the decimal numbers shown in the table
  (`0x100` renders as `256` — same value);
- a bitfield's padding row appears as `reserved`, so the field is emitted as
  `<register>_padding` with doc `"N/A"` (and written back as `reserved`);
- `codegen` settings are not present in the tables — the templates emit a
  constant `snake_case` block; edit it per project;
- backward templates assume 32-bit registers at sequential 4-byte offsets
  (word = index) and recompute field offsets from the field sizes.

Verified by `tests/jinjaTemplate.test.js`: each forward template renders the
demo register map (`tests/fixtures/register-map-demo.md`) byte-for-byte to
`tests/fixtures/register-map-demo.<ext>.expected`, renders the pab1-style
document (`tests/fixtures/pab1-register-map.md`) with per-format content
checks, and the round trip **md → yaml → md → yaml is byte-identical** for
both the demo and the pab1 document.

## Backward conversion (YAML/JSON → Markdown)

Open a `*_fpga_types.yam(l)` or `*_fpga_types.json` file in the editor, pick
`yaml-to-register-map.j2` (or the JSON twin) with the Template button, choose
the **Markdown** format and press Generate — the register-map Markdown
document comes back in the output folder. The backward templates read the
pre-parsed `types` context value (the engine detects YAML or JSON
automatically), so the body iterates `for name, t in types | items`. A
document without a `types` section renders an explanatory error line.

## Live input → output link

After a Jinja Generate, the output file opens beside the editor and the two
documents stay linked for that editor session:

1. the templates emit one `@register <name>` marker per section (comment
   lines; a JSON key for JSON; the register's table row for Markdown output);
2. when you edit a section in the open document, the extension re-renders the
   template against the current text (400 ms debounce) and rewrites the
   output file;
3. it then detects which section changed (per-register content fingerprints),
   finds that section's line span in the output via the markers, and **scrolls
   the output editor to the section and selects it** — you see the effect of
   your edit exactly where it landed.

If the output file has unsaved user edits the rewrite is skipped (the reveal
still happens, against the on-disk content) so manual edits are never
clobbered. `docx` has no live sync (binary format, no template output).

## Writing a new template

Copy `templates/register-map-to-yaml.j2`, change the front matter and body,
save anywhere, pick it with the Template button, choose the output format and
press Generate. The Format dropdown only decides the output extension — the
template body decides the content, so any text format can be a target.

## Legacy mapping templates

`.table-template.json` files (see TEMPLATE-SYNC.md) still work: when a
generate request names one, the structured column-mapping generator in
`codeGenerator.ts` runs instead of the Jinja renderer.
