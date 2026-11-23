# Document formats

## Formats the reader and index can import

| Family | Extensions | Outline | Code | Running headers and footers |
| --- | --- | --- | --- | --- |
| Markdown | `.md`, `.markdown`, `.mdown` | ATX and Setext headings | fenced, indented, inline | HTML `<header>`/`<footer>`, reader markers |
| Plain text | `.txt`, `.text` | none | none | reader markers |
| HTML | `.html`, `.htm`, `.xhtml` | `h1`–`h6` | `pre`, `code`, monospace styles | `header`/`footer`, banner/contentinfo roles |
| PDF | `.pdf` | pages | not detected reliably | lines repeated on ≥ 60 % of pages (min. 2) |
| Word | `.docx` | heading styles; tables | `Code` / `Source Code` styles | header and footer parts |
| OpenDocument | `.odt` | outline levels | code, source, preformatted styles | `styles.xml` header/footer |
| EPUB | `.epub` | spine order, HTML headings | as HTML | chapter `header`/`footer` |
| Rich Text | `.rtf` | not guaranteed | monospace formatting | RTF header/footer groups |
| reStructuredText | `.rst`, `.rest` | underlined headings | code/source directives, literals | `header`/`footer` directives |
| AsciiDoc | `.adoc`, `.asciidoc` | `=` headings | listing and source blocks | reader markers |

Not supported: scanned PDFs without a text layer (run OCR first), encrypted
PDFs, DRM-protected EPUBs, legacy `.doc`, spreadsheets and presentations.

### Size limits

| Limit | Value |
| --- | --- |
| Reader input file | 64 MiB |
| Extracted text | 8 MiB |
| ZIP-based documents (DOCX, ODT, EPUB) | 64 MiB expanded, 10,000 entries |
| Indexed file | `markdownEditor.documentation.maxFileBytes` (32 MiB) |

### Reader markers

```markdown
:::reader-header
Repeated report title
:::

:::reader-footer
Company contact details
:::
```

How these formats are converted is described in
[Document import](../theory/document-import.md).

## Output formats for Generate

| Format id | Extension | Jinja template | Table mapping: generate | Table mapping: read back |
| --- | --- | --- | --- | --- |
| `yaml` | `.yml` | :material-check: | :material-check: | :material-check: |
| `json` | `.json` | :material-check: | :material-check: | :material-check: |
| `toml` | `.toml` | :material-check: | :material-check: | :material-check: |
| `xml` | `.xml` | :material-check: | :material-check: | :material-check: |
| `csv` | `.csv` | :material-check: | :material-check: | :material-check: |
| `tsv` | `.tsv` | :material-check: | :material-check: | :material-check: |
| `ini` | `.ini` | :material-check: | :material-check: | :material-check: |
| `env` | `.env` | :material-check: | :material-check: | :material-check: |
| `properties` | `.properties` | :material-check: | :material-check: | :material-check: |
| `html` | `.html` | :material-check: | :material-check: | :material-check: |
| `markdown` | `.md` | :material-check: | — | — |
| `docx` | `.docx` | — (binary) | plain table | — |

For a Jinja template, the format only sets the file extension; the template
decides the content, so any text format can be produced.
