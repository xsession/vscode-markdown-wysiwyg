import { speechChunks } from './speechText';
export type SegmentKind = 'heading' | 'sentence' | 'code' | 'table' | 'image' | 'math';
export interface ListeningSegment { text: string; sourceLine: number; paragraph: number; path: string[]; kind: SegmentKind }
export interface ListeningHeading { title: string; level: number; index: number; sourceLine: number }
export interface ListeningDocument { segments: ListeningSegment[]; headings: ListeningHeading[]; words: number }

/** A structural, source-linked listening index. No document text is sent to a service. */
export function listeningDocument(markdown: string, readCode = false): ListeningDocument {
 const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
 const result: ListeningDocument = {segments: [], headings: [], words: 0};
 let paragraph = 0, pending: string[] = [], start = 0, fence = '', code: string[] = [], inComment = false;
 const stack: {title: string; level: number}[] = [];
 const add = (text: string, line: number, kind: SegmentKind) => {
  if (!text.trim()) return;
  const cleaned = speechChunks(text, true).join(' ');
  // Segment short windows at punctuation boundaries to avoid quadratic work on huge paragraphs.
  let offset = 0;
  while (offset < cleaned.length) {
   let end = Math.min(cleaned.length, offset + 2400);
   if (end < cleaned.length) {
    const window = cleaned.slice(offset, end); let boundary = -1;
    const punctuation = /[.!?]["')\]]?(?=\s)/g; let found: RegExpExecArray | null;
    while ((found = punctuation.exec(window))) boundary = found.index + found[0].length;
    if (boundary > 0) end = offset + boundary;
   }
   const window = cleaned.slice(offset, end).trim(); offset = end;
   let sentences: string[] = [window];
   if (kind === 'sentence') {
    const Segmenter = (Intl as any).Segmenter;
    sentences = Segmenter ? Array.from(new Segmenter(undefined, {granularity: 'sentence'}).segment(window), (s: any) => s.segment.trim())
     : window.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÖŐÚÜŰ0-9])/u);
   }
   for (const sentence of sentences) for (const bounded of speechChunks(sentence, true)) if (bounded) {
    result.segments.push({text: bounded, sourceLine: line, paragraph, path: stack.map(s => s.title), kind});
    result.words += bounded.split(/\s+/).length;
   }
  }
 };
 const flush = () => {
  if (!pending.length) return;
  const raw = pending.join('\n');
  if (pending.length > 1 && /^\s*\|?.*\|/.test(pending[0]) && /^\s*\|?[\s:|-]+\|/.test(pending[1])) {
   const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(s => s.trim());
   const header = cells(pending[0]);
   add('Table. ' + header.join('. '), start, 'table');
   pending.slice(2).forEach((row, index) => add('Row ' + (index + 1) + '. ' + cells(row).map((value, col) => (header[col] || 'Column ' + (col + 1)) + ': ' + value).join('. '), start + index + 2, 'table'));
  } else if (/^\s*\$\$/.test(raw)) {
   add('Mathematical notation. ' + raw.replace(/\$/g, '') + '. End mathematical notation.', start, 'math');
  } else {
   const image = /^\s*!\[/.test(raw);
   add((image ? 'Image description. ' : '') + raw, start, image ? 'image' : 'sentence');
  }
  paragraph++; pending = [];
 };
 let i = 0;
 if (lines[0] === '---') { i = 1; while (i < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[i])) i++; i++; }
 for (; i < lines.length; i++) {
  let line = lines[i];
  if (fence) {
   const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
   if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
    if (readCode) add('Code block. ' + code.join(' ') + '. End code block.', start, 'code'); else add('Code block skipped.', start, 'code');
    paragraph++; fence = '';
   } else code.push(line);
   continue;
  }
  if (inComment) { const end = line.indexOf('-->'); if (end < 0) continue; line = line.slice(end + 3); inComment = false; }
  const comment = line.indexOf('<!--');
  if (comment >= 0) { const end = line.indexOf('-->', comment); if (end >= 0) line = line.slice(0, comment) + line.slice(end + 3); else { line = line.slice(0, comment); inComment = true; } }
  const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()))) {
   flush();
   if (!fence) { fence = marker[1]; start = i; code = []; }
   else { if (readCode) add('Code block. ' + code.join(' ') + '. End code block.', start, 'code'); else add('Code block skipped.', start, 'code'); paragraph++; fence = ''; }
   continue;
  }
  if (fence) { code.push(line); continue; }
  const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
  const setext = !atx && i + 1 < lines.length && line.trim() && /^\s*(=+|-+)\s*$/.test(lines[i + 1]);
  if (atx || setext) {
   flush(); const level = atx ? atx[1].length : lines[i + 1].trim()[0] === '=' ? 1 : 2;
   const title = speechChunks(atx ? atx[2] : line).join(' ');
   while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
   stack.push({title, level});
   result.headings.push({title, level, index: result.segments.length, sourceLine: i});
   add('Heading level ' + level + '. ' + title, i, 'heading'); paragraph++;
   if (setext) i++;
  } else if (!line.trim()) flush();
  else { if (!pending.length) start = i; pending.push(line); }
 }
 flush();
 if (fence) { if (readCode) add('Code block. ' + code.join(' '), start, 'code'); else add('Code block skipped.', start, 'code'); }
 return result;
}

export function nextHeading(doc: ListeningDocument, index: number, backwards = false): number {
 const candidates = doc.headings.map(h => h.index).filter(i => backwards ? i < index : i > index);
 return candidates.length ? (backwards ? candidates[candidates.length - 1] : candidates[0]) : index;
}
