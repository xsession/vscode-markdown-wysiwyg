"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readableImport = exports.importDocument = exports.pdfPagesToMarkdown = exports.htmlToMarkdown = exports.isSupportedDocument = exports.pdfAssetPaths = exports.documentGlob = exports.documentExtensions = void 0;
const path = require("path");
const readingFilters_1 = require("./readingFilters");
exports.documentExtensions = ['md', 'markdown', 'mdown', 'txt', 'text', 'html', 'htm', 'xhtml', 'pdf', 'docx', 'odt', 'epub', 'rtf', 'rst', 'rest', 'adoc', 'asciidoc'];
exports.documentGlob = '**/*.{' + exports.documentExtensions.join(',') + '}';
const MAX_EXPANDED = 64 * 1024 * 1024;
const MAX_TEXT = 8 * 1024 * 1024;
/** PDF.js Node factories need filesystem paths with a literal trailing slash.
 * Do not percent-encode spaces or other filename characters.
 */
function pdfAssetPaths(directory) {
    const backslash = String.fromCharCode(92);
    const windows = /^[A-Za-z]:/.test(directory) || directory.startsWith(backslash + backslash) || directory.startsWith('//');
    const join = windows ? path.win32.join : path.posix.join;
    const asset = (name) => {
        const value = join(directory, name);
        return (windows ? value.split(backslash).join('/') : value) + '/';
    };
    return { cMapUrl: asset('cmaps'), standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm') };
}
exports.pdfAssetPaths = pdfAssetPaths;
function isSupportedDocument(name) { return exports.documentExtensions.includes(path.extname(name).slice(1).toLowerCase()); }
exports.isSupportedDocument = isSupportedDocument;
function guardText(text) { if (text.length > MAX_TEXT)
    throw new Error('Extracted document exceeds the 8 MiB text limit. Split the document.'); return text; }
function textDecode(data) {
    if (data[0] === 0xff && data[1] === 0xfe)
        return data.slice(2).toString('utf16le');
    if (data[0] === 0xfe && data[1] === 0xff) {
        const copy = Buffer.from(data.slice(2));
        copy.swap16();
        return copy.toString('utf16le');
    }
    return data.toString('utf8').replace(/^\uFEFF/, '');
}
// Parse only. No scripts, styles, remote resources, attachments or embedded objects execute.
function htmlToMarkdown(html) {
    const { parseDocument } = require('htmlparser2');
    const tree = parseDocument(html, { decodeEntities: true });
    const visit = (node) => {
        if (node.type === 'text')
            return node.data;
        const tag = (node.name || '').toLowerCase(), attrs = node.attribs || {};
        if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'noscript', 'template'].includes(tag))
            return '';
        const children = () => (node.children || []).map(visit).join('');
        const kind = tag === 'header' || attrs.role === 'banner' ? 'header' : tag === 'footer' || attrs.role === 'contentinfo' ? 'footer' : '';
        if (kind)
            return '\n\n:::reader-' + kind + '\n' + children().trim() + '\n:::\n\n';
        if (tag === 'pre' || (['p', 'div'].includes(tag) && /font-family[^;]*(courier|monospace|consolas)/i.test(attrs.style || '')))
            return '\n\n````\n' + children().trim().replace(/`{4,}/g, '```') + '\n````\n\n';
        if (tag === 'code' || (tag === 'span' && /font-family[^;]*(courier|monospace|consolas)/i.test(attrs.style || '')))
            return '`' + children().replace(/`/g, '') + '`';
        if (/^h[1-6]$/.test(tag))
            return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + children().replace(/\s+/g, ' ').trim() + '\n\n';
        if (tag === 'br')
            return '\n';
        if (tag === 'img')
            return attrs.alt ? ' Image: ' + attrs.alt + ' ' : '';
        if (tag === 'a') {
            const label = children();
            return attrs.href && (/^(https?:\/\/|ftp:\/\/|mailto:)/i.test(attrs.href) || (!/^[a-z]+:/i.test(attrs.href) && isSupportedDocument(attrs.href.split(/[?#]/)[0]))) ? '[' + label + '](' + attrs.href.replace(/[\r\n()]/g, '') + ')' : label;
        }
        if (tag === 'li')
            return '\n- ' + children().trim() + '\n';
        if (tag === 'tr')
            return '\n' + children().trim() + '\n';
        if (tag === 'td' || tag === 'th')
            return children().trim() + '. ';
        if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'dl', 'dt', 'dd', 'table'].includes(tag))
            return '\n\n' + children().trim() + '\n\n';
        return children();
    };
    return guardText(visit(tree).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
}
exports.htmlToMarkdown = htmlToMarkdown;
function unzip(data) {
    const { unzipSync } = require('fflate');
    let expanded = 0, entries = 0;
    return unzipSync(data, { filter: (entry) => {
            expanded += entry.originalSize;
            entries++;
            if (expanded > MAX_EXPANDED || entries > 10000)
                throw new Error('Archive exceeds document expansion limits.');
            return true;
        } });
}
function xml(data) { return require('htmlparser2').parseDocument(Buffer.from(data).toString('utf8'), { xmlMode: true, decodeEntities: true }); }
function descendants(root, name) { const found = []; const visit = (n) => { if (n.name === name)
    found.push(n); for (const c of n.children || [])
    visit(c); }; visit(root); return found; }
function xmlText(n) { var _a; if (n.type === 'text')
    return n.data; if (n.name === 'text:s')
    return ' '.repeat(Math.min(100, Number((_a = n.attribs) === null || _a === void 0 ? void 0 : _a['text:c']) || 1)); if (n.name === 'text:tab')
    return '\t'; if (n.name === 'text:line-break' || n.name === 'w:br')
    return '\n'; return (n.children || []).map(xmlText).join(''); }
function zipText(files, name) { if (!files[name])
    throw new Error('Missing archive entry: ' + name); return Buffer.from(files[name]).toString('utf8'); }
function pdfPagesToMarkdown(pages) {
    // Only repeated outer lines count as running headers/footers; section headings remain.
    const key = (s) => s.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ').toLowerCase();
    const rows = pages.map(p => p.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    const top = new Map(), bottom = new Map();
    for (const lines of rows) {
        for (const k of new Set(lines.slice(0, 1).map(key)))
            top.set(k, (top.get(k) || 0) + 1);
        for (const k of new Set(lines.slice(-1).map(key)))
            bottom.set(k, (bottom.get(k) || 0) + 1);
    }
    const minimum = Math.max(2, Math.ceil(pages.length * .6));
    return rows.map((lines, i) => '# Page ' + pages[i].num + '\n\n' + lines.map((line, j) => {
        const head = lines.length >= 3 && j === 0 && (top.get(key(line)) || 0) >= minimum;
        const foot = lines.length >= 3 && j === lines.length - 1 && (bottom.get(key(line)) || 0) >= minimum;
        return head ? ':::reader-header\n' + line + '\n:::\n' : foot ? ':::reader-footer\n' + line + '\n:::\n' : line + '\n';
    }).join('\n')).join('\n\n');
}
exports.pdfPagesToMarkdown = pdfPagesToMarkdown;
function rstToMarkdown(text) {
    const lines = text.split(/\r?\n/), out = [];
    const levels = new Map();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i], next = lines[i + 1] || '';
        const directive = /^\.\.\s+(code(?:-block)?|sourcecode|header|footer)::\s*(.*)$/.exec(line);
        if (directive) {
            const block = [];
            i++;
            while (i < lines.length && (!lines[i].trim() || /^\s/.test(lines[i]))) {
                if (!/^\s*:\w[^:]*:/.test(lines[i]))
                    block.push(lines[i].replace(/^ {1,4}/, ''));
                i++;
            }
            i--;
            out.push(directive[1] === 'header' || directive[1] === 'footer' ? ':::reader-' + directive[1] + '\n' + block.join('\n') + '\n:::' : '```' + directive[2] + '\n' + block.join('\n') + '\n```');
            continue;
        }
        if (line.trim() && /^([=~`^"+#*-])\1{2,}\s*$/.test(next) && next.trim().length >= line.trim().length) {
            const k = next.trim()[0];
            if (!levels.has(k))
                levels.set(k, Math.min(6, levels.size + 1));
            out.push('#'.repeat(levels.get(k)) + ' ' + line);
            out.push('');
            i++;
        }
        else if (/^\.\.\s+(include|raw)::/.test(line)) {
            out.push('');
            while (i + 1 < lines.length && (!lines[i + 1].trim() || /^\s/.test(lines[i + 1])))
                i++;
        }
        else
            out.push(line.replace(/`([^`]+)\s+<(https?:\/\/[^>]+)>`_/g, '[$1]($2)').replace(/``([^`]+)``/g, '`$1`'));
    }
    return out.join('\n');
}
function asciidocToMarkdown(text) {
    let delimiter = '', code = false;
    const result = [];
    for (const line of text.split(/\r?\n/)) {
        if (/^\[(source|listing)(?:,.*)?\]\s*$/.test(line)) {
            code = true;
            continue;
        }
        if (/^(----|\.\.\.\.)\s*$/.test(line)) {
            if (!delimiter) {
                delimiter = line.trim();
                result.push('```');
            }
            else if (line.trim() === delimiter) {
                delimiter = '';
                code = false;
                result.push('```');
            }
            else
                result.push(line);
            continue;
        }
        if (delimiter) {
            result.push(line);
            continue;
        }
        if (/^include::/.test(line) || /^:[^:]+:/.test(line)) {
            result.push('');
            continue;
        }
        result.push(line.replace(/^(={1,6})\s+/, (_, marks) => '#'.repeat(marks.length) + ' ').replace(/(https?:\/\/[^\s\[]+)\[([^\]]*)\]/g, '[$2]($1)'));
    }
    if (delimiter)
        result.push('```');
    return result.join('\n');
}
async function rtfToMarkdown(source) {
    const convert = (text) => new Promise((resolve, reject) => require('@iarna/rtf-to-html').fromString(text.replace(/}\s*$/, () => String.fromCharCode(92) + 'par}'), (error, html) => error ? reject(error) : resolve(htmlToMarkdown(html))));
    const pattern = /\{\\(header|footer)(?:[lrf])?\b/g;
    const regions = [];
    let match;
    while ((match = pattern.exec(source))) {
        let depth = 1, end = pattern.lastIndex;
        for (; end < source.length && depth; end++) {
            if (source[end] === '\\' && ['\\', '{', '}'].includes(source[end + 1])) {
                end++;
                continue;
            }
            if (source[end] === '{')
                depth++;
            if (source[end] === '}')
                depth--;
        }
        if (depth)
            throw new Error('Malformed RTF header/footer group.');
        regions.push({ start: match.index, end, kind: match[1], text: source.slice(pattern.lastIndex, end - 1) });
        pattern.lastIndex = end;
    }
    let body = '', offset = 0;
    for (const region of regions) {
        body += source.slice(offset, region.start);
        offset = region.end;
    }
    body += source.slice(offset);
    const pieces = [await convert(body)];
    for (const region of regions) {
        const slash = String.fromCharCode(92);
        pieces.push('\n\n:::reader-' + region.kind + '\n' + await convert('{' + slash + 'rtf1' + slash + 'ansi ' + region.text + '}') + '\n:::');
    }
    return pieces.join('\n\n');
}
async function importDocument(data, filename) {
    var _a, _b;
    const ext = path.extname(filename).slice(1).toLowerCase(), warnings = [];
    let markdown = '', format = ext, extracted = !['md', 'markdown', 'mdown', 'txt', 'text'].includes(ext);
    if (['md', 'markdown', 'mdown'].includes(ext)) {
        format = 'Markdown';
        markdown = textDecode(data);
    }
    else if (['txt', 'text'].includes(ext)) {
        format = 'Plain text';
        markdown = textDecode(data).replace(/^(\s{0,3})#/gm, '$1\\#');
    }
    else if (['html', 'htm', 'xhtml'].includes(ext)) {
        format = 'HTML';
        markdown = htmlToMarkdown(textDecode(data));
    }
    else if (['rst', 'rest'].includes(ext)) {
        format = 'reStructuredText';
        markdown = rstToMarkdown(textDecode(data));
    }
    else if (['adoc', 'asciidoc'].includes(ext)) {
        format = 'AsciiDoc';
        markdown = asciidocToMarkdown(textDecode(data));
    }
    else if (ext === 'pdf') {
        if (!global.DOMMatrix)
            global.DOMMatrix = require('@thednp/dommatrix');
        const { PDFParse } = require('pdf-parse');
        const pdfAssets = require('../media/documentParserAssets.cjs').assetDirectory;
        const parser = new PDFParse({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, ...pdfAssetPaths(pdfAssets) });
        try {
            const result = await parser.getText({ pageJoiner: '', lineEnforce: true });
            markdown = pdfPagesToMarkdown(result.pages.map((p) => ({ text: p.text, num: p.num })));
            if (!result.pages.some((p) => p.text.trim()))
                throw new Error('No PDF text layer. Scanned/image-only PDFs need OCR first.');
            warnings.push('PDF headers/footers use repeated page-edge text; reading order depends on the PDF text layer.');
        }
        finally {
            await parser.destroy();
        }
    }
    else if (ext === 'docx') {
        format = 'DOCX';
        const files = unzip(data); // Reject archive bombs before calling Mammoth.
        const mammoth = require('mammoth');
        const converted = await mammoth.convertToHtml({ buffer: data }, { externalFileAccess: false, convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '', alt: '' })), styleMap: ["p[style-name='Code'] => pre:fresh", "p[style-name='Source Code'] => pre:fresh"] });
        const body = htmlToMarkdown(converted.value);
        const headers = [], footers = [];
        for (const name of Object.keys(files).sort())
            if (/^word\/(header|footer)\d+\.xml$/.test(name)) {
                const content = descendants(xml(files[name]), 'w:p').map(xmlText).join('\n');
                (name.includes('header') ? headers : footers).push(content);
            }
        markdown = (headers.length ? ':::reader-header\n' + headers.join('\n') + '\n:::\n\n' : '') + body + (footers.length ? '\n\n:::reader-footer\n' + footers.join('\n') + '\n:::' : '');
        warnings.push(...converted.messages.map((m) => m.message));
    }
    else if (ext === 'odt') {
        format = 'ODT';
        const files = unzip(data), tree = xml(files['content.xml'] || Buffer.from(zipText(files, 'content.xml')));
        const visit = (n) => { var _a, _b; const name = n.name; if (name === 'text:h')
            return '\n\n' + '#'.repeat(Math.min(6, Math.max(1, Number((_a = n.attribs) === null || _a === void 0 ? void 0 : _a['text:outline-level']) || 1))) + ' ' + xmlText(n) + '\n\n'; if (name === 'text:p') {
            const t = xmlText(n);
            return /code|source|preformatted/i.test(((_b = n.attribs) === null || _b === void 0 ? void 0 : _b['text:style-name']) || '') ? '\n\n```\n' + t + '\n```\n\n' : '\n\n' + t + '\n\n';
        } return (n.children || []).map(visit).join(''); };
        markdown = visit(tree);
        if (files['styles.xml']) {
            const styles = xml(files['styles.xml']);
            for (const kind of ['header', 'footer'])
                for (const n of descendants(styles, 'style:' + kind))
                    markdown += '\n\n:::reader-' + kind + '\n' + xmlText(n) + '\n:::\n';
        }
    }
    else if (ext === 'epub') {
        format = 'EPUB';
        const files = unzip(data);
        if (files['META-INF/encryption.xml'])
            throw new Error('Encrypted/DRM EPUB is not supported.');
        const container = xml(Buffer.from(zipText(files, 'META-INF/container.xml'))), opf = (_b = (_a = descendants(container, 'rootfile')[0]) === null || _a === void 0 ? void 0 : _a.attribs) === null || _b === void 0 ? void 0 : _b['full-path'];
        if (!opf)
            throw new Error('EPUB package is missing.');
        const pack = xml(Buffer.from(zipText(files, opf))), items = new Map();
        for (const n of descendants(pack, 'item'))
            items.set(n.attribs.id, n.attribs.href);
        const chapters = [];
        for (const ref of descendants(pack, 'itemref')) {
            if (ref.attribs.linear === 'no')
                continue;
            const href = items.get(ref.attribs.idref);
            if (!href)
                continue;
            const name = path.posix.normalize(path.posix.join(path.posix.dirname(opf), decodeURIComponent(href.split('#')[0])));
            if (name.startsWith('../') || name.startsWith('/'))
                throw new Error('Invalid EPUB chapter path.');
            chapters.push(htmlToMarkdown(zipText(files, name)));
        }
        markdown = chapters.join('\n\n');
    }
    else if (ext === 'rtf') {
        format = 'RTF';
        markdown = await rtfToMarkdown(data.toString('latin1'));
        warnings.push('RTF formatting support is best effort; some producers omit structural header/footer information.');
    }
    else
        throw new Error('Unsupported document format: ' + ext);
    return { markdown: guardText(markdown), format, extracted, warnings };
}
exports.importDocument = importDocument;
function readableImport(document, filters = readingFilters_1.defaultFilters) { return (0, readingFilters_1.filterReadingText)(document.markdown, filters); }
exports.readableImport = readableImport;
//# sourceMappingURL=documentFormats.js.map