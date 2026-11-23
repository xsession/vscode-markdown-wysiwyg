# Table mappings

A table mapping is a JSON file, conventionally named
`<name>.table-template.json`, that binds one marked Markdown table to rows in
a generated file. Choose it with the editor's **Template** button and click
**Generate**. A tutorial is in
[Keep a table in sync with a config file](../tutorials/table_sync.md).

## The marked table

```markdown
<!-- table-sync:devices -->
| ID | Name | Pin | Enabled |
| --- | --- | --- | --- |
| led | Status LED | 13 | true |
<!-- /table-sync:devices -->
```

- The name after `table-sync:` must match the mapping's `table`.
- A header row and a separator row are required. Rows must start and end with
  `|`.
- Write a literal pipe in a cell as `\|`, and a line break as `<br>`.
  Surrounding whitespace in cells is trimmed. Code spans containing pipes are
  not supported.

## Schema

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | no | `1` |
| `format` | no | output format id; when omitted, taken from the extension of `output` |
| `markdown` | yes | the Markdown file, relative to the mapping |
| `output` | yes | the generated file, relative to the mapping (or absolute) |
| `table` | yes | the marker name |
| `root` | for YAML, JSON, TOML, XML, INI, env, properties | path of field names to the row list, such as `["project", "devices"]` |
| `key` | recommended | the column whose values identify rows |
| `columns` | yes | for each Markdown column: `path` (field names inside a row) and `type` (`string`, `number` or `boolean`) |

```json
{
  "version": 1,
  "format": "json",
  "markdown": "devices.md",
  "output": "generated/board.json",
  "table": "devices",
  "root": ["project", "devices"],
  "key": "ID",
  "columns": {
    "ID":      {"path": ["id"], "type": "string"},
    "Name":    {"path": ["name"], "type": "string"},
    "Pin":     {"path": ["hardware", "pin"], "type": "number"},
    "Enabled": {"path": ["enabled"], "type": "boolean"}
  }
}
```

**Types.** `boolean` cells are `true` or `false`. Keep identifiers such as
`001` as `string`.

!!! warning "Check number columns"
    When Generate meets a `number` cell that is not a valid number (for
    example `x` or `12 mA`), it writes an empty value instead of stopping.
    Check the generated file after changing number columns.

**Output location.** The mapping's `output` is used as is unless the toolbar
sets an output folder or overrides the format; then the file name is kept and
the folder or extension changes. The output may not be the Markdown file, the
mapping itself, or a DOCX template.

## Layouts by format

The layout is fixed for each format so that the file can be read back
reliably.

=== "YAML / JSON / TOML"

    The row list lives at `root`; each row is an object with the mapped
    paths.

    ```yaml
    project:
      devices:
        -
          id: led
          name: "Status LED"
          hardware:
            pin: 13
          enabled: true
    ```

    ```toml
    [[project.devices]]
    id = "led"
    name = "Status LED"
    hardware.pin = 13
    enabled = true
    ```

    JSON is strict (no comments, no trailing commas, no duplicate keys) and
    indented with tabs.

=== "XML"

    The first `root` segment is the document element, the rest lead to the
    row container. Each row is a `<row>` element with nested field elements.

    ```xml
    <project>
      <devices>
        <row>
          <id>led</id>
          <hardware><pin>13</pin></hardware>
        </row>
      </devices>
    </project>
    ```

    Mapped values are element text, not attributes. Unqualified element names
    only. DTDs and entities are rejected when reading back.

=== "CSV / TSV"

    A header row with the Markdown column names, then one line per row.
    `root` is not used. Quoting follows RFC 4180.

    ```text
    ID,Name,Pin,Enabled
    led,Status LED,13,true
    ```

=== "INI"

    One section per row, `[<root joined by dots>.<index>]`; nested paths use
    dotted keys. Strings are double-quoted with JSON escapes.

    ```ini
    [project.devices.0]
    id="led"
    name="Status LED"
    hardware.pin=13
    enabled=true
    ```

=== ".env"

    Upper-case names joined with `__`, with the row index as a segment.
    Strings use JSON-style quotes. No `export`, interpolation or inline
    comments. The file is never sourced or executed.

    ```bash
    PROJECT__DEVICES__0__ID="led"
    PROJECT__DEVICES__0__HARDWARE__PIN=13
    ```

=== ".properties"

    Dotted keys including the row index. Non-ASCII characters are written as
    `\uXXXX`; continuation lines are not supported.

    ```properties
    project.devices.0.id=led
    project.devices.0.hardware.pin=13
    ```

=== "HTML"

    A complete page with one `<table data-table-sync="NAME">`, a header row
    and one row per record. `root` is not used. Nested tables, merged cells
    and markup inside cells are not supported when reading back.

=== "DOCX"

    A minimal Word document containing one table: a header row and one row
    per record. It is not read back. Generating into a corporate DOCX or DOTX
    master (`docx.template` in the mapping) is not available in this build.

For INI, `.env` and `.properties`, path segments must be simple identifiers
(no dots, no `__`, and no hyphens for `.env`). Row indices may have gaps when
read back; they are renumbered from zero on the next Generate.

## What is kept

| Side | Kept | Replaced |
| --- | --- | --- |
| Markdown | everything outside the markers; unmapped columns of rows whose key still exists | mapped cells, row order, added and removed rows |
| Output | — | the whole file, on every Generate (the previous one is copied to `<output>.table-sync.bak`) |

## Errors that stop synchronization

- the marker block is missing, or has no header and separator rows;
- the key column is empty or has duplicates;
- the output does not have the expected layout (for example, no list at
  `root`);
- both the Markdown and the output changed since the last synchronization.

Nothing is written when any of these occurs.
