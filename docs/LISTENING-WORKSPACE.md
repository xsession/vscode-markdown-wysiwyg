# Offline project listening workspace — 0.13.0

## Install

Install the **complete offline VSIX** through Extensions → … → Install from VSIX, then reload VS Code. Windows x64 and Linux x64 Piper engines, six voices, the quantized local model, local-AI CPU runtimes, parser packages, notices and PDF resources are included. No Python, pip, model server, API key or first-use model download is required to use this installer. The source ZIP is a separate developer distribution and deliberately omits the large binaries; `build.bat` restores them at build time.

Requires VS Code 1.105+. Supported native platforms: Windows x64; Linux x64 with the ordinary C++/OpenMP/OpenSSL 3 system libraries needed by the supplied Ubuntu runtime. Windows C++ redistributable DLLs are included. Linux speech and model inference were executed in validation; Windows binaries were audited for imported DLLs, but Windows speaker playback is still unverified.

Open a folder, then use the **Documentation** Activity Bar icon, the editor's mind-map icon, or the **Mind map** status-bar button. **Open document…** in Piper accepts the ten format families described in DOCUMENT-FORMATS.md.

## Daily listening workflow

1. Open a document and run Read aloud. In the Piper panel, run **Run diagnostics** and **Test speaker** if this is the first session.
2. Add documents, a folder or the indexed project to **Listening queue**. Items can be reordered, removed, or selected directly. **Start / Resume queue** resumes saved positions. Automatic continuation moves from a completed item to the next queue entry; disable its checkbox for manual control.
3. Use **Build guided project tour** to build a new queue of relevant documents (replacing the current queue order). Without a topic, the local ordering favors README/overview, architecture/design, setup, then examples. With a topic, relevant documents rank first and overview context is retained. This is an editable, deterministic suggestion, not an inferred guarantee that every prerequisite is covered.
4. The current sentence is highlighted in the nearby-passage list. Click a passage to begin there. **Show synchronized source** opens the source or a read-only extracted view; **Follow source text** highlights and follows the corresponding line in a visible source editor. WYSIWYG canvases are not decorated. PDF/table/figure/reference navigation is available in Document outline.
5. Bookmark difficult parts. **Return from jump** returns within the document; if that history is empty, it returns across documents. **Return to previous document** is explicitly cross-document. Position, elapsed passage time, bookmarks, queue, completed-end markers, pronunciation, corrections and focus settings are saved per workspace.
6. Enable **Focus mode** to keep the current spoken passage, Continue, Pause, Replay and Bookmark controls visible while hiding most secondary controls. The checkbox in the header remains available to exit focus mode.

“Heard” progress counts passages whose audio reported playback completion, not every skipped-over sentence. “Reached end” means the document reached its end and does not imply that every passage was heard. Changed document fingerprints reset stale progress. Only a limited nearby transcript is rendered, rather than thousands of sentence buttons at once.

## Pronunciation and language

English, Hungarian and automatic modes use bundled LJSpeech/Anna voices; **Use selected voice** respects the existing voice picker. Automatic English/Hungarian detection is a local text heuristic and can misclassify short/mixed technical passages. Use a forced language where precision matters.

Pronunciation rules are literal whole-token substitutions used for speech synthesis; displayed source text is unchanged. More specific language rules override `any` for the same term. Maximum 1,000 rules:

```json
[
  {"term":"GPIO","say":"G P I O","language":"en"},
  {"term":"GPIO","say":"gé pé í ó","language":"hu"},
  {"term":"STM32","say":"S T M thirty two","language":"en"},
  {"term":"CANopen","say":"can open","language":"en"}
]
```

This dictionary provides manual engineering pronunciation; it does not interpret arbitrary equations or derive unit semantics automatically.

## Correct extracted structure

Expand **Correct extracted structure** to edit the extracted Markdown representation. Fix heading markers, code fences, table delimiters, PDF reading order, or `:::reader-header` / `:::reader-footer` regions. Corrections are overlays in this workspace; the original file is unchanged. They are ignored if the original extraction changes. Reset returns to the original import. Corrections are limited to 200,000 characters; split larger documents first. Existing code/URL/header/footer skip options still apply to corrected text.

## Mind map

The map now shows:

- Folder/file/section hierarchy and current file/section highlighting.
- Actual relative document links as dashed link nodes. External website links are not fetched.
- Per-file heard progress, reached-end markers and bookmark counts.
- A focus-branch button (◎) and All branches to return.
- Existing zoom, pan, search, level presets and collapse/expand controls.

Indexing reuses parsed content until file size/mtime or an open document's version changes. Save/file/workspace changes still refresh the index. The map keeps its 3,000-visible-node limit; a 40,000-heading document is covered by parser tests. Relationship links come from explicit document links, not model-inferred relationships.

## Offline AI assistant

Included model: **Qwen3-0.6B, Q4_K_M**, converted GGUF from Unsloth, pinned to repository commit `50968a4468ef4233ed78cd7c3de230dd1d61a56b`. Weights: **396,705,472 bytes** (378.3 MiB). Original/quantized model license: Apache-2.0. The local inference engine is llama.cpp CPU release `b12002` with Windows/Linux runtimes, MIT notices, corresponding source and required Windows runtime DLLs.

The model is loaded in a separate local process only when requested and released afterward. Requests are limited to a small retrieved context and 256 new tokens, 4,096 context tokens, at most four CPU threads and a three-minute timeout. Initial integrity checks hash the local model. There is no HTTP server and no inference-time download. Default AI asset paths come only from the installed extension, not workspace-provided executables.

Choose Explain, Summarize, Find stated dependencies or Answer a question. The current passage and a small set of lexically relevant project passages are supplied to the model. The result lists source IDs, titles, line numbers and exact retrieved excerpts. **Open source** navigates back; **Listen to generated answer** explicitly reads the generated text. Cancel stops the worker, including requests waiting for initialization. The model has no shell/filesystem/network tools.

**Limits:** This is a very small model. It can hallucinate, misunderstand technical requirements, omit dependencies or respond poorly in Hungarian. Source links show what was provided, not proof that every generated claim is supported. It is not a verification engine or a replacement for engineering review. Retrieval is bounded keyword relevance, not full-book semantic understanding. Summary mode processes the complete current heading section in source-linked chunks (maximum 16 chunks). Larger sections ask you to choose a smaller child heading; they are not silently truncated. Explain/question/dependency modes use bounded retrieved passages and do not claim to analyze an entire book. Document text is treated as untrusted data in the prompt, but prompt following is not guaranteed; no executable tool access is exposed.

## Diagnostics and shortcuts

**Run diagnostics** checks platform/trust, installed voices, bundled Piper execution, real WAV synthesis and local model checksum. **Test speaker** plays a sentence; only the listener can confirm audible output. **Test local model** performs real inference on a known source passage. Error reports provide the failing component and a recovery suggestion.

While a reader is open, VS Code commands/keybindings work outside the reader panel:

| Keys | Action |
| --- | --- |
| Ctrl+Alt+Shift+P | Play/continue |
| Ctrl+Alt+Space | Pause/resume |
| Ctrl+Alt+Shift+S | Stop |
| Ctrl+Alt+Left / Right | Previous/next passage |
| Ctrl+Alt+Shift+Up / Down | Previous/next heading |
| Ctrl+Alt+Shift+B | Bookmark |
| Ctrl+Alt+Shift+L | Audible location |
| Ctrl+Alt+Shift+Backspace | Return from jump |

Reader-local Alt+Shift shortcuts and Media Session play/pause/next/previous support remain available. Operating-system interception and media-key behavior still depend on the desktop environment.

## Rebuild

Run `build.bat` on Windows with Node.js 22.13+. Existing offline VSIX assets can be imported by passing the previous VSIX path. Missing Piper assets/model/runtimes are downloaded and checksum-verified at build time using Python 3.12+; Windows build prerequisites are prepared by the existing native build helper. AI download pins and checksums live in `resources/ai-sources.json`.

For manual Linux packaging:

```sh
npm ci
npm test
python3 scripts/bundle_voices.py
python3 scripts/bundle_runtime.py
python3 scripts/bundle_ai.py
npm run test:package
npx --yes --package @vscode/vsce@3.6.0 vsce package
```

All runtime assets are included in the final installer. Dependencies and model size make the complete offline VSIX large; the small source ZIP is not the installer.
