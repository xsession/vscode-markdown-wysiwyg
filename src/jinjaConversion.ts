import * as path from 'path';
import { safeLoad } from 'js-yaml';
import { extensionForFormat } from './codeGenerator';
import { renderTemplate, splitTemplateFile, TemplateError } from './jinjaTemplate';
import { buildMarkdownContext } from './markdownTables';

const formatAliases = new Map([['yml', 'yaml'], ['htm', 'html'], ['md', 'markdown']]);

export function normalizeOutputFormat(format: string): string {
	const name = format.trim().toLowerCase();
	return formatAliases.get(name) ?? name;
}

function filenameExtension(filename: string): string {
	const ext = path.extname(filename);
	return ext ? ext.slice(1) : /^\.[^.]+$/.test(filename) ? filename.slice(1) : '';
}

export function renderJinjaConversion(template: string, source: string, sourceName: string, override?: string) {
	const { metadata, params, body } = splitTemplateFile(template);
	if (!body.trim()) throw new TemplateError('The template has no Jinja body.');

	const declaredFormat = normalizeOutputFormat(metadata.format || 'yaml');
	const format = normalizeOutputFormat(override ?? declaredFormat);
	if (!/^[a-z0-9_-]+$/.test(format)) throw new TemplateError('Choose a valid output format.');
	if (format === 'docx') throw new TemplateError('Choose a table-template mapping to generate a Word document.');

	const name = path.basename(sourceName);
	const declaredName = metadata.output ? path.posix.basename(metadata.output.replace(/\\/g, '/')) : '';
	const suffix = filenameExtension(declaredName);
	const outputName = declaredName && normalizeOutputFormat(suffix) === format
		? declaredName
		: (declaredName || name).replace(/\.[^.]+$/, '') + '.' + extensionForFormat(format);

	const context = buildMarkdownContext(source, name);
	context.params = params;
	const output = renderTemplate(body, context);
	if (metadata.example_generated === 'true') {
		try {
			if (declaredFormat === 'json') JSON.parse(output);
			if (declaredFormat === 'yaml') safeLoad(output);
		} catch (error) {
			throw new TemplateError('The example-derived template rendered invalid ' + declaredFormat.toUpperCase() + ': ' +
				(error instanceof Error ? error.message : String(error)));
		}
	}
	return { metadata, format, outputName, output };
}
