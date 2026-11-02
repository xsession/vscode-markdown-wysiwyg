# Included offline speech runtime

This package includes the official native Piper release **2023.11.14-2** for
Windows x64 and Linux x64. This is the older standalone C++ backend, distinct
from the newer Python Piper 1.8 backend used in version 0.9 of this extension.
It supports the six included ONNX voices and persistent JSON-input synthesis.

Runtime archives originate from:
https://github.com/rhasspy/piper/releases/tag/2023.11.14-2

- Piper: MIT. Source archive and notice are in resources/runtime/licenses.
- piper-phonemize 1.2.0: MIT, including its uni-algo notice and source archive.
- eSpeak NG: GPL-3.0. The corresponding source/dictionaries at upstream commit
  0f65aa301e0d6bae5e172cc74197d32a6182200f are included as
  resources/runtime/licenses/espeak-ng-corresponding-source.zip, together with
  the GPL license and upstream build scripts. This is the revision referenced
  by the phonemizer build configuration.
- ONNX Runtime 1.14.1: MIT and upstream ThirdPartyNotices included.
- fmt, spdlog and nlohmann JSON: their license notices are included.
- Windows application-local Microsoft C++ runtime DLLs are copied unchanged from
  Microsoft's vc_redist.x64.exe, version 14.44.35211.0. The English Microsoft
  license is included beside piper.exe as MICROSOFT-VC-LICENSE.rtf. These DLLs
  retain Microsoft's terms and are not relicensed as GPL.

The SHA-256 manifest in resources/runtime/manifest.json identifies the shipped
files. scripts/bundle_runtime.py prepares the native bundles from pinned HTTPS
archives and includes their licenses/sources. It is a build-time script only:
Python and 7-Zip are not required for playback. Normal operating-system
components and VS Code itself are prerequisites; a Linux libc/loader or Windows
system DLLs are not redistributed in this extension.

See THIRD_PARTY_VOICES.md for the separate model provenance.
