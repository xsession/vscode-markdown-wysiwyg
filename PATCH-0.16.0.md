# Upgrade 0.15.0 to 0.16.0

Extract this patch into your existing `markdown-listening` source folder, allow file replacement, then run `build.bat` and install the generated VSIX. Existing downloaded voices, native runtimes and local-model files are retained.

Run **Markdown Editor: Create table template (11 formats including DOCX)**, select docx, choose your corporate DOCX/DOTX master and pick a table. The wizard creates a Markdown source and mapping. Configure a separate `.docx` output, then run **Generate output from Markdown**. Save and close Word before importing its edits.

Read `DOCX-TEMPLATES.md`. The working corporate master, generated sample, Markdown and multi-table/tagged-text mapping are in `examples/table-sync/docx`.

Use the full source archive for another base version. Native Microsoft Word/Windows execution was not performed; automated binary sync tests and rendered example QA ran on Linux.
