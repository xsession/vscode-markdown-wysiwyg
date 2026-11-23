# Third-party components

The full offline package redistributes the following. Exact notices, license
texts and corresponding source archives are shipped in the package; the files
listed are in the repository root and `resources/`.

## Speech runtime

Native Piper **2023.11.14-2** for Windows x64 and Linux x64, from
<https://github.com/rhasspy/piper/releases/tag/2023.11.14-2>. This is the
standalone C++ engine, distinct from the Python Piper used by version 0.9.

| Component | License |
| --- | --- |
| Piper | MIT |
| piper-phonemize 1.2.0 (with uni-algo) | MIT |
| eSpeak NG (commit `0f65aa30…`) | GPL-3.0; corresponding source included |
| ONNX Runtime 1.14.1 | MIT |
| fmt, spdlog, nlohmann JSON | their own permissive licenses |
| Microsoft C++ runtime DLLs 14.44.35211.0 (Windows) | Microsoft's terms, license beside `piper.exe` |

See `THIRD_PARTY_RUNTIME.md`. A SHA-256 manifest in
`resources/runtime/manifest.json` identifies the shipped files.

## Voices

Six unmodified ONNX models from
<https://huggingface.co/rhasspy/piper-voices>, with their configurations and
model cards:

| Voice | Language | Dataset license (from the model card) |
| --- | --- | --- |
| en_US-ljspeech-medium | English (US) | public domain (LJ Speech) |
| en_US-john-medium | English (US) | public domain (LibriVox) |
| en_US-kristin-medium | English (US) | public domain (LibriVox) |
| hu_HU-anna-medium | Hungarian | CC0 |
| hu_HU-berta-medium | Hungarian | CC0 |
| hu_HU-imre-medium | Hungarian | CC0 |

Other catalog voices can have different licenses, including non-commercial
ones; the reader's **Model license** button shows a voice's card before you
use it. See `THIRD_PARTY_VOICES.md`.

## Local AI (not bundled)

The current package does not include a model. Earlier packages bundled
Qwen3-0.6B (Apache-2.0, GGUF conversion by Unsloth) and the llama.cpp CPU
runtime `b12002` (MIT); `THIRD_PARTY_AI.md` keeps those notices.

## Extension

The extension's own source is under the GPL (`LICENSE.txt`). Document parsers
and other npm dependencies are bundled with their licenses.
