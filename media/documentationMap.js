(() => {
 const api = acquireVsCodeApi(), saved = api.getState() || {};
 const world = document.getElementById('world'), viewport = document.getElementById('viewport');
 let root, scale = saved.scale || 1, x = saved.x || 30, y = saved.y || 30;
 let depth = saved.depth || 2, folded = new Set(saved.folded || []), opened = new Set(saved.opened || []);
 let focused = saved.focused||'', query = '', drag, count = 0, truncated = false;
 document.getElementById('depth').value = String(depth);
 function transform() { world.style.transform = `translate(${x}px,${y}px) scale(${scale})`; document.getElementById('zoom').textContent = Math.round(scale*100)+'%'; api.setState({scale,x,y,depth,focused,folded:[...folded],opened:[...opened]}); }
 function zoom(factor, cx = viewport.clientWidth/2, cy = viewport.clientHeight/2) { const next = Math.min(3,Math.max(.1,scale*factor)); x = cx-(cx-x)*next/scale; y = cy-(cy-y)*next/scale; scale = next; transform(); }
 function fit() { scale = Math.min(1,(viewport.clientWidth-60)/Math.max(1,world.offsetWidth),(viewport.clientHeight-60)/Math.max(1,world.offsetHeight)); scale = Math.max(.1,scale); x = 30; y = 30; transform(); }
 function render() {
  if (!root) return;
  world.replaceChildren(); count = 0; truncated = false;
  const matches = new Set();
  function mark(n) { const own = n.label.toLowerCase().includes(query); let child = false; for (const c of n.children) if(mark(c)) child=true; if(own || child) matches.add(n.id); return own || child; }
  if(query) mark(root);
  function branch(n, level) {
   if (++count > 3000) { truncated = true; return null; }
   const li = document.createElement('li'), row = document.createElement('div'); row.className = 'node '+n.kind+(n.current?' current':''); li.append(row);
   const visible = n.children.filter(c => !query || matches.has(c.id));
   const expanded = query ? !folded.has(n.id) : !folded.has(n.id) && (level < depth || opened.has(n.id));
   if (visible.length) {
    const toggle = document.createElement('button'); toggle.className = 'toggle'; toggle.textContent = expanded ? '−' : '+'; toggle.setAttribute('aria-label',(expanded?'Collapse ':'Expand ')+n.label); toggle.setAttribute('aria-expanded',String(expanded));
    toggle.onclick = () => { if(expanded){folded.add(n.id);opened.delete(n.id);}else{folded.delete(n.id);opened.add(n.id);}render(); const target = [...world.querySelectorAll('.toggle')].find(b => b.dataset.id===n.id); if(target)target.focus(); }; toggle.dataset.id = n.id; row.append(toggle);
   }
   const label = document.createElement(n.uri?'button':'span'); label.className='label'; label.textContent = n.label; label.title = n.label; if(query && n.label.toLowerCase().includes(query)) label.classList.add('match');
   if(n.uri) { label.onclick=()=>api.postMessage({type:'open',id:n.id}); const listen=document.createElement('button');listen.textContent='▶';listen.title='Listen from '+n.label;listen.setAttribute('aria-label',listen.title);listen.onclick=()=>api.postMessage({type:'listen',id:n.id}); row.append(label,listen);if(n.kind==='file'){const mark=document.createElement('small');mark.textContent=(n.completed?'✓ ':'')+(n.progress||0)+'% heard'+(n.bookmarks?' · '+n.bookmarks+' bookmarks':'');row.append(mark);} }else row.append(label);
   if(n.children.length){const focus=document.createElement('button');focus.textContent='◎';focus.setAttribute('aria-label','Focus '+n.label);focus.onclick=()=>{focused=n.id;render();fit();};row.append(focus);}
   if(expanded && visible.length){const ul=document.createElement('ul');for(const child of visible){const element=branch(child,level+1);if(element)ul.append(element);if(truncated)break;}li.append(ul);}
   return li;
  }
  const ul = document.createElement('ul'); ul.className='tree'; const find=n=>n.id===focused?n:n.children.map(find).find(Boolean);const node=branch(focused?(find(root)||root):root,0);if(node)ul.append(node);world.append(ul);
  document.getElementById('status').textContent = (query ? `${Math.max(0,matches.size-1)} matching nodes and ancestors` : statusText) + (truncated ? ' · View limited to 3,000 nodes; search or collapse levels to narrow it.' : ''); transform();
 }
 let statusText='';
 window.addEventListener('message', event => {if(event.data.type==='marks'&&root){const m=event.data;let activeHeading;const findHeading=n=>{if(n.kind==='heading'&&n.uri===m.current?.uri&&(n.line||0)<=(m.current?.line||0)&&(!activeHeading||(n.line||0)>(activeHeading.line||0)))activeHeading=n;n.children.forEach(findHeading);};findHeading(root);const walk=n=>{n.current=n.kind==='file'&&n.uri===m.current?.uri||n===activeHeading;if(n.kind==='file'){const p=m.progress[n.uri];n.progress=p?Math.floor((p.visited||[]).length/Math.max(1,p.total)*100):0;n.completed=p?.completed;n.bookmarks=p?.bookmarks?.length||0;}n.children.forEach(walk);};walk(root);render();return;} if(event.data.type==='index'){ root=event.data.root;statusText=event.data.status;render(); } });
 document.getElementById('showAll').onclick=()=>{focused='';render();fit();};
 document.getElementById('refresh').onclick=()=>api.postMessage({type:'refresh'});
 document.getElementById('plus').onclick=()=>zoom(1.2);document.getElementById('minus').onclick=()=>zoom(1/1.2);document.getElementById('fit').onclick=fit;
 document.getElementById('depth').onchange=e=>{depth=Number(e.target.value);folded.clear();opened.clear();render();fit();};
 document.getElementById('collapse').onclick=()=>{depth=1;folded.clear();opened.clear();document.getElementById('depth').value='1';query='';document.getElementById('search').value='';render();fit();};
 document.getElementById('expand').onclick=()=>{depth=99;folded.clear();opened.clear();document.getElementById('depth').value='99';render();fit();};
 document.getElementById('search').oninput=e=>{query=e.target.value.trim().toLowerCase();folded.clear();render();fit();};
 viewport.addEventListener('wheel',e=>{e.preventDefault();const rect=viewport.getBoundingClientRect();zoom(e.deltaY<0?1.12:1/1.12,e.clientX-rect.left,e.clientY-rect.top);},{passive:false});
 viewport.onpointerdown=e=>{if(e.target.closest('button'))return;drag={px:e.clientX,py:e.clientY,x,y};viewport.setPointerCapture(e.pointerId);};
 viewport.onpointermove=e=>{if(!drag)return;x=drag.x+e.clientX-drag.px;y=drag.y+e.clientY-drag.py;transform();};
 viewport.onpointerup=viewport.onpointercancel=()=>{drag=undefined;};
 transform();api.postMessage({type:'ready'});
})();
