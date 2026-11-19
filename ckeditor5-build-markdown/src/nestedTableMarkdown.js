import { turndownService } from '@ckeditor/ckeditor5-markdown-gfm/src/html2markdown/html2markdown';

// A GFM pipe-table row cannot contain literal line breaks or pipes inside its
// cells. Write nested cells as inline HTML, preserving the table structure,
// surrounding paragraphs, and formatting instead of converting to pipe rows.
turndownService.addRule('nestedTableCell', {
	filter: (node) => node.matches('td, th') && Boolean(node.querySelector('table')),
	replacement: (_content, cell) => {
		const prefix = cell.previousElementSibling ? ' ' : '| ';
		return prefix + serializeChildren(cell) + ' |';
	},
});

// Turndown checks for blank nodes before custom rules. CKEditor's figure
// wrapper may contain a real table even when every cell is still empty.
const blankRule = turndownService.rules.blankRule;
const defaultBlankReplacement = blankRule.replacement;
blankRule.replacement = (content, node, options) => {
	if (node.matches('figure.table') && node.querySelector('table')) {
		return '\n\n' + serializeNode(node) + '\n\n';
	}
	return defaultBlankReplacement(content, node, options);
};

function serializeChildren(element) {
	return Array.from(element.childNodes, serializeNode).join('');
}

function serializeNode(node) {
	if (node.nodeType === Node.TEXT_NODE) {
		// Prevent Markdown from reinterpreting text inside the inline HTML.
		return node.data.replace(/[&<>|\r\n\\`*_~\[\]]/g, (char) => '&#' + char.charCodeAt(0) + ';');
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return '';

	// CKEditor's wrapper is unnecessary in data. A bare HTML table also
	// matches the format used in existing register-map Description cells.
	if (node.matches('figure.table') && node.childNodes.length === 1 && node.firstChild.matches?.('table')) {
		return serializeNode(node.firstChild);
	}

	const shell = node.cloneNode(false).outerHTML.replace(/[|\r\n]/g, (char) => '&#' + char.charCodeAt(0) + ';');
	const closingTag = shell.lastIndexOf('</');
	if (closingTag < 0) return shell;
	return shell.slice(0, closingTag) + serializeChildren(node) + shell.slice(closingTag);
}
