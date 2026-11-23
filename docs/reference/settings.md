# Settings

Open **File → Preferences → Settings** and search for `markdownEditor`, or
edit `settings.json` directly.

## Speech

| Setting | Default | Description |
| --- | --- | --- |
| `markdownEditor.piper.executable` | `"auto"` | `auto` uses the bundled native engine (Windows x64, Linux x64). Set a path to use your own Piper executable. A bare `piper` or `piper.exe` with no arguments is treated as `auto`. Machine scope. |
| `markdownEditor.piper.arguments` | `[]` | Arguments placed before Piper's options, for a custom executable only. For Python Piper use `["-m", "piper"]`. Ignored by the bundled engine. Machine scope. |
| `markdownEditor.piper.modelPath` | `""` | Absolute path to a `voice.onnx` file; `voice.onnx.json` must be next to it. Selecting a bundled voice clears it. Machine scope. |
| `markdownEditor.piper.skipCode` | `true` | Skip code blocks and inline code. |
| `markdownEditor.piper.skipUrls` | `true` | Skip URL addresses; link text is still read. |
| `markdownEditor.piper.skipHeaders` | `true` | Skip detected running page headers (not section headings). |
| `markdownEditor.piper.skipFooters` | `true` | Skip detected running page footers. |
| `markdownEditor.piper.readCodeBlocks` | `false` | **Deprecated.** Use `skipCode`. |

The four *skip* settings are defaults. The reader's **Skip while listening**
checkboxes store per-workspace overrides that take precedence.

## Documentation index

| Setting | Default | Description |
| --- | --- | --- |
| `markdownEditor.documentation.exclude` | `**/{node_modules,.git,dist,out,build,.venv,vendor}/**` | Glob of paths not indexed. |
| `markdownEditor.documentation.maxFiles` | `2000` | Maximum documents indexed per workspace (1–10,000). |
| `markdownEditor.documentation.maxFileBytes` | `33554432` (32 MiB) | Larger documents are skipped and reported. |

## Codebase map

| Setting | Default | Description |
| --- | --- | --- |
| `markdownEditor.codebaseMap.maxFiles` | `12000` | Maximum files drawn (100–50,000). Files beyond the limit are left out in path order, and the panel says how many. |
| `markdownEditor.codebaseMap.maxFileBytes` | `1500000` | Larger files are left out; they are usually generated or bundled. |
| `markdownEditor.codebaseMap.exclude` | `[]` | Extra glob patterns to leave out, such as `**/generated/**`. Applied in addition to `files.exclude` and build folders. |

## Templates

| Setting | Default | Description |
| --- | --- | --- |
| `markdownEditor.outputFolder` | `""` | Where **Generate** writes. Absolute, or relative to the workspace root. Empty means next to the Jinja template, or the table mapping's `output` path. Set it with the toolbar's **Output folder** button. |

## Example

```json
{
  "markdownEditor.piper.executable": "auto",
  "markdownEditor.piper.skipCode": false,
  "markdownEditor.documentation.exclude": "**/{node_modules,.git,dist,out,build,.venv,vendor,third_party}/**",
  "markdownEditor.codebaseMap.exclude": ["**/generated/**", "**/fixtures"],
  "markdownEditor.outputFolder": "build/generated"
}
```
