# Documentation reader 0.12.0

## Find the mind map

- Click the branching documentation icon in the left Activity Bar.
- Click **Mind map** at the top of the Piper panel.
- Use the branching icon on an editor tab's toolbar or the **Mind map** status-bar button.
- The Command Palette still offers **Markdown Editor: Open documentation mind map**.

The Activity Bar and Explorer both expose the same documentation tree. Open a project folder to index it. The map groups documents by folder and section heading; PDF imports use page nodes. Expand branches, choose the visible level count, zoom, pan, search, and click a node to open its location. For converted formats, source navigation opens a read-only extracted Markdown view; it does not edit the original binary file.

## Supported formats

These are ten common documentation format families, selected for engineering/project documentation rather than an asserted popularity ranking.

| Family | Extensions | Outline and code support | Running header/footer detection |
| --- | --- | --- | --- |
| Markdown | `.md`, `.markdown`, `.mdown` | ATX/setext headings; fenced, indented and inline code | HTML `<header>`/`<footer>` and explicit reader markers |
| Plain text | `.txt`, `.text` | Text paragraphs; no inferred semantic outline | Explicit reader markers only |
| HTML | `.html`, `.htm`, `.xhtml` | H1–H6; `pre`, `code`, common monospace styles | `header`/`footer` elements and banner/contentinfo roles |
| PDF | `.pdf` | Page outline and text-layer extraction | Heuristic: first/last nonempty lines repeated on at least 60% of pages (minimum 2) |
| Word | `.docx` | Heading styles, body text, tables, `Code`/`Source Code` styles | Embedded Word header/footer parts |
| OpenDocument | `.odt` | Outline-level headings, paragraphs; named code/source/preformatted styles | Header/footer content in `styles.xml` |
| EPUB | `.epub` | Chapter spine order, HTML headings and code | Chapter HTML header/footer markup |
| Rich Text | `.rtf` | Body text and common monospace formatting; no guaranteed heading outline | RTF header/footer destination groups |
| reStructuredText | `.rst`, `.rest` | Underlined headings, code/source directives, inline literals | `header` and `footer` directives |
| AsciiDoc | `.adoc`, `.asciidoc` | `=` headings and listing/source delimiters | Explicit reader markers; publishing attributes are not spoken |

Scanned PDFs require OCR before import. Encrypted/password-protected PDFs and DRM EPUBs are not supported. Legacy `.doc`, `.xls`, `.ppt`, presentations and spreadsheets are not included. RST/AsciiDoc support is an extraction subset, not a full Sphinx/Asciidoctor rendering engine. Include directives, document scripts, embedded objects and remote resources are not executed or fetched. Complex PDF columns, unusual office styles, and unmarked code/header/footer text can need manual cleanup. PDF text extraction does not infer code reliably; code skipping applies when the format identifies code. Non-repeating PDF banners may remain. Disabling the matching skip control restores detected content; it cannot restore content a source format/parser does not expose.

## Listening options

The reader's **Skip while listening** section has independent checkboxes for:

- Code blocks and inline code.
- URL addresses (descriptive link labels remain).
- Running page headers.
- Running page footers.

All default to enabled. Section headings remain readable and navigable. Changing a control pauses playback and rebuilds the index near the current source line; press Read to continue. Options are remembered per workspace. Corresponding defaults are available under `markdownEditor.piper.skipCode`, `skipUrls`, `skipHeaders`, and `skipFooters`. The legacy `readCodeBlocks` setting is deprecated. Reader workspace overrides take precedence over configuration defaults. Use **Open document…** in the Piper panel, the document's Explorer context menu, or **Markdown Editor: Open and listen to document (10 formats)** to load a file.

For unstructured text, explicitly mark running banners as:

```text
:::reader-header
Repeated report title
:::

# Actual section heading
Main body.

:::reader-footer
Company contact details
:::
```

## Limits and local processing

Imports remain local. The default documentation scan permits 2,000 files of up to 32 MiB each; settings can change the scan limits. Individual reader inputs are capped at 64 MiB, extracted text at 8 MiB, and ZIP document expansion at 64 MiB / 10,000 entries. The map renders at most 3,000 nodes at once; use search or collapsed levels for larger projects. Failures are summarized in the status bar/map and detailed in the extension-host log.

## Build and install on Windows

1. Extract the complete project ZIP.
2. Run `build.bat`, or reuse the existing offline voices/runtimes with:

   ```powershell
   .\build.bat "C:\path\to\your-existing-offline.vsix"
   ```

3. Install `artifacts\markdown-listening-offline.vsix` through **Extensions → … → Install from VSIX**.
4. Run **Developer: Reload Window**.

Node.js 22.13+ is required for building; VS Code 1.105+ is required for this release's document parsers. The native Windows asset build from 0.11.1 remains in place and does not require WSL. The source ZIP excludes Piper voice/runtime assets; parser npm dependencies are restored by `npm ci` and included in the VSIX along with the PDF worker. Text-only PDF extraction uses a portable matrix implementation and does not require native canvas rendering modules.

## Validation

Automated checks cover all ten file types, EPUB chapter order, DOCX/ODT/RTF headers/footers, PDF repeated page edges, independent skip flags, malformed/encrypted documents, and reader navigation/bookmarks/cancellation. Real headless Chromium checks cover both the map and reader controls under the content-security policy. Native VS Code shell integration and Windows Piper audio playback still need desktop verification. Browser tests require Playwright plus a compatible Chromium executable and are optional in source-only `npm test`.

Additional packaging check: the exact VSIX-listed files were staged in isolation, without native canvas modules; all ten imports also opened through the staged webpack extension. This catches missing transitive parser dependencies and asset resolution failures.
