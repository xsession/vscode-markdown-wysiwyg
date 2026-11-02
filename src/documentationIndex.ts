export interface DocNode {
 id: string; label: string; kind: 'root' | 'folder' | 'file' | 'heading' | 'link';
 progress?:number;completed?:boolean;current?:boolean;bookmarks?:number;
 uri?: string; line?: number; level?: number; children: DocNode[];
}
export function headings(text: string, uri: string): DocNode[] {
 const roots: DocNode[] = [], stack: DocNode[] = [];
 const lines = text.split(/\r?\n/); let fence = '', fenceLength = 0, comment = false;
 let frontmatter = lines[0]?.trim() === '---';
 for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  if (frontmatter) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(raw)) frontmatter = false; continue; }
  let line = raw.replace(/<!--[\s\S]*?-->/g, '');
  if (comment) { const end = line.indexOf('-->'); if (end < 0) continue; line = line.slice(end + 3); comment = false; }
  const start = line.indexOf('<!--'); if (start >= 0) { line = line.slice(0, start); comment = true; }
  const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (marker) {
   if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; }
   else if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) fence = '';
   continue;
  }
  if (fence) continue;
  let match = /^ {0,3}(#{1,6})(?:\s+|$)(.*)$/.exec(line);
  let level: number, title: string;
  if (match) { level = match[1].length; title = match[2].replace(/\s+#+\s*$/, ''); }
  else if (line.trim() && !/^\s/.test(line) && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1] || '')) {
   level = lines[i + 1].trim()[0] === '=' ? 1 : 2; title = line; i++;
  } else continue;
  const sourceLine = match ? i : i - 1;
  title = title.replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2').replace(/<[^>]*>/g, '').replace(/[*_`]/g, '').trim() || 'Untitled section';
  const node: DocNode = { id: uri + '#L' + sourceLine, label: title, kind: 'heading', uri, line: sourceLine, level, children: [] };
  while (stack.length && (stack[stack.length - 1].level || 0) >= level) stack.pop();
  (stack.length ? stack[stack.length - 1].children : roots).push(node); stack.push(node);
 }
 return roots;
}
export function documentationTree(files: { path: string; uri: string; text: string }[]): DocNode {
 const root: DocNode = { id: 'root', label: 'Project documentation', kind: 'root', children: [] };
 for (const file of [...files].sort((a,b) => a.path.localeCompare(b.path))) {
  const parts = file.path.split('/'); let parent = root, prefix = '';
  for (const part of parts.slice(0, -1)) {
   prefix += '/' + part;
   let folder = parent.children.find(n => n.kind === 'folder' && n.id === prefix);
   if (!folder) { folder = { id: prefix, label: part, kind: 'folder', children: [] }; parent.children.push(folder); }
   parent = folder;
  }
  parent.children.push({ id: file.uri, label: parts[parts.length - 1], kind: 'file', uri: file.uri, line: 0, children: headings(file.text, file.uri) });
 }
 return root;
}
