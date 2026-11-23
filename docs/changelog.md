# Release history

The most recent changes first. Version numbers follow the release notes; the
codebase map and the Jinja work came after 0.16.0 and are not yet assigned a
version.

## Unreleased

- **Codebase map**: folders as islands, files as hills, imports as roads;
  Route, Walk and Runtime modes; git submodules as territories; VS Code theme
  colours; refresh prompt; settings for limits and exclusions.
- **Jinja conversion templates** with a built-in TypeScript engine, eleven
  bundled register-map templates (and two backward ones), templates inferred
  from examples, and live two-way synchronization.
- The bundled local AI model and runtime were removed from the package. The
  assistant reports that the bundle is missing.
- This documentation was rewritten as a MkDocs site.

## 0.16.0: Word output

- DOCX became the eleventh table-mapping output format. Generation into an
  existing corporate DOCX/DOTX master was described for this release but is
  not available in the current build; plain DOCX table output is.

## 0.15.0: ten table-mapping formats

- YAML, JSON, TOML, XML, CSV, TSV, INI, `.env`, Java properties and HTML table
  outputs with custom output paths and two-way synchronization on save.

## 0.13.1: Windows PDF paths

- PDF.js asset folders now end in `/` on Windows (drive and UNC paths), which
  fixed PDF import there.
- Compatible dependency updates cleared the 18 reported npm audit findings.

## 0.13.0: project listening workspace

- Listening queue, guided project tour, synchronized source, heard progress,
  corrections overlay, pronunciation rules, English/Hungarian voice switching,
  focus mode, diagnostics and global listening shortcuts.
- A bundled local model for source-linked explanations (since removed).

## 0.12.0: ten import formats

- Import of Markdown, text, HTML, PDF, DOCX, ODT, EPUB, RTF,
  reStructuredText and AsciiDoc.
- Four skip options: code, URLs, running headers and running footers.
- Documentation Activity Bar icon, editor toolbar and status-bar mind-map
  entries. Requires VS Code 1.105.

## 0.11.1: legacy Piper setting

- A saved `markdownEditor.piper.executable` of `piper` caused
  `spawn piper ENOENT`. Empty, `auto` and bare `piper` without arguments now
  select the bundled engine.

## 0.11.0: documentation explorer

- **Documentation contents** tree with headings, and the documentation mind
  map with zoom, pan, collapse, level presets and search.

## 0.10.0: native offline speech

- The native Piper engine and six voices bundled for Windows x64 and Linux
  x64; no Python needed. One persistent engine process with look-ahead.
- Structural navigation, bookmarks, saved position, recall mode, speed
  0.5×–4×, sleep timer and media-session support.

## 0.9.0

- First Piper reader, based on Python Piper 1.8.
