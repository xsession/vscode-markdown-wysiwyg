"""Prepare pinned offline Windows/Linux x64 Piper dependencies using build-time tools only."""
from pathlib import Path
import concurrent.futures
import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
import tarfile
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'resources/runtime'
RELEASE = '2023.11.14-2'
ARCHIVES = {
 'piper_windows_amd64.zip': ('https://github.com/rhasspy/piper/releases/download/' + RELEASE + '/piper_windows_amd64.zip', 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea'),
 'piper_linux_x86_64.tar.gz': ('https://github.com/rhasspy/piper/releases/download/' + RELEASE + '/piper_linux_x86_64.tar.gz', 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992'),
 'vc_redist.x64.exe': ('https://aka.ms/vs/17/release/vc_redist.x64.exe', 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b'),
 '7z2301-linux-x64.tar.xz': ('https://www.7-zip.org/a/7z2301-linux-x64.tar.xz', '23babcab045b78016e443f862363e4ab63c77d75bc715c0b3463f6134cbcf318')
}
PHONEMIZE = 'fccd4f335aa68ac0b72600822f34d84363daa2bf'
ESPEAK = '0f65aa301e0d6bae5e172cc74197d32a6182200f'
LICENSES = {
 'piper-MIT.txt': 'https://raw.githubusercontent.com/rhasspy/piper/' + RELEASE + '/LICENSE.md',
 'piper-phonemize-MIT.txt': 'https://raw.githubusercontent.com/rhasspy/piper-phonemize/' + PHONEMIZE + '/LICENSE.md',
 'uni-algo-MIT.txt': 'https://raw.githubusercontent.com/rhasspy/piper-phonemize/' + PHONEMIZE + '/licenses/uni-algo/LICENSE.md',
 'onnxruntime-MIT.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.14.1/LICENSE',
 'onnxruntime-ThirdPartyNotices.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.14.1/ThirdPartyNotices.txt',
 'espeak-ng-GPL3.txt': 'https://raw.githubusercontent.com/rhasspy/espeak-ng/' + ESPEAK + '/COPYING',
 'fmt-MIT.txt': 'https://raw.githubusercontent.com/fmtlib/fmt/10.0.0/LICENSE.rst',
 'spdlog-MIT.txt': 'https://raw.githubusercontent.com/gabime/spdlog/v1.12.0/LICENSE',
 'json-MIT.txt': 'https://raw.githubusercontent.com/nlohmann/json/v3.11.2/LICENSE.MIT',
 'espeak-ng-corresponding-source.zip': 'https://codeload.github.com/rhasspy/espeak-ng/zip/' + ESPEAK,
 'piper-source.zip': 'https://codeload.github.com/rhasspy/piper/zip/refs/tags/' + RELEASE,
 'piper-phonemize-source.zip': 'https://codeload.github.com/rhasspy/piper-phonemize/zip/' + PHONEMIZE
}

def fetch(url, path, digest=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=90) as response, path.open('wb') as output:
        shutil.copyfileobj(response, output)
    if digest and hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError('Archive checksum changed: ' + path.name + '. Review the upstream release before updating the pinned digest.')
    print('Fetched ' + path.name, flush=True)

def unpack_zip(source, destination):
    with zipfile.ZipFile(source) as archive:
        for name in archive.namelist():
            target = (destination / name).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Unsafe archive path')
        archive.extractall(destination)

def unpack_tar_portable(source, destination):
    """Materialize links as ordinary files; Windows needs no symlink privileges."""
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(source) as archive:
        members = archive.getmembers()
        for member in members:
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError('Unsafe archive path: ' + member.name)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile() or member.issym() or member.islnk():
                target.parent.mkdir(parents=True, exist_ok=True)
                # extractfile resolves internal tar links without creating host symlinks.
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError('Unreadable archive member: ' + member.name)
                with stream, target.open('wb') as output:
                    shutil.copyfileobj(stream, output)
                target.chmod(member.mode & 0o777)
            else:
                raise ValueError('Unsupported archive member: ' + member.name)

def main():
    # Both hosts produce a complete Windows/Linux x64 runtime bundle.
    if os.name == 'nt':
        sevenzip_windows = shutil.which('7z')
        for base in [os.environ.get('ProgramFiles', ''), os.environ.get('ProgramFiles(x86)', '')]:
            candidate = Path(base) / '7-Zip/7z.exe'
            if not sevenzip_windows and candidate.is_file():
                sevenzip_windows = str(candidate)
        if not sevenzip_windows:
            raise SystemExit('Install 7-Zip (7z.exe) or run build.bat to install build prerequisites.')
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='bundle-piper-') as temporary:
        work = Path(temporary)
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            futures = [pool.submit(fetch, url, work / name, digest) for name, (url, digest) in ARCHIVES.items()
                       if os.name != 'nt' or not name.startswith('7z2301-linux')]
            for future in futures:
                future.result()
        unpack_zip(work / 'piper_windows_amd64.zip', RUNTIME / 'win32-x64')
        unpack_tar_portable(work / 'piper_linux_x86_64.tar.gz', RUNTIME / 'linux-x64')
        if os.name == 'nt':
            sevenzip = Path(sevenzip_windows)
        else:
            unpack_tar_portable(work / '7z2301-linux-x64.tar.xz', work / '7zip')
            sevenzip = work / '7zip/7zz'
            sevenzip.chmod(0o755)
        def extract(source, destination):
            subprocess.run([str(sevenzip), 'x', str(source), '-o' + str(destination), '-y'], check=True, stdout=subprocess.DEVNULL)
        extract(work / 'vc_redist.x64.exe', work / 'vc-manifest')
        data = (work / 'vc_redist.x64.exe').read_bytes()
        offset = 0
        candidates = []
        while True:
            offset = data.find(b'MSCF', offset)
            if offset < 0:
                break
            size = struct.unpack_from('<I', data, offset + 8)[0]
            if 0 < size <= len(data) - offset:
                candidates.append((size, offset))
            offset += 4
        size, offset = max(candidates)
        (work / 'packages.cab').write_bytes(data[offset:offset + size])
        extract(work / 'packages.cab', work / 'packages')
        manifest = ET.parse(work / 'vc-manifest/0')
        cab = next(x.attrib['SourcePath'] for x in manifest.iter() if x.tag.endswith('Payload') and x.attrib.get('FilePath', '').endswith('vcRuntimeMinimum_amd64\\cab1.cab'))
        extract(work / 'packages' / cab, work / 'vc-dlls')
        for file in (work / 'vc-dlls').glob('*.dll_amd64'):
            shutil.copyfile(file, RUNTIME / 'win32-x64/piper' / file.name.removesuffix('_amd64'))
        shutil.copyfile(work / 'vc-manifest/u4', RUNTIME / 'win32-x64/piper/MICROSOFT-VC-LICENSE.rtf')
    # Flatten shared-library symlinks so VSIX extraction is independent of symlink support.
    for file in (RUNTIME / 'linux-x64/piper').iterdir():
        if file.is_symlink():
            data = file.read_bytes()
            file.unlink()
            file.write_bytes(data)
    (RUNTIME / 'linux-x64/piper/piper').chmod(0o755)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        futures = [pool.submit(fetch, url, RUNTIME / 'licenses' / name) for name, url in LICENSES.items()]
        for future in futures:
            future.result()
    files = {file.relative_to(RUNTIME).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
             for file in sorted(RUNTIME.rglob('*')) if file.is_file() and file.name != 'manifest.json'}
    manifest = {'release': RELEASE, 'platforms': ['win32-x64', 'linux-x64'], 'files': files}
    (RUNTIME / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Offline runtime bundle ready: ' + str(len(files)) + ' files')

if __name__ == '__main__':
    main()
