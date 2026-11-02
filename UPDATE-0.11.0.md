# Documentation explorer — 0.11.0

This complete source project includes the 0.10.0 Windows/source-only test fix and the new project documentation explorer.

1. Extract this archive and open `markdown-listening` in VS Code.
2. Run `npm ci`, `npm test`, and `npm run webpack`.
3. Press F5 to launch the extension development host (use the bundled launch configuration).
4. Open a project folder. In Explorer expand **Documentation contents**.
5. Run **Markdown Editor: Open documentation mind map**.

The new sidebar maps Markdown files into folders and heading levels. The mind map supports pan, zoom, collapse/expand, level presets, search, source navigation, and section listening. Index updates include unsaved Markdown changes.

For normal installation, build a VSIX using the existing offline-asset workflow described in README. This is a source archive: voice models and native Piper runtimes are excluded, as in the previous source ZIP. They are not downloaded by `npm ci`. Keep the previous offline VSIX for its bundled audio dependencies.

Verification: TypeScript compilation; all existing reader/voice fixture tests; documentation parser tests (including 40,000 headings); mocked VS Code scan/navigation/listening tests; webpack build. Webpack emits existing Prettier dynamic-dependency warnings. A Playwright browser-control test is included as an optional check but was not executed successfully here because Chromium is absent. Native VS Code visual checks and Windows playback remain unverified.
