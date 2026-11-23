# Codebase map

The codebase map draws a project's source code as a landscape, so you can learn its structure the way you learn a place:

- **Islands** are top-level folders; the sea between them marks module boundaries.
- **Hills** are files. Height shows lines of code, or optionally how many files depend on it.
- **Roads** are imports. Highways bundle the imports between regions.
- **Towers** mark the most-imported files and **stars** mark entry points (`main`, `index`, `app`, `server`, `cli`, …).

The layout is computed only from the folder tree and file sizes, with no randomness. The same project always produces the same map, so locations stay familiar from one session to the next.

## Open the map

- Command Palette: **Markdown Editor: Open Codebase Map**.
- The landscape icon in the **Documentation contents** view title bar.
- Right-click a folder in the Explorer and choose **Open Codebase Map** to map only that folder. Choosing it on a file maps the file's folder.

The map opens in the active editor group and covers every folder of the workspace. The toolbar at the top of the side panel can refresh the map, map another folder, map the whole workspace again, or show the built-in sample project.

The panel is restored after a window reload and maps the same folder again.

## Navigate

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Pan | Drag the map | Arrow keys (map focused) |
| Zoom | Scroll, or the + / − buttons | `+` / `-` |
| Show everything | ⌂ button | — |
| Jump | Click the overview in the corner | — |
| Select a file | Click its hill, or use **Go to file…** | Type in **Go to file…**, Enter |
| Open the selected file | **Open file**, or double-click the selected hill | — |

Zoomed out, the map shows regions and highways (survey view); zoomed in, it names every file (street view). The selected file's outgoing imports are drawn in magenta, incoming ones in teal.

## Modes

**Explore** shows the selected file's language, size, region and repository, the files it imports, the files that import it, and the external packages it uses. **Reveal in Explorer** shows it in the file tree.

**Route** gives step-by-step directions between two files along import edges, with compass bearings and the regions and repositories crossed. Pick the start and destination by clicking the boxes and then the map or a search result. Direct import chains are preferred; when none exists, the route may also follow edges backwards, and those steps are marked.

**Walk** is a fixed tour of the landmarks: it starts at the main entry point and moves to the nearest next landmark each time. Repeating the same walk helps you remember the architecture as a route.

**Runtime** overlays a CPU profile recorded while the program ran. Hills glow with the time spent in them, moving dots show calls, and dashed *desire paths* mark runtime calls between files that have no static import (callbacks, events, interfaces, reflection). A timeline lets you play or scrub through the run. Supported formats:

- [speedscope](https://www.speedscope.app/) JSON
- Chrome / Node.js `.cpuprofile`
- Folded stacks (`.folded`, `.collapsed` or `.txt`, as produced by `stackcollapse` scripts and many profilers)

Load a profile with **Open a trace** or by dropping the file on the map. Frames are matched to files by path, then by function name.

## Display options

- **Fog of war** hides everything you have not visited yet. Landmarks stay visible.
- **Show git submodules as territories** draws each submodule with a purple dashed border; nested submodules are tinted deeper. The side panel lists the repositories and the imports that cross between them.
- **Height represents** switches between lines of code and number of dependents.

Your trail and visited files are remembered per workspace.

## What is read

Files with these extensions are mapped: JavaScript and TypeScript (including JSX/TSX, Vue and Svelte), Python, Go, Rust, Java, Kotlin, Scala, C#, C and C++, Objective-C, Swift, Ruby, PHP, Dart, Lua, Elixir, Erlang, Haskell, Clojure, Julia, R, shell and PowerShell, SQL, CSS/SCSS/Less, HTML, Markdown and reStructuredText, JSON, YAML, TOML, XML, Gradle, Protocol Buffers, GraphQL, Terraform, and Renode platform (`.repl`), script (`.resc`) and Robot test files.

Imports are recognised by pattern for JavaScript/TypeScript, Python, Go, Rust (`mod` and `crate::`/`super::` paths), Java/Kotlin/Scala, C# (namespaces and type references), C/C++ (`#include "…"`), Ruby, PHP, Dart, Lua, CSS, HTML and Renode. Relative paths, path aliases such as `@/` and `~/`, package-style paths and index files are resolved. Imports of third-party packages are listed under the file but are not drawn. Other languages appear as hills without roads.

These are never mapped:

- Dependency and build folders: `node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `.venv`, `__pycache__`, `.next`, `.git` and similar.
- Lock files, minified files and source maps.
- Anything matched by your `files.exclude` setting or by `markdownEditor.codebaseMap.exclude`.

Everything is read and analysed locally. No file content leaves VS Code and the map makes no network requests. (The links under *About this map* open in your browser only when you click them.)

## Keep it current

When source files are created, changed or deleted, the side panel shows **Files changed since this map was drawn** with a **Refresh** button. You can also run **Markdown Editor: Refresh Codebase Map** at any time. The map is not redrawn automatically, so it does not move while you are reading it.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `markdownEditor.codebaseMap.maxFiles` | `12000` | Maximum number of files drawn (100–50,000). Files beyond the limit are left out in path order, and the panel says how many. |
| `markdownEditor.codebaseMap.maxFileBytes` | `1500000` | Files larger than this are skipped; very large files are usually generated or bundled. |
| `markdownEditor.codebaseMap.exclude` | `[]` | Extra glob patterns to leave out, for example `**/generated/**` or `**/fixtures`. |

## Limits

- Import detection is pattern-based, not a compiler. Dynamic imports built from variables, dependency injection and reflection are not seen as roads; a runtime profile shows them as desire paths.
- Very large repositories take longer to read and draw. Lower `maxFiles` or add `exclude` patterns to focus on the part you are studying, or map a single folder from the Explorer.
- Multi-root workspaces are drawn as one map. Paths start with the root folder's name; two roots with the same name are told apart as `name` and `name (2)`.
