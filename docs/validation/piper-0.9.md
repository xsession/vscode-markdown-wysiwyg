# Piper reader 0.9 validation

- TypeScript compile, speech extraction and playback lifecycle tests passed.
- Voice manager tests verified the six bundled voices, default voice resolution
  with no model setting, automatic private runtime setup, sharing one setup
  operation between concurrent reads, voice persistence, path rejection and trust.
- Downloader tests verified checksums, completed-file reuse and cleanup on failure.
- Real automatic setup ran on Linux with Python 3.12: the extension's VoiceManager
  created its own venv, installed Piper 1.8.0 and resolved the bundled default
  English voice. Switching to bundled Anna also resolved without settings edits.
- All six models produced valid mono 22,050 Hz WAV audio using Piper 1.8.0's CLI
  with UTF-8 stdin. Each output was more than one second long and had nonzero
  signal energy. Measurements are in voice-synthesis-linux.json.
- Reader DOM checks verified the six installed options, Hungarian filtering, name
  search, selecting a voice, exposing the full catalog, setup and license actions.
  Browser rendering checks could not run because Chromium downloads were truncated.
- Physical speaker output, Windows/macOS setup and the VS Code extension-host
  UI still require platform acceptance testing.

Voice assets and their configs/cards are checksum-verified before production
packaging. The build fails when a required voice is missing or corrupted.
