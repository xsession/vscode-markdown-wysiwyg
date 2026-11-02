# Markdown Editor with an offline listening workspace

View/edit Markdown in the existing CKEditor WYSIWYG editor, or consume a long
Markdown document through Piper speech with structural navigation.

## Install the full 0.10.0 VSIX

Use **Extensions → … → Install from VSIX**, then open a Markdown file and run
**Read Markdown Aloud (Piper)**. Playback starts when the panel is ready. The
shortcut is **Ctrl+Alt+Shift+R** (macOS custom-runtime users: Cmd+Alt+Shift+R).
The source editor also supports **Read Markdown Selection (Piper)**.

The full VSIX includes the following for **Windows x64 and Linux x64**:

- Native Piper executable, phonemizer, ONNX Runtime and eSpeak voice data.
- Windows application-local Microsoft C++ runtime DLLs.
- Six complete ONNX models with matching configurations and model cards.
- The extension/editor JavaScript dependencies, licenses and source archives
  required for the included copyleft runtime components.

**No Python, pip, runtime installer, voice download or internet connection is
needed to play the six bundled voices.** VS Code and a compatible normal OS
installation are prerequisites. Linux needs its usual glibc/libstdc++ baseline;
Windows uses Windows 10/11 system DLLs. macOS, ARM and other targets are not
included in this package; a custom Piper executable is required there.

| English (US) | Hungarian |
| --- | --- |
| LJSpeech | Anna |
| John | Berta |
| Kristin | Imre |

The default voice is English LJSpeech. In **Voices and offline engine**, choose
Hungarian / Magyar or search by name, then **Use / Download voice**. Installed
voices work immediately. Turn off Installed voices only to browse the wider
catalog snapshot; optional extra voices need network access. Extra downloads
use Node's HTTPS client, not Python, and verify catalog size/checksum. Corporate
proxies may require network configuration. The catalog is a bundled snapshot,
not a continuously refreshed service.

Existing custom `executable`, `arguments` and `modelPath` settings are respected.
Set `markdownEditor.piper.executable` to `auto` to use the included engine, and
select an included voice to clear a legacy custom model path.

## Listen to large documents with context

- Use **Headings only** to hear the document's structure, then choose an outline
  entry and **Read from heading** to switch to continuous reading there.
- Jump by sentence or heading, repeat the current sentence, or go back/forward
  ten seconds. Time jumps within a sentence are precise; a jump crossing a
  segment boundary moves to the adjacent segment instead.
- **Where am I?** speaks the document, heading path, progress and an approximate
  remaining-time estimate. It preserves the current location and pauses reading;
  press Read to continue.
- Search within the document, inspect a result, then **Return from jump**.
- Bookmark passages you want to revisit. Bookmarks and approximate playback
  position persist locally across reopening an unchanged document. Edited
  documents reset saved locations/bookmarks instead of applying stale anchors.
- **Pause after each paragraph for recall** lets you explain the main point
  before continuing. It does not score your answer or generate a summary.
- Adjust playback from 0.5 to 4 times normal with pitch preservation. Choose the
  rate at which you can still explain what you heard; high speed is optional.
- Use the sleep timer for a bounded session. Where exposed by the host,
  media-session handlers support headset/media controls.

The native engine keeps one model loaded and synthesizes the next segment while
current audio plays. Only a small working set of audio is retained in memory;
it does not pre-generate an entire book. Synthesis errors, navigation, stop and
closing the reader invalidate stale results. A speech task times out after
120 seconds, and temporary WAV files are cleaned up.

The outline is the author's structure, not an AI-generated summary. Tables are
spoken with column labels. Image alt text is retained. Skipped code is explicitly
announced; enable Read Code Blocks in settings to include it. Complex Markdown,
HTML, mathematics and code punctuation are not a complete semantic accessibility
implementation. Raw mathematical notation is not equivalent to accessible math.

Run **Listen to the Long-Document Reading Guide (Piper)**, or use the reader's
**Listen to the research and listening guide** button, to hear the included
[research and practical method](docs/research/listening-large-documents.md).

## Keyboard use

Within the reader, Tab and Shift+Tab reach the native labelled controls.

| Shortcut | Action |
| --- | --- |
| Alt+Shift+P | Play / pause |
| Alt+Shift+Left / Right | Previous / next sentence |
| Alt+Shift+Up / Down | Previous / next heading |
| Alt+Shift+R | Repeat current sentence |
| Alt+Shift+B | Save bookmark and speak confirmation |
| Alt+Shift+L | Speak current location |

The modifier shortcuts avoid claiming unmodified screen-reader browse keys.
Actual assistive-technology compatibility still requires user testing. This is
an auditory document reader, not a replacement for an operating-system screen
reader such as NVDA.

## Existing WYSIWYG editor

- Edit Markdown in a single CKEditor-based tab, including tables, images, links
  and snippets.
- Use Ctrl+Shift+E to toggle WYSIWYG/plain text.
- The editor uses VS Code theme colors and supports rich-text paste.

## Test a source checkout (Windows or Linux)

```sh
npm ci
npm test
```

Unit tests create temporary model/runtime fixtures and mock process execution.
They do not require downloaded voices, native runtimes, Python or network access.
The source ZIP intentionally excludes those large binary assets. A passing unit
suite does not verify real speech synthesis or the contents of the installer.

To verify the complete offline assets after preparing them, run:

```sh
npm run test:package
```

For playback without building, install the full offline VSIX. Extracting that
VSIX's `extension/resources/runtime` and `extension/resources/voices` directories
into a source checkout's `resources` directory also supplies its real assets.

## Build the full offline package

Build on Linux x64/WSL with Node 22 and Python 3.12+. Python and a downloaded
7-Zip binary are **build tools only**, never playback dependencies.

```sh
npm ci
python scripts/bundle_voices.py
python scripts/bundle_runtime.py
npm test
python -m unittest discover -s tests -p '*_test.py'
npm run vscode:prepublish
npx @vscode/vsce package --no-dependencies
```

The builders verify pinned runtime archive hashes and upstream model checksums.
If Microsoft's moving redistributable URL changes, the builder stops for a hash
review instead of accepting the new binary silently. Models and platform
binaries are excluded from git; rebuild scripts and source notices describe how
to reconstruct the full package. The production prepublish check fails if a
required voice/runtime file is missing or corrupted.

Runtime dependencies are from the official native Piper **2023.11.14-2** release.
This is distinct from Python Piper 1.8.0 used by extension version 0.9. The older
native backend provides portable deployment and persistent JSON-input synthesis.
See [runtime notices](THIRD_PARTY_RUNTIME.md) and
[voice provenance](THIRD_PARTY_VOICES.md).

## Validation and limits

Automated checks cover a 40,000-sentence document, structural navigation, saved
state, cancellation, native worker reuse, model integrity and platform selection
without Python. All six voices generated real audio using the included Linux
engine; follow-up short passages synthesized in approximately 0.5–0.8 seconds
in that test, not a general latency guarantee.

Windows PE imports were audited to confirm bundled non-OS dependencies, but
Windows desktop playback is not yet verified. Real VS Code-host rendering,
speaker output, headset behavior and blind-user/NVDA workflows need platform
acceptance tests. See [validation evidence](docs/validation/piper-0.10.md).

Workspace trust is required to execute Piper. Markdown is passed as data without
a shell. Document text is not sent to a speech service or an LLM. Optional voice
downloads and opening upstream license links require internet; built-in playback
does not.

## Project documentation explorer (0.11.0)

Open a project folder, then expand **Documentation contents** in VS Code's Explorer.
The tree groups `.md`, `.markdown`, and `.mdown` files by workspace/folder and nests their headings. Click a heading to open its source line. Use the inline **Listen from documentation section** action to read from that heading onward with Piper.

Run **Markdown Editor: Open documentation mind map** from the Command Palette or use the tree title's mind-map icon. The map supports wheel zoom, background drag, zoom buttons, Fit, branch collapse/expand, level presets, and filename/heading search. Click a label to open it, or its play button to listen. Tab/Enter access the controls; the native Explorer tree provides standard keyboard tree navigation. Map position and collapsed branches survive webview reloads.

Indexing refreshes automatically after Markdown edits and file/workspace changes; Refresh forces a rescan. The default limits are 2,000 files and 2 MiB per file. Configure `markdownEditor.documentation.maxFiles`, `maxFileBytes`, and `exclude` to adjust them. Oversized/unreadable files and file-limit truncation are reported. The map renders at most 3,000 nodes at once and reports truncation: use search or fewer levels for larger projects. The sidebar retains the complete indexed tree. Only Markdown files are mapped; PDF, Word, external links, and semantic/AI topic inference are not indexed.

The source distribution intentionally excludes voice/runtime binaries. `npm ci`, `npm test`, and `npm run webpack` work without them. For a new fully offline VSIX, restore the six voice packs and native runtimes using the existing bundling scripts, then run `npm run test:package` and the normal packaging pipeline. `media/` is included in VSIX packaging.

## One-click Windows offline build

Install Node.js 22.13 or newer, then double-click `build.bat`. It installs npm dependencies, runs tests, prepares offline assets, verifies them, builds and packages `artifacts/markdown-listening-offline.vsix`. Internet is required for npm and any missing asset downloads.

The easiest way to reuse your previously downloaded voices and runtimes is:

```powershell
.\build.bat "$env:USERPROFILE\Downloads\markdown-wysiwyg-0.10.0-offline.vsix"
```

If assets are absent, the BAT uses the default WSL distribution with Python 3.12+ to run the existing Linux bundler. Windows Python alone cannot rebuild that runtime bundle. Install/configure WSL first or provide the existing offline VSIX. The script stops on errors and pauses so the result is visible when double-clicked. Set `CI=1` to suppress the pause in automation. `build.bat --help` shows usage.

The Windows BAT/PowerShell automation was reviewed in a Linux environment; execution on Windows remains unverified.

### Windows build fix

`build.bat` no longer requires WSL or virtualization. Missing assets are downloaded using Windows Python 3.12+ and 7-Zip; missing build tools are installed with Windows Package Manager (`winget`) when available. Installation can request Windows administrator approval. If winget is unavailable, install Python 3.12+ and 7-Zip manually and rerun. Existing offline VSIX import remains supported. Earlier WSL instructions are superseded by this workflow. Windows execution still needs verification; portable extraction has been tested on Linux.

## 0.11.1 — legacy Piper executable setting

Earlier versions could retain `markdownEditor.piper.executable` as `piper`. On machines without a PATH-installed Piper, this produced `spawn piper ENOENT` even when the offline engine was included. Empty/auto settings and bare `piper`/`piper.exe` with no custom arguments now select the bundled engine. Explicit executable paths and custom argument configurations remain supported.

Immediate workaround in the installed 0.11.0: set `markdownEditor.piper.executable` to `auto` in VS Code User Settings JSON (also check Remote Settings when applicable), then run Developer: Reload Window and retry Read. If an old Python configuration was used, clear `markdownEditor.piper.arguments` to `[]`. The bundled engine ignores custom arguments.

Regression tests mock both Windows/Linux runtime selection; actual Windows playback still needs verification.

## 0.12.0 — ten formats, visible mind-map icons and skip controls

See [document format support and build instructions](docs/DOCUMENT-FORMATS.md). This release adds a documentation Activity Bar icon, editor toolbar icon, status-bar button and a **Mind map** button in Piper. Imports cover Markdown, text, HTML, PDF, DOCX, ODT, EPUB, RTF, reStructuredText and AsciiDoc. The reader has four independent skip controls for code, URLs, running headers and running footers. Binary imports open as extracted read-only text when navigating their outline. Requires VS Code 1.105+.

The source ZIP intentionally excludes voice/native Piper binaries; use `build.bat` (optionally passing the previously installed offline VSIX to reuse its assets). Parser dependencies are installed through `npm ci` and packaged with the extension. The older WSL-only build instructions above are superseded by the native Windows BAT workflow. See `docs/DOCUMENT-FORMATS.md` for extraction limits and format-specific limitations.

## 0.13.0 — offline project listening and bundled local AI

Install the complete offline VSIX for bundled Piper, all six voices, Qwen3-0.6B Q4_K_M and local Windows/Linux CPU runtimes. No first-use model download or external AI server is required. The small source archive is for rebuilding and excludes these large binaries.

See [Listening workspace guide](docs/LISTENING-WORKSPACE.md) for queue/tour workflows, synchronized text, saved progress, source corrections, map links/progress, pronunciation, English/Hungarian voice switching, focus mode, diagnostics, global shortcuts and source-linked local AI. The small model can be wrong; generated answers remain clearly separate from source text. Windows desktop audio still needs verification.

## 0.13.1 — Windows PDF paths and dependency fixes

See PATCH-0.13.1.md. PDF asset paths now use forward-slash endings on Windows. Compatible dependency updates remove the 18 reported npm audit findings at the time of verification.
