# Corporate Word templates

Version 0.16.0 adds DOCX as the eleventh editable template format. Use your existing corporate DOCX or DOTX master, map selected tables and tagged text controls to Markdown, and generate a separate DOCX in a custom location. Edit the generated file in Word or LibreOffice and import the saved values back. This feature does not require Word, Python, LibreOffice or a network connection at runtime.

## Start with your corporate template

1. Keep the original corporate master in your workspace, for example `templates/company-specification.docx` or `.dotx`. The extension does not modify the master.
2. Run **Markdown Editor: Create table template (11 formats including DOCX)** and select **docx**. Select your corporate master, then choose a table from its header preview. The table must have unique column labels and at least one plain prototype data row.
3. Save the mapping inside your workspace as, for example, `controller.table-template.json`. The wizard creates `controller.md` populated from the chosen Word table. The first column is initially the row key and all columns initially use string values. Adjust the key and types as needed.
4. Set `output` to the desired generated `.docx` path. Paths are relative to the mapping file; absolute paths and `../` destinations work too. Use a different path from the original master.
5. Save the mapping and Markdown, then run **Generate output from Markdown (11 formats including DOCX)**. The first generation uses a copy of the corporate master.
6. Edit the generated file in Word. **Save and close Word before synchronizing.** Workspace file changes are watched; closing Word removes its lock file and triggers a retry. You can also run **Import output into Markdown (11 formats including DOCX)** explicitly. For an output outside the workspace, use the manual command after editing it externally.

The example under `examples/table-sync/docx` contains a corporate master, Markdown source, mapping and generated document. It includes a logo, header/footer, page-number field, requirements table, revision-history table, tagged title/revision fields and an unmanaged approval block. These are synthetic examples, not your organization's approved document design.

## Choose a stable table selector

| Selector | Meaning | When to use |
| --- | --- | --- |
| `{"tag":"requirements"}` | A block Word content control with this Tag enclosing one table | Preferred for templates that evolve |
| `{"caption":"Engineering requirements"}` | The Word table's OOXML `tblCaption` property | Stable existing table metadata |
| `{"index":1}` | First top-level table in the main document body | Existing untagged corporate templates |

Use exactly one selector kind. `index` starts at 1. Word's **Insert Caption** paragraph is separate from `tblCaption` and is not this selector. A template without a caption uses table index in the wizard. Revisit index mappings if tables are inserted or moved.

To use a content-control tag, enable Word's Developer tab, put the table in a block rich-text content control, open its Properties, and set **Tag** to your stable identifier. The control must contain exactly one top-level table. XML data-bound or content-locked controls cannot be modified.

By default, the first row is the header. `headerRow` is zero-based; set it to `1` if a corporate table has a decorative title row above the real column headers. Earlier rows are retained. The selected header and data area must have an ordinary rectangular grid without merged cells.

A `headers` map supports different Word labels. For example, `"headers":{"ID":"Requirement ID"}` maps the Markdown `ID` column to the Word `Requirement ID` column.

## One table

```json
{
  "version": 1,
  "format": "docx",
  "markdown": "requirements.md",
  "output": "deliverables/controller-specification.docx",
  "table": "requirements",
  "root": ["rows"],
  "key": "ID",
  "columns": {
    "ID": {"path": ["id"], "type": "string"},
    "Requirement": {"path": ["requirement"], "type": "string"},
    "Owner": {"path": ["owner"], "type": "string"},
    "Status": {"path": ["status"], "type": "string"}
  },
  "docx": {
    "template": "templates/corporate-specification.docx",
    "selector": {"tag": "requirements"}
  }
}
```

The Markdown source contains:

```markdown
<!-- table-sync:requirements -->
| ID | Requirement | Owner | Status |
| --- | --- | --- | --- |
| REQ-001 | The controller shall report measurements every second. | Firmware | Draft |
<!-- /table-sync:requirements -->
```

Stable unique IDs match rows across edits and reorder. Adding/removing a row is reflected in the other file. Unmapped Word cells and Markdown note columns survive for existing IDs. A changed ID is treated as a new row; its unmapped cells start blank. New rows reuse the prototype's cell/paragraph/run formatting. Keep a prototype row in the original master so rows can be added again after an empty generated table.

## Multiple tables and text sections

Use `docx.tables` for multiple table bindings in the same output. Each entry defines its own Markdown marker name, row key, columns and Word selector. The top-level table/key/columns remain required for compatibility, but `docx.tables` supplies the actual Word table bindings when present. All mappings are validated before writing; an error in any table or field prevents the document update.

The complete corporate example demonstrates independent `requirements` and `revisions` tables. It preserves the separate approval table. Each table marker must be unique, and a Word table cannot be targeted by more than one binding.

To synchronize text such as a project title, revision, purpose or scope, add a **plain-text or rich-text content control** in the main Word document and set its Tag. Then add:

```json
"fields": [
  {"tag": "project-title", "marker": "project-title"},
  {"tag": "document-revision", "marker": "document-revision"}
]
```

under `docx`, and put matching blocks in Markdown:

```markdown
<!-- docx-field:project-title -->
Controller specification
<!-- /docx-field:project-title -->

<!-- docx-field:document-revision -->
Revision B
<!-- /docx-field:document-revision -->
```

Both inline and block text controls are supported. Tags and marker names must be unique. These blocks contain plain text; Markdown lists, bold syntax and headings inside a block are not converted into Word rich formatting. Changed fields retain the initial paragraph/run style, rather than preserving mixed styling on each individual character. Dates, dropdowns, checkboxes and XML data-bound controls are not supported as text bindings.

## What is preserved

The updater replaces only the XML spans for mapped tables and changed text-control content in `word/document.xml`. Surrounding paragraphs, sections and unmapped tables remain unchanged. Other ZIP members retain their original uncompressed bytes, including headers, footers, embedded media, styles, numbering, relationships, metadata and comments outside the managed areas. ZIP compression/container bytes can change. DOTX initialization also converts the main content type to a standard DOCX document.

Existing rows keep their row/cell properties. Changed plain-text cells retain the first paragraph and run formatting; unchanged cells retain their content and formatting. New rows clone the prototype's formatting with blank unmapped cells. Original page size, margins, letterhead and company styles remain in place. Layout can still change naturally when longer text or extra rows add pages; use wrapping and automatic row height in the corporate master.

Tables/fields in headers, footers, text boxes and linked external documents are not synchronization targets. They are preserved. This is not a full WYSIWYG Word editor, and arbitrary prose outside tagged blocks is not synchronized.

## Corporate review and recovery

- A Word or LibreOffice lock file pauses synchronization. Save and close the document, then retry if no watcher event arrives. The extension does not automate Word or save its unsaved edits.
- Before replacing an existing DOCX, the previous file is copied to `<output>.table-sync.bak`. The replacement is staged in the same directory and renamed. The master is untouched. The backup retains the previous version only.
- If Markdown and Word both changed since the last baseline, synchronization stops. Compare the files, then explicitly Generate or Import to choose the source. A changed mapping or output without a baseline also requires choosing the source.
- Tracked changes, anchored comments/bookmarks, nested tables, fields, hyperlinks, drawings or custom XML inside a managed table/field are rejected. Place these outside mapped areas, or use plain cells for the synchronized values. Merged/omitted cells in the selected header/data rows are rejected. Corporate content outside mapped areas can retain these features.
- Signed packages, macro-enabled packages and protected Word documents are not synchronized. Use an authorized editable DOCX/DOTX master. The extension does not remove protection or accept tracked changes for you.
- Keep both Markdown and generated Word documents in version control or your corporate revision system. This is a local synchronization mechanism, not a multiuser document server, approval workflow or digital-signature system.

## Verification and build

Run `build.bat` and install the generated VSIX. The original ten editable text formats remain available.

Automated coverage includes Word-side ZIP/XML edits imported into Markdown, multiple tables, tagged text, inline controls, captions/indices, custom destinations, DOTX conversion, extra-row formatting, deletion/empty-table recovery, archive-part preservation, binary backups, lock-file close/retry, conflicts, and the corporate-template picker. The example master and generated DOCX were rendered and visually checked. Native Microsoft Word on Windows was not executed; validate your actual corporate template before using it for a controlled release.
