# Theory of operation

These pages explain how each feature works inside: which component does what,
which messages pass between them, which algorithms decide what you see, and
where the limits come from. Read them when a behaviour surprises you, when you
need to judge whether a feature fits a task, or before changing the code.

| Page | Covers |
| --- | --- |
| [Architecture](architecture.md) | the processes, webviews and modules, and how they talk |
| [WYSIWYG editor](wysiwyg_editor.md) | the custom text editor, the CKEditor build and document synchronization |
| [Speech pipeline](speech_pipeline.md) | from Markdown to segments to Piper audio, look-ahead and cancellation |
| [Document import](document_import.md) | how ten formats become a source-linked text view |
| [Documentation index and mind map](documentation_index.md) | indexing, caching and drawing the documentation map |
| [Listening workspace](listening_workspace.md) | queues, tours, progress, pronunciation, corrections and the local AI path |
| [Codebase map](codebase_map.md) | scanning, import detection, layout, terrain, routes and runtime traces |
| [Templates and synchronization](templates.md) | the Jinja engine, example-based templates, table mappings and two-way sync |
| [Security and privacy](security_privacy.md) | trust, content security policy, what is executed and what never leaves the machine |
