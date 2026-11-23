# Tests and validation

## Automated tests

`npm test` compiles the TypeScript and runs the Node test files in `tests/`.
VS Code is replaced by a small in-process mock, so the suite runs without a
VS Code window, voices, native runtimes or network.

| Area | Test files | Covers |
| --- | --- | --- |
| Speech text | `speechText`, `listeningDocument` | sentence splitting, headings, tables, code skipping, a 40,000-sentence document |
| Speech engine | `speechEngine`, `piperReader`, `voiceManager` | one persistent process for many requests, ordered results, WAV validation, cancellation, trust, runtime selection without Python |
| Documents | `documentFormats`, `documentLoader`, `bundledDocuments` | all ten formats, EPUB chapter order, headers/footers, malformed and encrypted input, Windows PDF asset paths |
| Documentation | `documentationIndex`, `documentationExplorer` | heading parsing (40,000 headings), scan limits, navigation, listening |
| Listening workspace | `listeningWorkspace`, `projectListening`, `localAssistant` | queue, tour, progress, pronunciation, corrections, model runner (mocked) |
| Templates | `jinjaTemplate`, `jinjaExampleGenerator`, `outputImport` | every bundled template byte-for-byte against fixtures, md → yaml → md → yaml round trip, example inference, import for each format |
| Codebase map | `codebaseMap` | scan protocol and ids, exclusions, submodules, open/reveal, path safety, storage limits, stale detection, panel restore, extension list parity |

### Browser tests (optional)

`tests/*.browser.js` load the real webviews in headless Chromium under their
content security policy: the reader controls, the mind map, the listening
workspace and the editor toolbar. They need Playwright on `NODE_PATH` and a
Chromium executable (`CHROMIUM_EXECUTABLE`), and are not part of `npm test`.

```sh
NODE_PATH=/path/to/node_modules node tests/readerControls.browser.js
```

### Package checks

`npm run test:package` verifies the prepared voices and runtimes against their
manifests. `npm run vscode:prepublish` runs the same checks plus the document
parser check before bundling, so an incomplete package cannot be built.

## Validation records

Results of hands-on validation are kept in
[Validation records](validation/index.md):

- [Piper 0.10 validation](validation/piper_0_10.md) and
  [0.9](validation/piper_0_9.md)
- `native_voices_0_10.json`: synthesis timing per voice (charted in
  [Speech pipeline](../theory_of_operation/speech_pipeline.md#4-piper))
- `windows_imports_0_10.json`: DLL import closure of the Windows engine
- `runtime_manifest_0_10.json`, `voice_synthesis_linux.json`

## Not yet verified

Be explicit about these when you rely on the extension:

- [ ] Speech playback on a Windows desktop (the binaries' DLL imports were
      audited, but playback was not run).
- [ ] `build.bat` on Windows.
- [ ] Keyboard, media keys and the reader in a real VS Code window on each
      platform.
- [ ] Tasks with blind users and NVDA or other screen readers.
- [ ] Microsoft Word opening the generated DOCX tables.
