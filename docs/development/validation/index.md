# Validation records

Hands-on validation results for the speech engine, kept with the raw
measurements they summarize. The automated test suite is described in
[Tests and validation](../testing.md).

| Record | Covers |
| --- | --- |
| [Piper 0.10](piper_0_10.md) | native Piper engine: voices, latency, Windows import closure |
| [Piper 0.9](piper_0_9.md) | the earlier Python Piper backend on Linux |

## Measurement files

| File | Contents |
| --- | --- |
| `native_voices_0_10.json` | synthesis time per voice; drawn as the chart in [Speech pipeline](../../theory_of_operation/speech_pipeline.md#4-piper) |
| `windows_imports_0_10.json` | DLL import closure of the Windows engine |
| `runtime_manifest_0_10.json` | files and hashes of the validated runtime |
| `voice_synthesis_linux.json` | 0.9 synthesis measurements on Linux |
