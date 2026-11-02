export interface ReadingFilters { skipCode: boolean; skipUrls: boolean; skipHeaders: boolean; skipFooters: boolean }
export const defaultFilters: ReadingFilters = {skipCode: true, skipUrls: true, skipHeaders: true, skipFooters: true};
/** Keep line counts stable so the outline and original source locations still align. */
export function filterReadingText(text: string, filters: ReadingFilters): string {
 const blank = (s: string) => s.replace(/[^\n]/g, '');
 let result = text.replace(/\r\n?/g, '\n');
 for (const kind of ['header','footer'] as const) {
  const skip = kind === 'header' ? filters.skipHeaders : filters.skipFooters;
  result = result.replace(new RegExp('^:::reader-' + kind + '\\s*\\n[\\s\\S]*?^:::\\s*$', 'gm'), value => skip ? blank(value) : value.replace(/^:::.*$/gm, ''));
  result = result.replace(new RegExp('<' + kind + '\\b[^>]*>[\\s\\S]*?<\\/' + kind + '\\s*>', 'gi'), value => skip ? blank(value) : value.replace(/<[^>]*>/g, ''));
 }
 if (filters.skipCode) {
  let fence = '', length = 0;
  result = result.split('\n').map(line => {
   const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
   if (fence) { if (marker && marker[1][0] === fence && marker[1].length >= length && !marker[2].trim()) fence = ''; return ''; }
   if (marker) { fence = marker[1][0]; length = marker[1].length; return ''; }
   if (/^(?: {4,}|\t+)\S/.test(line)) return '';
   return line.replace(/(`+)([^`]*?)\1/g, '');
  }).join('\n');
  result = result.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank);
 }
 if (!filters.skipUrls) result = result.replace(/\[([^\]]+)\]\(((?:https?:\/\/|ftp:\/\/|mailto:)[^)]*)\)/gi, '$1 $2').replace(/<((?:https?:\/\/|ftp:\/\/)[^>]+)>/gi, '$1');
 if (filters.skipUrls) {
  result = result.replace(/\[([^\]]+)\]\((?:https?:\/\/|ftp:\/\/|mailto:)[^)]*\)/gi, '$1')
   .replace(/(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>\])]+/gi, '')
   .replace(/mailto:[^\s<>]+/gi, '');
 }
 return result;
}
