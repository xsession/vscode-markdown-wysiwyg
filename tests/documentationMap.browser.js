// Optional: NODE_PATH=<directory containing playwright> node tests/documentationMap.browser.js
const {chromium}=require('playwright');
const fs=require('fs'),assert=require('assert'),path=require('path');
(async()=>{const portable=process.env.CHROMIUM_PACKAGE?(require(process.env.CHROMIUM_PACKAGE).default||require(process.env.CHROMIUM_PACKAGE)):null;const browser=await chromium.launch({headless:true,args:portable?portable.args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:portable?{executablePath:await portable.executablePath()}: {})});try{
const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const provider=fs.readFileSync(path.join(__dirname,'../src/documentationExplorer.ts'),'utf8');
let html=provider.match(/panel.webview.html = `([\s\S]*?)`;/)[1].replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace(/<link[^>]*>/,'').replace(/<script[\s\S]*?<\/script>/,'');
await page.setContent(html);await page.addStyleTag({path:path.join(__dirname,'../media/documentationMap.css')});
await page.evaluate(()=>{window.messages=[];window.acquireVsCodeApi=()=>({getState:()=>null,setState:s=>window.saved=s,postMessage:m=>window.messages.push(m)});});
await page.addScriptTag({path:path.join(__dirname,'../media/documentationMap.js')});
const {documentationTree}=require('../out/documentationIndex');const root=documentationTree([{path:'docs/guide.md',uri:'file:///guide.md',text:'# Intro\n## Setup\n### Details\n# <img src=x onerror=alert(1)>'}]);
await page.evaluate(root=>window.dispatchEvent(new MessageEvent('message',{data:{type:'index',root,status:'1 document'}})),root);
await page.click('#expand');assert(await page.getByRole('button',{name:'Setup',exact:true}).isVisible());
await page.getByRole('button',{name:'Setup',exact:true}).click();assert((await page.evaluate(()=>window.messages)).some(m=>m.type==='open'&&m.id.endsWith('#L1')));
await page.getByRole('button',{name:'Listen from Setup',exact:true}).click();assert((await page.evaluate(()=>window.messages)).some(m=>m.type==='listen'));
await page.getByRole('button',{name:'Collapse Intro',exact:true}).click();assert.strictEqual(await page.getByRole('button',{name:'Setup',exact:true}).count(),0);
await page.fill('#search','Setup');assert(await page.getByRole('button',{name:'Setup',exact:true}).isVisible());assert.strictEqual(await page.locator('#world img').count(),0);
const before=await page.locator('#zoom').textContent();await page.click('#plus');assert.notStrictEqual(await page.locator('#zoom').textContent(),before);
await page.click('#collapse');assert.strictEqual(await page.getByRole('button',{name:'Setup',exact:true}).count(),0);
await page.selectOption('#depth','99');assert(await page.getByRole('button',{name:'Details',exact:true}).isVisible());
await page.click('#fit');await page.click('#refresh');assert((await page.evaluate(()=>window.messages)).some(m=>m.type==='refresh'));assert.deepStrictEqual(errors,[]);
console.log('Mind-map browser controls: rendering, navigation, listen, search, collapse, levels, zoom, fit, refresh and safe text passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
