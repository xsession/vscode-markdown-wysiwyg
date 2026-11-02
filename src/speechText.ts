/** Convert documentation to bounded speech chunks without speaking Markdown markup. */
export function speechChunks(markdown: string, readCode = false): string[] {
	let fence = '';
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	let frontmatter = lines[0] === '---';
	const clean = lines.map((line, index) => {
		if (frontmatter) {
			if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
			return '';
		}
		const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (marker) {
			if (!fence) fence = marker[1];
			else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
			return '';
		}
		if (fence && !readCode) return '';
		if (/^\s*\[[^\]]+\]:/.test(line) || /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) return '';
		return line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*>\s?/, '')
			.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '');
	}).join('\n').replace(/<!--[\s\S]*?-->/g, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
		.replace(/<https?:\/\/[^>]+>/g, '').replace(/<[^>]*>/g, '')
		.replace(/[`*_~]/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
	const chunks: string[] = [];
	for (const paragraph of clean.split(/\n\s*\n/)) {
		const words = paragraph.trim().split(/\s+/);
		let chunk = '';
		for (const word of words) {
			// Bound even unbroken tokens to keep synthesis requests small.
			for (let i = 0; i < word.length; i += 800) {
				const part = word.slice(i, i + 800);
				if (chunk.length + part.length + 1 > 800) { if (chunk) chunks.push(chunk); chunk = ''; }
				chunk += (chunk ? ' ' : '') + part;
			}
		}
		if (chunk) chunks.push(chunk);
	}
	return chunks;
}
