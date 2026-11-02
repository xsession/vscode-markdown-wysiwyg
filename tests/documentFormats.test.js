const assert=require('assert'),fs=require('fs'),path=require('path');
const {zipSync,strToU8}=require('fflate');
const {importDocument,pdfPagesToMarkdown,htmlToMarkdown,pdfAssetPaths}=require('../out/documentFormats');
const {filterReadingText,defaultFilters}=require('../out/readingFilters');
const {headings}=require('../out/documentationIndex');
const zip = files=>Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))));
function pdf(){
 const objects=[];const add=s=>{objects.push(s);return objects.length;};
 add('<< /Type /Catalog /Pages 2 0 R >>');add('<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 for(let p=1;p<=3;p++){const stream=`BT /F1 12 Tf 50 780 Td (RUNNING HEADER) Tj 0 -50 Td (Body text page ${p}.) Tj 0 -25 Td (Visit https://example.com for docs.) Tj 0 -600 Td (Page ${p}) Tj ET`;
 add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length+2} 0 R >>`);add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
 let out='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}const xref=Buffer.byteLength(out);out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(out);
}
const samples={
 'guide.md':Buffer.from('# Guide\n\nReadable body.\n\n```c\nSECRET_CODE\n```\n\nhttps://example.com\n'),
 'guide.txt':Buffer.from('Readable body.\n\nhttps://example.com'),
 'guide.html':Buffer.from('<header>HEADER_SECRET</header><h1>Guide</h1><p>Readable body. <a href="https://example.com">Documentation</a></p><pre>SECRET_CODE</pre><footer>FOOTER_SECRET</footer><script>EVIL_SCRIPT</script>'),
 'guide.rst':Buffer.from('Guide\n=====\n\nReadable body.\n\n.. code-block:: c\n\n    SECRET_CODE\n\n.. header::\n\n    HEADER_SECRET\n\n.. footer::\n\n    FOOTER_SECRET\n'),
 'guide.adoc':Buffer.from('= Guide\n\nReadable body.\n\n[source,c]\n----\nSECRET_CODE\n----\n'),
 'guide.rtf':Buffer.from('{\\rtf1\\ansi {\\header HEADER_SECRET}{\\footer FOOTER_SECRET}Readable body.\\par More text.}'),
 'guide.docx':zip({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Guide</w:t></w:r></w:p><w:p><w:r><w:t>Readable body.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t>SECRET_CODE</w:t></w:r></w:p></w:body></w:document>',
  'word/styles.xml':'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/></w:style></w:styles>',
  'word/header1.xml':'<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>HEADER_SECRET</w:t></w:r></w:p></w:hdr>',
  'word/footer1.xml':'<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>FOOTER_SECRET</w:t></w:r></w:p></w:ftr>'}),
 'guide.odt':zip({'mimetype':'application/vnd.oasis.opendocument.text','content.xml':'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h text:outline-level="1">Guide</text:h><text:p>Readable body.</text:p><text:p text:style-name="Source_Code">SECRET_CODE</text:p></office:text></office:body></office:document-content>',
 'styles.xml':'<office:document-styles xmlns:office="office" xmlns:style="style" xmlns:text="text"><style:header><text:p>HEADER_SECRET</text:p></style:header><style:footer><text:p>FOOTER_SECRET</text:p></style:footer></office:document-styles>'}),
 'guide.epub':zip({'mimetype':'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>','OEBPS/book.opf':'<package><manifest><item id="two" href="two.xhtml"/><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>','OEBPS/one.xhtml':'<html><body><h1>First chapter</h1><p>Readable body.</p><pre>SECRET_CODE</pre><header>HEADER_SECRET</header></body></html>','OEBPS/two.xhtml':'<html><body><h1>Second chapter</h1><p>Second body.</p><footer>FOOTER_SECRET</footer></body></html>'}),
 'guide.pdf':pdf()
};
(async()=>{

 const backslash=String.fromCharCode(92);
 const windowsRoot=['C:','Users','László Iványi','Downloads','report #1 % draft','node_modules','pdfjs-dist'].join(backslash);
 const unc=backslash+backslash+['server','share','doc files','pdfjs-dist'].join(backslash);
 for(const directory of [windowsRoot,windowsRoot+backslash,unc,'/tmp/doc files #1 %/pdfjs-dist']){
  const assets=pdfAssetPaths(directory);
  for(const value of Object.values(assets)){assert(value.endsWith('/'));assert(!value.includes(backslash));assert(!value.startsWith('file:'));}
  assert(assets.cMapUrl.endsWith('/cmaps/'));assert(assets.standardFontDataUrl.endsWith('/standard_fonts/'));assert(assets.wasmUrl.endsWith('/wasm/'));
 }
 assert.strictEqual(pdfAssetPaths(unc).cMapUrl,'//server/share/doc files/pdfjs-dist/cmaps/');
 assert.strictEqual(pdfAssetPaths('C:/Tools/pdfjs-dist/').cMapUrl,'C:/Tools/pdfjs-dist/cmaps/');
 assert(pdfAssetPaths(windowsRoot).cMapUrl.includes('report #1 % draft'));
 // Validate the real PDF.js factories with Windows-shaped paths. On Linux,
 // translate their filesystem reads to the installed assets without changing validation.
 const actualRoot=require('../media/documentParserAssets.cjs').assetDirectory;
 const mappedRoot='C:/PDF path test #1 %/pdfjs-dist';
 const originalRead=fs.promises.readFile;let mappedReads=0;
 fs.promises.readFile=async function(file,...args){if(typeof file==='string'&&file.startsWith(mappedRoot+'/')){mappedReads++;file=path.join(actualRoot,file.slice(mappedRoot.length+1));}return originalRead.call(this,file,...args);};
 try{
  if(!global.DOMMatrix)global.DOMMatrix=require('@thednp/dommatrix');
  const {PDFParse}=require('pdf-parse');
  const parser=new PDFParse({data:new Uint8Array(samples['guide.pdf']),useSystemFonts:false,isEvalSupported:false,...pdfAssetPaths(mappedRoot)});
  try{const result=await parser.getText();assert(result.text.includes('Body text page'));}finally{await parser.destroy();}
 }finally{fs.promises.readFile=originalRead;}
 assert(mappedReads>0,'Real PDF parser must exercise the mapped asset filesystem path');
 console.log('PDF paths: Windows drive/UNC, Unicode/spaces/#/%, trailing slash and real asset reads passed');

 for(const [name,data] of Object.entries(samples)){
  const imported=await importDocument(data,name),clean=filterReadingText(imported.markdown,defaultFilters);
  assert(/Readable body|Body text page/.test(clean),name+' must retain content: '+clean);
  assert(!/SECRET_CODE|HEADER_SECRET|FOOTER_SECRET|https:\/\/example.com|EVIL_SCRIPT/.test(clean),name+' leaked skipped content: '+clean);
  const all=filterReadingText(imported.markdown,{skipCode:false,skipUrls:false,skipHeaders:false,skipFooters:false});
  if(/html|docx|odt|epub|rtf|rst/.test(path.extname(name)))assert(all.includes('HEADER_SECRET')&&all.includes('FOOTER_SECRET'),name+' must retain optional banners');
  if(!/txt|rtf/.test(path.extname(name)))assert(headings(clean,name).length,name+' must expose an outline');
  if(name.endsWith('epub'))assert(imported.markdown.indexOf('First chapter')<imported.markdown.indexOf('Second chapter'));
  if(name.endsWith('pdf'))assert(!clean.includes('RUNNING HEADER')&&!/^Page [123]$/m.test(clean),'PDF banners filtered');
  const folder=path.join(__dirname,'../examples/documents');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name),data);
  console.log('Document import and skip filters passed: '+name);
 }
 const flags={skipCode:false,skipUrls:false,skipHeaders:false,skipFooters:false};
 const text=':::reader-header\nHeader\n:::\n# Keep heading\n\ntext `inline_code` https://example.com\n\n```\nblock_code\n```\n:::reader-footer\nFooter\n:::';
 for(const key of Object.keys(flags)){
  const clean=filterReadingText(text,{...flags,[key]:true});
  assert(clean.includes('# Keep heading'));
  assert.strictEqual(clean.split('\n').length,text.split('\n').length);
  if(key==='skipCode')assert(!clean.includes('inline_code')&&!clean.includes('block_code')&&clean.includes('Header'));
  if(key==='skipUrls')assert(!clean.includes('https://')&&clean.includes('inline_code'));
  if(key==='skipHeaders')assert(!clean.includes('Header')&&clean.includes('Footer'));
  if(key==='skipFooters')assert(!clean.includes('Footer')&&clean.includes('Header'));
 }
 assert(!htmlToMarkdown('<img src="https://remote.example/evil"><iframe src="https://remote.example"></iframe>').includes('remote.example'));
 await assert.rejects(importDocument(Buffer.from('not pdf'),'broken.pdf'));
 await assert.rejects(importDocument(Buffer.from('not zip'),'broken.docx'));
 await assert.rejects(importDocument(zip({'META-INF/encryption.xml':'encrypted'}),'encrypted.epub'),/Encrypted/);
 await assert.rejects(importDocument(Buffer.from('legacy'),'unsupported.doc'),/Unsupported/);
 console.log('Independent filters, safe markup, malformed documents and encrypted EPUB checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
