"""Fetch a catalog voice with upstream size/MD5 checks and atomic file replacement."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request

BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

def download_voice(catalog, key, destination):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', key) or key not in catalog:
        raise ValueError('Unknown catalog voice')
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    voice = catalog[key]
    for remote, metadata in voice['files'].items():
        name = remote.rsplit('/', 1)[-1]
        if name not in (key + '.onnx', key + '.onnx.json', 'MODEL_CARD'):
            continue
        target = destination / name
        def valid(p):
            if not p.is_file() or p.stat().st_size != metadata['size_bytes']:
                return False
            with p.open('rb') as f:
                digest = hashlib.md5()
                for block in iter(lambda: f.read(1024 * 1024), b''):
                    digest.update(block)
            return digest.hexdigest() == metadata['md5_digest']
        if valid(target):
            continue
        if '..' in remote.split('/') or not re.fullmatch(r'[A-Za-z0-9_./-]+', remote):
            raise ValueError('Unsafe catalog path')
        temporary = target.with_name(name + '.partial')
        try:
            with urllib.request.urlopen(BASE + remote, timeout=60) as response, temporary.open('wb') as f:
                if not response.url.startswith('https://'):
                    raise ValueError('Insecure download redirect')
                count = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    count += len(block)
                    if count > metadata['size_bytes']:
                        raise ValueError('Voice exceeds catalog size')
                    f.write(block)
            if not valid(temporary):
                raise ValueError('Voice checksum/size mismatch: ' + name)
            os.replace(temporary, target)
            print('Verified ' + name, flush=True)
        finally:
            temporary.unlink(missing_ok=True)
    for suffix in ('.onnx', '.onnx.json'):
        if not (destination / (key + suffix)).is_file():
            raise ValueError('Catalog missing required model/config')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--voice', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    download_voice(json.loads(Path(args.catalog).read_text()), args.voice, args.destination)
