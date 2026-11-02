// VSCE gives negated ignore rules precedence. Explicit dependency roots let us
// include all production parsers without accidentally shipping host-native canvas.
const fs=require('fs'),path=require('path'),{execSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const dependencies=execSync('npm ls --omit=dev --all --parseable',{cwd:root,encoding:'utf8'}).split(/\r?\n/).filter(Boolean).map(p=>path.relative(root,p).replace(/\\/g,'/')).filter(p=>p.startsWith('node_modules/')&&!p.includes('@napi-rs/'));
const file=path.join(root,'.vscodeignore');
let text=fs.readFileSync(file,'utf8').replace(/\n# BEGIN DOCUMENT PARSER DEPENDENCIES[\s\S]*?# END DOCUMENT PARSER DEPENDENCIES\n?/g,'\n');
text=text.split(/\r?\n/).filter(line=>!line.includes('node_modules/')).join('\n').trim();
text+='\n\n# BEGIN DOCUMENT PARSER DEPENDENCIES\n'+[...new Set(dependencies)].sort().map(p=>'!'+p+'/**/*').join('\n')+'\n# END DOCUMENT PARSER DEPENDENCIES\n';
fs.writeFileSync(file,text);console.log('Prepared portable parser package: '+dependencies.length+' production dependency roots');
// Enumerate verified assets, rather than broadly including temporary download files.
const resources=path.join(root,'resources'),assetPaths=new Set();
const add=relative=>assetPaths.add('resources/'+relative.replace(/\\/g,'/'));
function core(directory,prefix=''){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(!prefix&&['ai','runtime','voices'].includes(entry.name))continue;const relative=prefix+entry.name;if(entry.isDirectory())core(path.join(directory,entry.name),relative+'/');else if(!entry.name.includes('.partial'))add(relative);}}
core(resources);
for(const kind of ['runtime','ai']){const manifestPath=path.join(resources,kind,'manifest.json');if(fs.existsSync(manifestPath)){add(kind+'/manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));for(const file of Object.keys(manifest.files))if(!file.includes('.partial'))add(kind+'/'+file);}}
for(const key of JSON.parse(fs.readFileSync(path.join(resources,'bundled-voices.json'),'utf8')))for(const name of [key+'.onnx',key+'.onnx.json','MODEL_CARD'])add('voices/'+key+'/'+name);
let updated=fs.readFileSync(file,'utf8').replace(/\n# BEGIN VERIFIED OFFLINE ASSETS[\s\S]*?# END VERIFIED OFFLINE ASSETS\n?/g,'\n').split(/\r?\n/).filter(line=>line!=='!resources/**/*').join('\n').trim();
updated+='\n\n# BEGIN VERIFIED OFFLINE ASSETS\n'+[...assetPaths].sort().map(p=>'!'+p).join('\n')+'\n# END VERIFIED OFFLINE ASSETS\n';fs.writeFileSync(file,updated);console.log('Prepared '+assetPaths.size+' verified offline asset paths');
