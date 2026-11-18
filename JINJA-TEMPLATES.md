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
  `csv`, `tsv`, `ini`, `env`, `properties`, `html`, `docx`). Picking the
  template auto-selects it; the dropdown can still override it. The id sets
  the output file extension.
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
| `strip_tags(text)` | remove HTML tags, decode entities |
| `yaml_q(text)` | double-quoted YAML scalar (safe for any text) |

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

## The first template: `templates/register-map-to-yaml.j2`

Built from `C:\Users\livanyi\Desktop\GIT\yaml_template_examples\generic`:
it is the inverse of `generic/generate_md.py`, converting the register-map
Markdown document (`Offset | Word | Name | Size | Format | Access |
Description`) back into a `*_fpga_types.yaml` type definition (enum values,
bitfield fields, array registers, and the struct with `EXT__` references).
It accepts both register-map styles: the single table with nested content
inside the Description cell (the demo), and documents where each register is
a one-line row followed by its description and nested table as separate
lines (the pab1 fixture). Set `struct_name` in the front matter to your
project's struct type (remove the line to skip the struct section).

Known normalizations (the Markdown document is a lossy projection):
- enum values are emitted as the decimal numbers shown in the table
  (`0x100` renders as `256` — same value);
- a bitfield's padding row appears as `reserved`, so the field is emitted as
  `<register>_padding` with doc `"N/A"`;
- `codegen` settings are not present in the table — the template emits a
  constant `snake_case` block; edit it per project.

Verified by `tests/jinjaTemplate.test.js`: the bundled template renders the
demo register map (`tests/fixtures/register-map-demo.md`, from
`generic/example/generated/md/demo_fpga_types.md`) byte-for-byte to
`tests/fixtures/register-map-demo.expected.yaml`, whose structure mirrors
`generic/example/demo_fpga_types.yaml`; and it renders the style-2 pab1
register map (`tests/fixtures/pab1-register-map.md`) to
`tests/fixtures/pab1-register-map.expected.yaml`.

## Writing a new template

Copy `templates/register-map-to-yaml.j2`, change the front matter and body,
save anywhere, pick it with the Template button, choose the output format and
press Generate. The Format dropdown only decides the output extension — the
template body decides the content, so any text format can be a target.

## Legacy mapping templates

`.table-template.json` files (see TEMPLATE-SYNC.md) still work: when a
generate request names one, the structured column-mapping generator in
`codeGenerator.ts` runs instead of the Jinja renderer.
