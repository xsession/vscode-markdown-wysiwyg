"""Reproducibly prepare the six voice packs required by the full VSIX build."""
import concurrent.futures
import json
from pathlib import Path
import time
from download_voice import download_voice

ROOT = Path(__file__).resolve().parents[1]
BUNDLED = ['en_US-ljspeech-medium', 'en_US-john-medium', 'en_US-kristin-medium',
           'hu_HU-anna-medium', 'hu_HU-berta-medium', 'hu_HU-imre-medium']

def main():
    catalog = json.loads((ROOT / 'resources/voice-catalog.json').read_text())
    def fetch(key):
        for attempt in range(3):
            try:
                download_voice(catalog, key, ROOT / 'resources/voices' / key)
                print('Bundled ' + key, flush=True)
                return
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch, BUNDLED))
    (ROOT / 'resources/bundled-voices.json').write_text(json.dumps(BUNDLED, indent=2) + '\n')

if __name__ == '__main__':
    main()
