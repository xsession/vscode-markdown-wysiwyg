const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../resources/runtime'),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
for(const [name,hash] of Object.entries(manifest.files)){
 const file=path.join(root,name);if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('Missing or corrupted runtime file: '+name);
}
for(const file of ['win32-x64/piper/piper.exe','win32-x64/piper/msvcp140.dll','win32-x64/piper/vcruntime140.dll','win32-x64/piper/vcruntime140_1.dll','linux-x64/piper/piper','licenses/espeak-ng-corresponding-source.zip'])if(!manifest.files[file])throw Error('Incomplete offline runtime manifest: '+file);
console.log('Offline runtimes verified: '+manifest.platforms.join(', ')+', '+Object.keys(manifest.files).length+' files');
