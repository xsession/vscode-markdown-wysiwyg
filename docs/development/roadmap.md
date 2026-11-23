# Roadmap

Open ideas for the WYSIWYG editor, carried over from the original project
notes. None of them is scheduled; each line links the upstream issue or
guide that a fix would build on. How the editor works today is described in
[WYSIWYG editor](../theory_of_operation/wysiwyg_editor.md) and the overall
module layout in [Architecture](../theory_of_operation/architecture.md).

## Editor backlog

- Add autolink to CKE editor
- Sync scroll position (to plain editor and to markdown preview)
  - Do it like this [https://stackoverflow.com/questions/54556208/scroll-to-marker-in-ckeditor-5](https://stackoverflow.com/questions/54556208/scroll-to-marker-in-ckeditor-5)
  - And need this for importing that function [https://stackoverflow.com/questions/61307979/how-to-import-npm-packages-in-vs-code-webview-extension-development](https://stackoverflow.com/questions/61307979/how-to-import-npm-packages-in-vs-code-webview-extension-development)
- Remove breadcrumb
  - [https://github.com/microsoft/vscode-extension-samples/issues/369#issuecomment-754231994](https://github.com/microsoft/vscode-extension-samples/issues/369#issuecomment-754231994)
  - [https://vscode-dev-community.slack.com/archives/C74CB59NE/p1644800862386389](https://vscode-dev-community.slack.com/archives/C74CB59NE/p1644800862386389)
- Add code formatting
  - [https://github.com/ckeditor/ckeditor5/issues/1354](https://github.com/ckeditor/ckeditor5/issues/1354)
  - [https://github.com/ckeditor/ckeditor5/issues/6309](https://github.com/ckeditor/ckeditor5/issues/6309)
  - [https://github.com/ckeditor/ckeditor5/issues/436](https://github.com/ckeditor/ckeditor5/issues/436)
  - [https://github.com/ckeditor/ckeditor5/issues/5769](https://github.com/ckeditor/ckeditor5/issues/5769)
  - I couldnt get this working without errors
    - [https://github.com/regischen/CKEditor5-CodeBlock-With-Syntax-Highlight](https://github.com/regischen/CKEditor5-CodeBlock-With-Syntax-Highlight)
- Support pasting clipboard images like [https://github.com/telesoho/vscode-markdown-paste-image](https://github.com/telesoho/vscode-markdown-paste-image)
  - Will need this [https://ckeditor.com/docs/ckeditor5/latest/framework/guides/deep-dive/upload-adapter.html](https://ckeditor.com/docs/ckeditor5/latest/framework/guides/deep-dive/upload-adapter.html)
  - [https://vscode-dev-community.slack.com/archives/C74CB59NE/p1647204814315079](https://vscode-dev-community.slack.com/archives/C74CB59NE/p1647204814315079)
- Support DocumentSymbolProvider so that the outline and breadcrumb views aren't blank
  - [https://stackoverflow.com/a/59132169/3620725](https://stackoverflow.com/a/59132169/3620725)
  - Need this upstream issue completed first: [https://github.com/microsoft/vscode/issues/97095](https://github.com/microsoft/vscode/issues/97095)
- Support extended HTML features [https://ckeditor.com/docs/ckeditor5/latest/features/markdown.html#extending-formatting-support](https://ckeditor.com/docs/ckeditor5/latest/features/markdown.html#extending-formatting-support)
- Figure out how to toggle between editors without saving and without showing a popup prompt
  - [https://github.com/microsoft/vscode/issues/169921](https://github.com/microsoft/vscode/issues/169921)
- Improve support for keyboard shortcuts, eg. the shortcut should automatically appear in brackets when hovering the toolbar button
  - [https://ckeditor.com/docs/ckeditor5/latest/framework/guides/plugins/abbreviation-plugin/abbreviation-plugin-level-1.html](https://ckeditor.com/docs/ckeditor5/latest/framework/guides/plugins/abbreviation-plugin/abbreviation-plugin-level-1.html)
  - How does it work for built in shortcuts?  [https://github.com/ckeditor/ckeditor5/blob/7dea975058cfa1bd0c6b6b42a96187c3706547d9/packages/ckeditor5-basic-styles/src/bold/boldui.ts#L41](https://github.com/ckeditor/ckeditor5/blob/7dea975058cfa1bd0c6b6b42a96187c3706547d9/packages/ckeditor5-basic-styles/src/bold/boldui.ts#L41)
- Fix the following markdown not being shown as bullets

```
- one

- two
- three
```

- Don't clear undo history on save
