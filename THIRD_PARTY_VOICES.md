# Bundled Piper voices

The full 0.9.0 VSIX includes six unmodified ONNX models, six matching JSON
configurations and six upstream MODEL_CARD files. Models are from
https://huggingface.co/rhasspy/piper-voices . The upstream size and MD5 in the
checked-in catalog are verified when preparing the package. These checks detect
corruption; MD5 is not a signature or proof of origin.

| Voice | Language | Upstream model-card dataset license |
| --- | --- | --- |
| en_US-ljspeech-medium | English, US | Public domain (LJ Speech) |
| en_US-john-medium | English, US | Public domain (LibriVox) |
| en_US-kristin-medium | English, US | Public domain (LibriVox) |
| hu_HU-anna-medium | Hungarian | CC0 (OHF-Voice voice-datasets) |
| hu_HU-berta-medium | Hungarian | CC0 (OHF-Voice voice-datasets) |
| hu_HU-imre-medium | Hungarian | CC0 (OHF-Voice voice-datasets) |

See the exact upstream cards under resources/voices/<voice>/MODEL_CARD. Cards
also describe the training provenance. Additional catalog voices may carry
other licenses, including noncommercial restrictions. The reader's Model license
button opens the selected model's card before downloading or using it.

The bundled native speech runtime and its dependencies have separate notices;
see THIRD_PARTY_RUNTIME.md. No Python runtime or pip installation is required
for the bundled voices on Windows x64 / Linux x64. The Markdown Editor source
retains its existing GPL license (LICENSE.txt).
