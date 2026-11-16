# Upgrade 0.14.0 → 0.15.0

Extract `markdown-listening-0.15.0-patch.zip` into your existing `markdown-listening` source folder, allowing replacement. Then run `build.bat` and install the generated VSIX. Existing offline voice, runtime and local-model assets remain in place.

Use Command Palette → **Markdown Editor: Create table template (10 formats)**. Choose YAML, JSON, TOML, XML, CSV, TSV, INI, env, properties or HTML. Configure the paths and columns, then **Generate output from Markdown (10 formats)**. Saved edits synchronize in both directions.

Existing YAML templates work without changes. The new optional `format` field selects another adapter. Each adapter has a complete example under `examples/table-sync/<format>` with source, template and generated output. Read `TEMPLATE-SYNC.md` for layouts, preservation rules and conflict recovery.

This patch is for 0.14.0 source. Use the complete source archive for a fresh build or another base version. Source-only builds download missing offline assets through the existing build process.

Validation: complete automated test suite, ten-format round trips, save/watcher integration and template-creation commands, production webpack adapter bundle, all ten document imports through the extension bundle, and dependency audit. Windows/VS Code GUI execution was not performed.
