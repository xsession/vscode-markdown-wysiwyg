const fs=require('fs'),path=require('path');
for(const name of ['mammoth','pdf-parse','fflate','htmlparser2','@iarna/rtf-to-html','@thednp/dommatrix'])require.resolve(name);
const assets=path.dirname(require.resolve('pdfjs-dist/package.json'));for(const name of ['cmaps','standard_fonts','wasm'])if(!fs.existsSync(path.join(assets,name)))throw Error('Missing PDF assets: '+name);
const worker=require('pdf-parse/worker').getPath();if(!fs.existsSync(worker))throw Error('Missing offline PDF worker: '+worker);
for(const name of ['documentation.svg','mindmap-light.svg','mindmap-dark.svg','documentationMap.js','documentationMap.css','documentParserAssets.cjs'])if(!fs.existsSync(path.join(__dirname,'../media',name)))throw Error('Missing documentation UI asset: '+name);
console.log('Offline document parsers, PDF worker and mind-map assets verified');
