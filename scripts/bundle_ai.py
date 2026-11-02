"""Bundle pinned local model and Windows/Linux CPU runtimes. No runtime downloads."""
from pathlib import Path
import concurrent.futures,hashlib,json,os,shutil,tarfile,tempfile,time,urllib.request,zipfile
from bundle_runtime import unpack_tar_portable,unpack_zip
ROOT=Path(__file__).resolve().parents[1]
AI=ROOT/'resources/ai'
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for data in iter(lambda:f.read(1024*1024),b''):h.update(data)
    return h.hexdigest()
def download(url,path,expected=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_file() and (expected is None or digest(path)==expected):return
    for attempt in range(3):
        partial=path.with_name(path.name+'.partial')
        try:
            with urllib.request.urlopen(url,timeout=120) as source,partial.open('wb') as output:shutil.copyfileobj(source,output)
            if expected and digest(partial)!=expected:raise ValueError('Checksum mismatch: '+path.name)
            partial.replace(path);print('Bundled '+path.name,flush=True);return
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt==2:raise
            time.sleep(2)
def main():
    config=json.loads((ROOT/'resources/ai-sources.json').read_text())
    AI.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='bundle-local-ai-') as tmp:
        work=Path(tmp)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            futures=[pool.submit(download,config['model']['url'],AI/'model.gguf',config['model']['sha256'])]
            futures += [pool.submit(download,a['url'],work/a['name'],a['sha256']) for a in config['archives']]
            for f in futures:f.result()
        runtimes={}
        for archive in config['archives']:
            dest=AI/archive['platform']
            if archive['name'].endswith('.zip'):unpack_zip(work/archive['name'],dest)
            else:unpack_tar_portable(work/archive['name'],dest)
            suffix='.exe' if archive['platform'].startswith('win') else ''
            # Non-interactive completion binary is preferred; CLI is a fallback.
            matches=list(dest.rglob('llama-completion'+suffix)) or list(dest.rglob('llama-cli'+suffix))
            if not matches:raise ValueError('No completion executable found for '+archive['platform'])
            runtimes[archive['platform']]=matches[0].relative_to(AI).as_posix()
            if suffix:
                vc=ROOT/'resources/runtime/win32-x64/piper'
                for file in vc.iterdir():
                    if file.name.startswith(('msvcp','vcruntime','concrt','vcomp')) and file.suffix=='.dll' or file.name=='MICROSOFT-VC-LICENSE.rtf':
                        shutil.copyfile(file,matches[0].parent/file.name)
        download('https://huggingface.co/Qwen/Qwen3-0.6B/resolve/main/LICENSE',AI/'MODEL-LICENSE.txt')
        download('https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/README.md',AI/'MODEL-CARD.md')
        download('https://raw.githubusercontent.com/ggml-org/llama.cpp/'+config['release']+'/LICENSE',AI/'LLAMA-LICENSE.txt')
        # Corresponding runtime source is retained for reproducibility and notices.
        download('https://github.com/ggml-org/llama.cpp/archive/refs/tags/'+config['release']+'.tar.gz',AI/'llama-source.tar.gz')
    for partial in AI.rglob('*'):
        if partial.is_file() and '.partial' in partial.name:partial.unlink(missing_ok=True)
    files={p.relative_to(AI).as_posix():digest(p) for p in sorted(AI.rglob('*')) if p.is_file() and p.name!='manifest.json' and '.partial' not in p.name}
    manifest={**config,'runtimes':runtimes,'files':files};manifest['model']['file']='model.gguf'
    (AI/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Offline local AI bundle ready: '+str(len(files))+' files',flush=True)
if __name__=='__main__':main()
