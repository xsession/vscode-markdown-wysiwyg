const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../resources/ai'),sources=JSON.parse(fs.readFileSync(path.join(root,'../ai-sources.json'),'utf8')),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(manifest.model.sha256!==sources.model.sha256||manifest.release!==sources.release)throw Error('Local AI bundle is from another release. Run npm run ai:bundle.');
for(const [relative,hash] of Object.entries(manifest.files)){
 const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))throw Error('Unsafe AI manifest path');
 if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('Missing/corrupted AI asset: '+relative);
}
for(const platform of ['win32-x64','linux-x64'])if(!manifest.runtimes[platform])throw Error('Missing AI runtime: '+platform);
for(const name of [manifest.model.file,'MODEL-LICENSE.txt','MODEL-CARD.md','LLAMA-LICENSE.txt'])if(!manifest.files[name])throw Error('Missing model/runtime notice: '+name);
console.log('Bundled local AI verified: '+manifest.model.name+' · '+(manifest.model.size/1048576).toFixed(1)+' MiB model · both CPU runtimes');
