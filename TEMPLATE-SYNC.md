# DOCX corporate templates added in 0.16.0

DOCX is now the eleventh editable format, including existing corporate DOCX/DOTX masters, multiple tables and tagged text fields. See [DOCX-TEMPLATES.md](DOCX-TEMPLATES.md). The ten text-format adapters below remain available. Command titles now say 11 formats including DOCX.

# Editable table templates (0.15.0)

Generate editable files from a Markdown table and synchronize saved edits back to the table. Ten common configuration and table formats are included. This is a structured table mapping system, not an arbitrary document converter.

## Start

1. Open your project folder in VS Code and trust it.
2. Run **Markdown Editor: Create table template (10 formats)** and select a format.
3. Save the `.table-template.json` file. It defines the source Markdown, destination path, field names and types. An example `devices.md` is created alongside it unless that file already exists.
4. Edit the template to match your project and save all relevant buffers.
5. Run **Generate output from Markdown (10 formats)** and choose the template. This explicitly chooses Markdown as the source, including when the output already exists.
6. Edit and save either file. The other updates automatically while the extension is active. Use **Import output into Markdown (10 formats)** to explicitly choose the generated file as the source. **Synchronize template table** chooses automatically when a baseline is available.

A sync button appears in supported editor titles. Templates without `format` continue to infer their format from the output extension; existing YAML templates keep working. `.yml`, `.htm`, `.env` and `.env.local` are recognized. An explicit `format` also supports custom extensions such as `board.cfg`.

Paths are relative to the template file. Absolute paths and `../` are supported for custom destinations. Parent folders are created. Workspace output files are watched for external edits. An output outside the workspace synchronizes when saved in this VS Code window or using the manual command.

## Included formats and examples

Each example directory contains a Markdown source, template, and actual generated output. Because the example outputs already exist, run Generate or Import once to establish the source direction.

| Format | Example directory | Managed structure | Preservation |
| --- | --- | --- | --- |
| YAML | `examples/table-sync/yaml` | Object list at `root` | Other fields, extra row fields and comments outside the list |
| JSON | `examples/table-sync/json` | Object array at `root` | Other fields and extra row fields; indentation regenerated |
| TOML | `examples/table-sync/toml` | Array of tables at `root` | Other fields and extra row fields; comments/formatting regenerated |
| XML | `examples/table-sync/xml` | `<row>` elements inside the element path in `root` | Other elements/attributes and extra elements in matching rows; serialization may change |
| CSV | `examples/table-sync/csv` | Header names match mapped Markdown column names | Extra columns retained for matching row IDs |
| TSV | `examples/table-sync/tsv` | Same as CSV, separated by tabs | Extra columns retained for matching row IDs |
| INI | `examples/table-sync/ini` | Indexed sections, e.g. `[project.devices.0]` | Other sections and extra fields in matching rows |
| Environment | `examples/table-sync/env` | Indexed uppercase variables, e.g. `PROJECT__DEVICES__0__ID` | Unmanaged lines and extra fields in matching rows |
| Java properties | `examples/table-sync/properties` | Indexed keys, e.g. `project.devices.0.id` | Unmanaged lines and extra fields in matching rows |
| HTML | `examples/table-sync/html` | `<table data-table-sync="devices">` with a header row | Surrounding document and extra columns; managed table markup regenerated |

These layouts are intentionally defined so edits can be read back reliably. Arbitrary schemas in existing files must be adapted to the supported layout first. Each format supports strings, finite numbers, and booleans.

## Mapping example

Enclose one Markdown pipe table in unique markers:

```markdown
<!-- table-sync:devices -->
| ID | Name | Pin | Enabled |
| --- | --- | --- | --- |
| led | Status LED | 13 | true |
<!-- /table-sync:devices -->
```

A template defines the mapping:

```json
{
  "version": 1,
  "format": "json",
  "markdown": "devices.md",
  "output": "generated/board.json",
  "table": "devices",
  "root": ["project", "devices"],
  "key": "ID",
  "defaults": {"project": {"name": "My board"}},
  "columns": {
    "ID": {"path": ["id"], "type": "string"},
    "Name": {"path": ["name"], "type": "string"},
    "Pin": {"path": ["hardware", "pin"], "type": "number"},
    "Enabled": {"path": ["enabled"], "type": "boolean"}
  }
}
```

This creates `project.devices` as an array with nested `hardware.pin`. Change `format` and `output` to use a different adapter. `defaults` applies only to a newly created YAML, JSON or TOML document; omit it for other formats.

`key` identifies a unique, nonempty mapped column. IDs retain extra fields and unmapped Markdown notes across row reorder. Rows added or removed on one side are added or removed on the other. Changing an ID is treated as deleting and creating a row. Literal booleans are `true` and `false`; identifiers such as `001` should remain strings. A quoted numeric identifier is required in YAML/JSON/TOML.

Only the marked table changes in Markdown. Unmapped Markdown columns survive for matching IDs. Surrounding headings and prose remain untouched. Pipes in Markdown cells use `\|`; multiline values use `<br>`. Leading/trailing cell whitespace is trimmed. Markdown code spans containing pipes are not supported.

## Format details

- **YAML/JSON/TOML:** `root` is a nonempty field-name path, not a query expression. The managed value must be a list of objects. Mapped paths cannot overlap. YAML comments, anchors and formatting inside the list are regenerated. TOML comments are not preserved. JSON is strict, without comments or trailing commas; duplicate fields are rejected. Dates and other unmapped TOML values are retained where the TOML library supports them.
- **XML:** the first `root` segment is the document element; subsequent segments reach the row container. Each row uses `<row>`, with nested mapped elements. Mapped fields must contain scalar text, not attributes or mixed markup. Paths use unqualified XML element names. DTD entities/internal subsets are rejected. A missing or duplicate field/path stops import.
- **CSV/TSV:** the header uses mapped Markdown column names. Quoted delimiters, quotes and newlines follow CSV rules. The `root` field is not used for these flat tables.
- **INI:** the dotted root becomes a section prefix. Each row is `[prefix.0]`, `[prefix.1]`, etc.; nested fields use dotted names such as `hardware.pin`. String values are double-quoted with JSON escapes. Managed fields use `key=value`. Unmanaged sections are retained. Managed section comments are regenerated. INI dialects vary; the included example defines the supported syntax.
- **Environment:** root/field segments become uppercase names separated by `__`, with a numeric row segment. Strings use JSON-style double quotes and escapes; numbers/booleans are unquoted. Only `KEY=value` is supported for managed entries, without `export`, variable interpolation, shell expressions or inline comments. The extension never sources or executes the file. It is a configuration file, not a shell script.
- **Properties:** dotted keys include the numeric row segment. Managed entries use `key=value`; values support escaped separators, whitespace, backslashes, newlines and `\uXXXX` Unicode. Output escapes non-ASCII characters for compatibility with Java properties loaders. Continuation lines and alternate separators are not supported for managed entries.
- **INI/env/properties:** root and field paths must be simple identifier segments, with no dots or `__` inside a segment. Environment segments cannot contain hyphens. Environment case-conversion collisions are rejected. Numeric row indices can have gaps on import and are regenerated from zero on export; stable row identity still comes from `key`.
- **HTML:** exactly one table must have the matching `data-table-sync` attribute. Use one plain-text header row followed by data rows; nested tables, merged cells and markup inside mapped cells are not supported. The generated HTML is suitable for editing in a source editor; arbitrary browser-authored HTML may require normalization. The `root` field is unused. Scripts are never executed by the extension.

## Conflicts and recovery

A baseline is persisted per workspace/template. If both files change, synchronization stops. Compare the files, then explicitly choose Generate or Import to select which side wins. These commands intentionally replace managed values on the other side. Existing output without a baseline, or any changed template, requires the same choice. Save the source, destination and template before sync; dirty buffers prevent writes. Watcher bursts are batched and sync operations run in order.

Use one owner per output and marked table to avoid competing mappings. File deletion is not imported as row deletion. For deletion of all records, retain a valid empty table/list in the output. Validation failures stop writes. Workspace trust is required and templates execute no scripts. The operation is not a distributed filesystem transaction; keep source control for recovery when other applications edit the same files concurrently.

## Build and verification

Run `build.bat` to build with the existing offline asset workflow. Tests cover all ten adapters, actual output text edits, multiline and escaped values, Unicode, extra-field retention, row add/delete/reorder, automatic save and watcher events, persisted baselines, conflict refusal, workspace trust and dirty buffers. Tests run on Linux with VS Code API fixtures; native Windows/VS Code GUI execution remains unverified.
