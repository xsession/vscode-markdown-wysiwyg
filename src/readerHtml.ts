import {workspaceMarkup,workspaceScript,workspaceStyles} from './workspaceHtml';
import {randomBytes} from 'crypto';
export function readerHtml(): string {
 const nonce = randomBytes(16).toString('hex');
 return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Piper listening workspace</title>
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family,system-ui);color:var(--vscode-foreground,#eee);background:var(--vscode-editor-background,#181b21);padding:16px;line-height:1.6;max-width:1000px;margin:auto}
button,select,input{font:inherit;padding:7px;margin:4px;max-width:100%;box-sizing:border-box;color:var(--vscode-input-foreground,#eee);background:var(--vscode-input-background,#252b36);border:1px solid var(--vscode-panel-border,#657084);border-radius:4px}
button{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--vscode-focusBorder,#81b8ff);outline-offset:2px}
section,details{border:1px solid var(--vscode-panel-border,#657084);padding:12px;margin:12px 0;border-radius:8px}h1,h2{line-height:1.3}h1{font-size:1.5em}h2{font-size:1.1em}audio{width:100%}#text{white-space:pre-wrap}#outline,#results,#marks{width:100%}.hint{opacity:.85;font-size:.9em}#context{font-weight:600}fieldset{border:1px solid var(--vscode-panel-border,#657084);border-radius:6px;margin-top:12px}fieldset label{margin-right:12px;padding:3px 0}summary{cursor:pointer}label{display:inline-block}#sleep{width:5em}.primary{background:var(--vscode-button-background,#225da7);color:var(--vscode-button-foreground,#fff)}
${workspaceStyles()}
</style></head><body>
<header><h1>Piper listening workspace</h1><p id="context">Open a document, then press Read.</p><label><input id="focusMode" type="checkbox"> Focus mode</label><label><input id="syncHighlight" type="checkbox" checked> Follow source text</label></header>
<main><button class="primary" id="mindmap" title="Open project documentation mind map"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="1" y="8" width="7" height="8" rx="1"/><path d="M8 12h4V4h5M12 12h5M12 12v8h5"/><path d="M17 2h6v4h-6zM17 10h6v4h-6zM17 18h6v4h-6z"/></svg> Mind map</button><button id="openDocument">Open document…</button><button id="guide">Listen to the research and listening guide</button><section aria-label="Playback">
<button class="primary" id="play" aria-keyshortcuts="Alt+Shift+P">Read / Continue</button><button id="pause" aria-pressed="false">Pause / Resume</button><button id="stop">Stop</button>
<button id="focusBookmark" class="focus-only">Bookmark passage</button><button id="repeat" aria-keyshortcuts="Alt+Shift+R">Repeat sentence</button><button id="rewind">Back 10 seconds</button><button id="forward">Forward 10 seconds</button>
<button id="previous" aria-keyshortcuts="Alt+Shift+ArrowLeft">Previous sentence</button><button id="next" aria-keyshortcuts="Alt+Shift+ArrowRight">Next sentence</button>
<button id="previousHeading" aria-keyshortcuts="Alt+Shift+ArrowUp">Previous heading</button><button id="nextHeading" aria-keyshortcuts="Alt+Shift+ArrowDown">Next heading</button>
<button id="back">Return from jump</button><button id="where" aria-keyshortcuts="Alt+Shift+L">Where am I?</button><button id="restart">Start over</button>
<br><label>Speed <select id="speed"><option>0.5</option><option>0.75</option><option selected>1</option><option>1.1</option><option>1.25</option><option>1.5</option><option>1.75</option><option>2</option><option>2.5</option><option>3</option><option>3.5</option><option>4</option></select>×</label>
<label>Reading mode <select id="mode"><option value="continuous">Continuous</option><option value="outline">Headings only</option><option value="study">Pause after each paragraph for recall</option></select></label>
<label>Sleep timer <input id="sleep" type="number" min="0" max="180" value="0"> minutes (0 = off)</label><button id="setSleep">Set timer</button>
<fieldset><legend>Skip while listening</legend><label><input id="skipCode" type="checkbox" checked> Code sections and inline code</label><label><input id="skipUrls" type="checkbox" checked> URLs (keep link labels)</label><label><input id="skipHeaders" type="checkbox" checked> Page headers</label><label><input id="skipFooters" type="checkbox" checked> Page footers</label><p class="hint">Page headers are running banners, not section headings. PDF detection is approximate. Changes pause playback.</p></fieldset>
<p class="hint">Speed is optional: reduce it for unfamiliar technical content. The six voices and speech engine work offline on Windows x64 / Linux x64.</p>
<p id="status" role="status" aria-live="polite">Ready.</p><audio id="audio" controls aria-label="Current sentence audio"></audio>
<p id="text" aria-label="Current spoken passage"></p></section>
${workspaceMarkup()}
<nav aria-label="Document navigation"><section><h2>Document outline</h2>
<label>Heading <select id="outline"></select></label><button id="goHeading">Read from heading</button>
<label>Tables, figures, references and pages <select id="structures"></select></label><button id="goStructure">Read from structure</button>
<label>Find in document <input id="find" type="search" maxlength="200"></label><button id="searchDocument">Find</button>
<label>Search results <select id="results"></select></label><button id="goResult">Read result</button>
<p id="resultStatus" role="status"></p></section></nav>
<section aria-label="Bookmarks"><h2>Bookmarks</h2><button id="bookmark" aria-keyshortcuts="Alt+Shift+B">Bookmark current sentence</button>
<label>Saved location <select id="marks"></select></label><button id="goMark">Read bookmark</button><button id="deleteMark">Delete bookmark</button></section>
<details><summary>Voices and offline engine</summary><section aria-label="Voice search"><h2>Search voices</h2>
<label>Search <input id="search" type="search" placeholder="English, Hungarian, Anna…"></label>
<label>Language <select id="language"><option value="">All languages</option><option value="en_">English</option><option value="hu_">Hungarian / Magyar</option></select></label>
<label><input id="installed" type="checkbox" checked> Installed voices only</label>
<label>Voice <select id="voices"></select></label><button id="useVoice">Use / Download voice</button><button id="license">Model license</button><button id="setup">Check bundled engine</button><button id="settings">Advanced settings</button>
<p id="voiceStatus" role="status">Loading voice catalog…</p><p class="hint">Included: English LJSpeech, John, Kristin; Hungarian Anna, Berta, Imre. Additional voices need a network connection, but no Python.</p></section></details>
<details><summary>Keyboard controls and listening method</summary><p>Within this panel use Alt+Shift+P to play or pause, Left/Right for sentences, Up/Down for headings, R to repeat, B to bookmark, L to hear your location. Tab and Shift+Tab reach every control. Screen-reader browse-mode keys remain available.</p><p>First browse the outline, choose a section, then listen continuously. Bookmark difficult passages and return to them. Try recall mode to explain each paragraph aloud before continuing. Math is announced as raw notation; it is not a semantic math reader.</p></details>
</main><script nonce="${nonce}">
const vscode=acquireVsCodeApi(), audio=document.getElementById('audio'), status=document.getElementById('status');
let id=0,paused=false,advance=false,preparing=false,voices=[],headings=[],selected='',rate=1,progressAt=0,sleepTimer;
const el=id=>document.getElementById(id), send=m=>vscode.postMessage(m);
function progress(){if(id&&advance)send({type:'progress',id,seconds:Number.isFinite(audio.currentTime)?audio.currentTime:0});}
function reset(){audio.pause();audio.removeAttribute('src');audio.load();id=0;advance=false;paused=false;preparing=false;el('pause').setAttribute('aria-pressed','false');}
function command(type,extra={}){progress();reset();send({type,...extra});}
for(const type of ['play','stop','repeat','previous','next','previousHeading','nextHeading','back','restart','settings'])el(type).onclick=()=>{if(type==='settings'){send({type});return;}command(type);if(type==='stop')status.textContent='Stopped. Your place is saved.';};
function pause(){if(!audio.getAttribute('src')){if(preparing){paused=!paused;el('pause').setAttribute('aria-pressed',String(paused));status.textContent=paused?'Paused while preparing.':'Preparing audio.';return;}command('play');return;}paused=audio.paused===false;el('pause').setAttribute('aria-pressed',String(paused));if(paused){audio.pause();progress();status.textContent='Paused.';}else audio.play().catch(e=>status.textContent=e.message);}
el('pause').onclick=pause;
el('guide').onclick=()=>command('guide');
el('mindmap').onclick=()=>send({type:'mindmap'});el('openDocument').onclick=()=>send({type:'openDocument'});
for(const key of ['skipCode','skipUrls','skipHeaders','skipFooters'])el(key).onchange=()=>{const filters={};for(const name of ['skipCode','skipUrls','skipHeaders','skipFooters'])filters[name]=el(name).checked;command('filters',{filters});};
el('where').onclick=()=>command('context');el('bookmark').onclick=()=>{progress();reset();send({type:'bookmark'});};
el('rewind').onclick=()=>{if(audio.currentTime>10)audio.currentTime-=10;else command('previous');};
el('forward').onclick=()=>{if(Number.isFinite(audio.duration)&&audio.currentTime+10<audio.duration)audio.currentTime+=10;else command('next');};
el('speed').onchange=()=>{rate=Number(el('speed').value);audio.playbackRate=rate;audio.preservesPitch=true;send({type:'rate',rate});};
el('mode').onchange=()=>send({type:'mode',mode:el('mode').value});
el('setSleep').onclick=()=>{clearTimeout(sleepTimer);const minutes=Math.min(180,Math.max(0,Number(el('sleep').value)||0));if(minutes)sleepTimer=setTimeout(()=>{progress();audio.pause();paused=true;send({type:'stop'});status.textContent='Sleep timer finished. Your place is saved.';},minutes*60000);status.textContent=minutes?'Sleep timer set for '+minutes+' minutes.':'Sleep timer off.';};
function jump(select){if(el(select).value!==''){el('mode').value='continuous';send({type:'mode',mode:'continuous'});command('jump',{index:Number(el(select).value)});}}
el('goHeading').onclick=()=>jump('outline');el('goResult').onclick=()=>jump('results');el('goMark').onclick=()=>jump('marks');
el('deleteMark').onclick=()=>{if(el('marks').value!=='')send({type:'deleteBookmark',index:Number(el('marks').value)});};
el('searchDocument').onclick=()=>send({type:'find',query:el('find').value});el('find').onkeydown=e=>{if(e.key==='Enter')el('searchDocument').click();};
function options(target,items){const select=el(target),current=select.value;select.replaceChildren();for(const item of items){const option=document.createElement('option');option.value=String(item.index);option.textContent=item.label;if(option.value===current)option.selected=true;select.appendChild(option);}}
function position(m){el('context').textContent=(m.path||[]).join(' › ')+' · '+(m.index+1)+' / '+m.total+' blocks · '+Math.floor(m.index/m.total*100)+'%';if(headings.length&&document.activeElement!==el('outline')){let current;for(const h of headings)if(h.index<=m.index)current=h.index;if(current!==undefined)el('outline').value=String(current);}}
function filterVoices(){const select=el('voices');select.replaceChildren();const query=el('search').value.toLowerCase(),lang=el('language').value,installed=el('installed').checked;for(const voice of voices)if((!installed||voice.installed)&&voice.key.startsWith(lang)&&(voice.label+' '+voice.key).toLowerCase().includes(query)){const option=document.createElement('option');option.value=voice.key;option.textContent=voice.label+(voice.installed?' · Installed':' · Download');option.selected=voice.key===selected;select.appendChild(option);}el('voiceStatus').textContent='Active: '+selected+' · '+select.options.length+' results';}
for(const name of ['search','language','installed'])el(name).addEventListener('input',filterVoices);
el('useVoice').onclick=()=>{if(el('voices').value)command('voice',{key:el('voices').value});};el('license').onclick=()=>send({type:'license',key:el('voices').value});el('setup').onclick=()=>send({type:'setup'});
audio.onended=()=>{if(advance)send({type:'ended',id});};audio.onerror=()=>status.textContent='Audio playback failed. Try Read again.';
audio.ontimeupdate=()=>{if(Date.now()-progressAt>5000){progressAt=Date.now();progress();}};
window.addEventListener('message',event=>{const m=event.data;
if(m.type==='projectState'){projectState(m);return;}
if(m.type==='projectResult'){projectResult(m);return;}
if(m.type==='externalControl'){if(m.command==='pause')pause();return;}
if(m.type==='voices'){voices=m.voices;selected=m.selected;filterVoices();return;}
if(m.type==='document'){showPassages(m);if(m.structures)options('structures',m.structures.map(s=>({index:s.line,label:s.kind+': '+s.label})));if(m.filters)for(const key of ['skipCode','skipUrls','skipHeaders','skipFooters'])el(key).checked=m.filters[key];headings=m.headings;options('outline',m.headings.map(h=>({index:h.index,label:'Level '+h.level+'. '+h.title})));options('marks',m.bookmarks.map(b=>({index:b.index,label:b.label})));rate=m.rate;el('speed').value=String(rate);el('mode').value=m.mode;position(m);return;}
if(m.type==='position'){position(m);return;}
if(m.type==='results'){options('results',m.results);el('resultStatus').textContent=m.results.length+' results'+(m.results.length===100?' (first 100)':'');return;}
if(m.type==='status'||m.type==='error'){if(m.reset||m.type==='error')reset();preparing=m.type==='status'&&m.reset;status.textContent=m.text;return;}
if(m.type==='finished'){reset();status.textContent='Document finished. Use Start over to listen again.';return;}
if(m.type==='audio'){preparing=false;id=m.id;advance=m.advance;audio.src='data:audio/wav;base64,'+m.audio;audio.playbackRate=m.rate||rate;audio.preservesPitch=true;el('text').textContent=m.text;status.textContent='Reading '+m.position;
const savedSeconds=m.seconds||0;audio.onloadedmetadata=()=>{if(savedSeconds>0&&Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(savedSeconds,audio.duration-.1));};if(!paused)audio.play().catch(()=>status.textContent='Press the audio Play button to allow playback.');}
});
document.addEventListener('keydown',e=>{if(!e.altKey||!e.shiftKey||e.ctrlKey||e.metaKey)return;const keys={p:pause,r:()=>command('repeat'),b:()=>el('bookmark').click(),l:()=>el('where').click(),ArrowLeft:()=>command('previous'),ArrowRight:()=>command('next'),ArrowUp:()=>command('previousHeading'),ArrowDown:()=>command('nextHeading')};const action=keys[e.key]||keys[e.key.toLowerCase()];if(action){e.preventDefault();action();}});
if('mediaSession' in navigator){for(const [name,action] of Object.entries({play:()=>{if(audio.getAttribute('src'))audio.play().catch(()=>{});else command('play');},pause:()=>{audio.pause();paused=true;progress();},previoustrack:()=>command('previousHeading'),nexttrack:()=>command('nextHeading'),seekbackward:()=>el('rewind').click(),seekforward:()=>el('forward').click()})){try{navigator.mediaSession.setActionHandler(name,action);}catch{}}}
${workspaceScript()}
window.addEventListener('beforeunload',progress);send({type:'ready'});
</script></body></html>`;
}
