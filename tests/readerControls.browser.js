// Optional: provide playwright via NODE_PATH and CHROMIUM_PACKAGE for portable Chromium.
const {chromium}=require('playwright'),assert=require('assert');
const {readerHtml}=require('../out/readerHtml');
(async()=>{const portable=process.env.CHROMIUM_PACKAGE?(require(process.env.CHROMIUM_PACKAGE).default||require(process.env.CHROMIUM_PACKAGE)):null;const browser=await chromium.launch({headless:true,args:portable?portable.args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:portable?{executablePath:await portable.executablePath()}:{})});try{
 const page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let html=readerHtml(),nonce=html.match(/script-src 'nonce-([^']+)'/)[1];
 html=html.replace('<head>','<head><script nonce="'+nonce+'">window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m)});</script>');
 await page.setContent(html);
 await page.getByRole('button',{name:'Mind map',exact:false}).click();
 await page.getByRole('button',{name:'Open document…',exact:true}).click();
 for(const key of ['skipCode','skipUrls','skipHeaders','skipFooters']){assert(await page.locator('#'+key).isChecked());await page.locator('#'+key).uncheck();}
 const messages=await page.evaluate(()=>window.messages);
 assert(messages.some(m=>m.type==='mindmap'));assert(messages.some(m=>m.type==='openDocument'));
 assert.deepStrictEqual(messages.filter(m=>m.type==='filters').slice(-1)[0].filters,{skipCode:false,skipUrls:false,skipHeaders:false,skipFooters:false});
 await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'document',filters:{skipCode:true,skipUrls:true,skipHeaders:true,skipFooters:true},headings:[],bookmarks:[],rate:1,mode:'continuous',path:['Guide'],index:0,total:2}})));
 assert(await page.locator('#skipCode').isChecked());
 assert.deepStrictEqual(errors,[]);
 await page.screenshot({path:'/workspace/scratch/052b4483bedd/reader-controls-qa.png',fullPage:true});
 console.log('Reader browser: visible mind-map/open buttons, four independent filter controls, host state sync and CSP passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
