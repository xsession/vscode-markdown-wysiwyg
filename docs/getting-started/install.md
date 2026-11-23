# Install

The extension is distributed in two forms. Choose by what you need to do.

| | Full offline VSIX | Source checkout |
| --- | --- | --- |
| Purpose | Daily use | Development and rebuilding |
| Piper engine and six voices | Included | Not included (rebuilt by `build.bat` or the bundling scripts) |
| Network needed to use speech | No | — |
| Size | Large | Small |

## Requirements

- **VS Code 1.105 or newer.**
- **Speech:** Windows x64 (Windows 10/11) or Linux x64 with the usual
  glibc/libstdc++ baseline. On macOS or ARM, the editor, maps and templates
  work, but speech needs your own Piper executable (see
  [Settings](../reference/settings.md#speech)).
- **Workspace trust.** Piper is only executed in a trusted workspace.

No Python, pip, runtime installer, voice download or internet connection is
needed to use the bundled voices.

## Install the offline VSIX

1. In VS Code open **Extensions**, click **…** and choose **Install from
   VSIX…**.
2. Select the `.vsix` file, for example
   `artifacts/markdown-listening-offline.vsix`.
3. Run **Developer: Reload Window**.

To check that speech works, open a Markdown file and run **Read document aloud
(Piper)** (++ctrl+alt+shift+r++). In the reader, **Run diagnostics** checks the
engine and voices, and **Test speaker** plays a sentence.

## Build it yourself

On Windows, install Node.js 22.13 or newer and double-click `build.bat`. To
reuse the voices and runtimes from an earlier offline package, pass it:

```powershell
.\build.bat "$env:USERPROFILE\Downloads\markdown-wysiwyg-offline.vsix"
```

The result is `artifacts\markdown-listening-offline.vsix`. Linux steps, and
what the build verifies, are in [Build from source](../development/build.md).

## Upgrading from an older version

!!! warning "`spawn piper ENOENT` after upgrading"
    Versions before 0.11.1 could save `markdownEditor.piper.executable` as
    `piper`. If speech fails with `spawn piper ENOENT`, set it to `auto` in
    your user settings (and in remote settings, if you use them), clear
    `markdownEditor.piper.arguments` to `[]`, and reload the window. Current
    versions treat a bare `piper` with no custom arguments as `auto`.

Saved reading positions, bookmarks and queues are stored per workspace and
survive upgrades.
