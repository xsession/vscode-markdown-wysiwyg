# Windows PDF build fix — 0.13.1

PDF.js requires CMap, standard-font and WASM factory paths to end in a literal forward slash. Version 0.13.0 used the Windows backslash, causing the PDF test/import to fail before parsing.

This release normalizes all three asset-directory paths without percent-encoding spaces, accented characters, # or %. Regression tests cover Windows drive paths, UNC paths, existing separators, and real PDF.js filesystem reads through a Windows-path adapter on Linux.

The dependency lockfile also contains compatible updates for the 18 npm audit findings reported with 0.13.0. npm audit reported zero vulnerabilities after these updates on 2026-10-30. No forced major-version update was used.

## Apply the small patch

Extract the patch ZIP into the EXISTING markdown-listening folder containing package.json, overwriting the matching files. Then double-click build.bat again. The BAT runs npm ci to apply the updated lockfile. Existing downloaded voice/model/runtime assets can be reused and do not need to be removed.

Alternatively, use the complete 0.13.1 source-project ZIP in a new folder. It intentionally excludes the large offline assets, as previous source ZIPs did; import your existing offline VSIX through build.bat to reuse those assets.

Verification: full npm test, real PDF parser path regression tests, webpack build, and built-extension document imports. These checks ran on Linux with simulated Windows paths; native Windows desktop execution remains unverified.
