# Version 0.10 validation

Validated on Linux x64, 26 October 2026.

- TypeScript compilation and the production extension bundle passed.
- Structural-index tests cover ATX/Setext headings, sentences, nested heading
  context, code skipping, comments inside code, image descriptions and labelled
  table rows. A 40,000-sentence document retains its segment count and bounded
  segment sizes.
- Reader workflow tests cover navigation, jump-return history, bookmarks,
  orientation speech, search, restart/resume, changed-document reset, starting
  playback from the command, stale playback events, cancellation and trust.
- Persistent-worker tests verify one native process for multiple requests,
  queued output association, WAV validation and cancellation.
- Voice-manager tests verify all six included packs and native runtime selection
  without invoking Python, pip or an installer.
- Real SpeechEngine calls generated two WAVs per bundled voice with the included
  Linux native engine. Measurements are in native-voices-0.10.json. Follow-up
  synthesis was approximately 0.5–0.8 seconds for the short test passages; this is
  not a general performance guarantee.
- DOM checks verified outline/search/bookmark actions, modifier shortcuts,
  pausing during preparation, resumed audio, the research-guide action and
  six installed voice options with Hungarian filtering.
- Windows dependency inspection follows imports from piper.exe through the
  included DLLs. All non-OS imports in that closure are included; see
  windows-imports-0.10.json. This is not a Windows execution test.
- SHA-256 manifests verify native binaries, data, dependency notices and source
  archives. Models/configurations/cards use upstream catalog checksums.

Still required: clean Windows desktop execution, Linux package install in the
actual VS Code extension host, keyboard and media controls under that host, and
real blind-user/NVDA task testing. DOM interaction checks do not prove visual
layout, assistive-technology compatibility or real speaker playback.

The supported built-in targets are Windows x64 and Linux x64. Native execution
still depends on normal OS components (Windows 10/11 system DLLs or a compatible
Linux glibc/libstdc++ baseline) and VS Code. Other architectures/macOS require a
custom runtime and are not claimed to be self-contained by this package.
