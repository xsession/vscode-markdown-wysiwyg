import ClassicEditorBase from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';
// CKEditor plugins
import Alignment from '@ckeditor/ckeditor5-alignment/src/alignment';
import Autoformat from '@ckeditor/ckeditor5-autoformat/src/autoformat';
import AutoImage from '@ckeditor/ckeditor5-image/src/autoimage';
import AutoLink from '@ckeditor/ckeditor5-link/src/autolink';
import BlockQuote from '@ckeditor/ckeditor5-block-quote/src/blockquote';
import Bold from '@ckeditor/ckeditor5-basic-styles/src/bold';
import Clipboard from '@ckeditor/ckeditor5-clipboard/src/clipboard';
import Code from '@ckeditor/ckeditor5-basic-styles/src/code';
import CodeBlock from '@ckeditor/ckeditor5-code-block/src/codeblock';
// import CodeBlock from '../ckeditor5-codeblock-with-syntax-highlight/src/codeblock';
import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials';
import Heading from '@ckeditor/ckeditor5-heading/src/heading';
import HorizontalLine from '@ckeditor/ckeditor5-horizontal-line/src/horizontalline';
import Image from '@ckeditor/ckeditor5-image/src/image';
import ImageCaption from '@ckeditor/ckeditor5-image/src/imagecaption';
import ImageInsert from '@ckeditor/ckeditor5-image/src/imageinsert';
// import ImageInsert from '../ckeditor5-insert-image-by-url/insertImageByUrl';
import ImageResize from '@ckeditor/ckeditor5-image/src/imageresize';
import ImageStyle from '@ckeditor/ckeditor5-image/src/imagestyle';
import ImageToolbar from '@ckeditor/ckeditor5-image/src/imagetoolbar';
import Indent from '@ckeditor/ckeditor5-indent/src/indent';
import Italic from '@ckeditor/ckeditor5-basic-styles/src/italic';
import Link from '@ckeditor/ckeditor5-link/src/link';
import List from '@ckeditor/ckeditor5-list/src/list';
import Markdown from '@ckeditor/ckeditor5-markdown-gfm/src/markdown';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import PasteFromOffice from '@ckeditor/ckeditor5-paste-from-office/src/pastefromoffice';
import SourceEditing from '@ckeditor/ckeditor5-source-editing/src/sourceediting';
import Strikethrough from '@ckeditor/ckeditor5-basic-styles/src/strikethrough';
import Subscript from '@ckeditor/ckeditor5-basic-styles/src/subscript';
import Superscript from '@ckeditor/ckeditor5-basic-styles/src/superscript';
import Table from '@ckeditor/ckeditor5-table/src/table';
import TableToolbar from '@ckeditor/ckeditor5-table/src/tabletoolbar';
import Underline from '@ckeditor/ckeditor5-basic-styles/src/underline';
import { ButtonView, Model, createDropdown, addListToDropdown } from '@ckeditor/ckeditor5-ui';
import { Collection } from '@ckeditor/ckeditor5-utils';

import './styles.css';
// import './github-markdown.css';

export default class MarkdownEditor extends ClassicEditorBase {}

// Take a list of commands as names or callbacks and execute them in order stopping on the first success.
// The returned function must be of form ( data, cancel ) => { ... }
// See https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editor-Editor.html#member-keystrokes
const attemptCommands =
	(commandNames, stopPropagation = true) =>
	(data, cancel) => {
		for (let commandName of commandNames) {
			if (typeof commandName === 'string') {
				const command = editor.commands.get(commandName);
				if (command?.isEnabled) {
					console.debug(`Executed command ${commandName}.`);
					command.execute();
				} else {
					console.debug(`Command ${commandName} is not enabled.`);
				}
			} else if (typeof commandName === 'function') {
				console.debug(`Executed command ${commandName.toString()}.`);
				commandName();
			}
			break;
		}
		if (stopPropagation) {
			cancel();
		}
	};

// Plugins to include in the build.
MarkdownEditor.builtinPlugins = [
	Alignment,
	Autoformat,
	AutoImage,
	AutoLink,
	BlockQuote,
	Bold,
	Clipboard,
	Code,
	CodeBlock,
	Essentials,
	Heading,
	HorizontalLine,
	Image,
	ImageCaption,
	ImageInsert,
	ImageResize,
	ImageStyle,
	ImageToolbar,
	Indent,
	Italic,
	Link,
	List,
	Markdown,
	Paragraph,
	PasteFromOffice,
	SourceEditing,
	Strikethrough,
	Subscript,
	Superscript,
	Table,
	TableToolbar,
	Underline,

	///////////////////////////////////////////////////////
	// Hotkeys
	///////////////////////////////////////////////////////

	function (editor) {
		// Set keyboard shortcuts.
		// See https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editingkeystrokehandler-EditingKeystrokeHandler.html#function-set

		editor.keystrokes.set('Tab', attemptCommands(['indent']));
		editor.keystrokes.set('Shift+Tab', attemptCommands(['outdent']));

		// We need to explicitly set this hotkey for pasting plain text.
		// Normally CKEditor relies on the browser to trigger this, but VS Code doesn't have a plain paste hotkey.
		// Recieving this in onDidReceiveMessage will run the paste command, and CKE5 detects shift is pressed and pastes as plaintext.
		// We can't just programmatically trigger a paste from here, this is impossible in modern browsers due to security considerations.
		editor.keystrokes.set(
			'Ctrl+Shift+V',
			attemptCommands(
				[
					() => {
						window.vscode.postMessage({ type: 'plainPaste' });
					},
				],
				true
			)
		);

		// Hotkeys for selecting headers. Ctrl+1 to Ctrl+6 for h1 to h6.
		for (const i of [1, 2, 3, 4, 5, 6]) {
			editor.keystrokes.set(
				`Ctrl+${i}`,
				attemptCommands([() => editor.execute('heading', { value: `heading${i}` })])
			);
		}

		editor.keystrokes.set(
			'Ctrl+Shift+1',
			attemptCommands([() => editor.execute('heading', { value: 'paragraph' })])
		);

		// There are already default shortcuts for bold, italic, underlink, hyperlink
		editor.keystrokes.set('Ctrl+Shift+C', attemptCommands([() => editor.execute('code')]));
		editor.keystrokes.set('Ctrl+Shift+Alt+C', attemptCommands([() => editor.execute('codeBlock')]));
		editor.keystrokes.set(
			'Ctrl+Shift+Alt+B',
			attemptCommands([() => editor.execute('quoteBlock')])
		);
		editor.keystrokes.set('Ctrl+Shift+B', attemptCommands([() => editor.execute('bulletedList')]));
		editor.keystrokes.set('Ctrl+Shift+n', attemptCommands([() => editor.execute('numberedList')]));
		editor.keystrokes.set('Ctrl+Shift+n', attemptCommands([() => editor.execute('numberedList')]));
		editor.keystrokes.set('Ctrl+Q', attemptCommands([() => editor.execute('bold')]));
	},

	///////////////////////////////////////////////////////
	// Code generation toolbar (second row): a generate
	// button, a template selector and an output format
	// selector. The user's selections are posted to the
	// extension host through window.vscode.postMessage
	// and the host pushes the workspace template list
	// back through window.markdownToolbar.
	///////////////////////////////////////////////////////

	function (editor) {
		const OUTPUT_FORMATS = [
			{ id: 'yaml', label: 'YAML (.yml)' },
			{ id: 'json', label: 'JSON (.json)' },
			{ id: 'toml', label: 'TOML (.toml)' },
			{ id: 'xml', label: 'XML (.xml)' },
			{ id: 'csv', label: 'CSV (.csv)' },
			{ id: 'tsv', label: 'TSV (.tsv)' },
			{ id: 'ini', label: 'INI (.ini)' },
			{ id: 'env', label: 'Environment (.env)' },
			{ id: 'properties', label: 'Java properties (.properties)' },
			{ id: 'html', label: 'HTML (.html)' },
			{ id: 'docx', label: 'Word (.docx)' }
		];

		const state = { templates: [], template: null, format: null };
		const generateButtons = [];
		const templateDropdowns = [];
		const formatDropdowns = [];

		const postMessage = (message) => {
			if (window.vscode) {
				window.vscode.postMessage(message);
			}
		};

		const formatById = (id) => OUTPUT_FORMATS.find((format) => format.id === id) || null;
		const templateByPath = (path) => state.templates.find((template) => template.path === path) || null;

		const updateGenerateButtons = () => {
			for (const buttonView of generateButtons) {
				buttonView.isEnabled = Boolean(state.template && state.format);
			}
		};

		const updateTemplateDropdowns = () => {
			const selected = templateByPath(state.template);
			for (const { dropdownView, items } of templateDropdowns) {
				items.clear();
				if (state.templates.length === 0) {
					items.add({
						type: 'button',
						model: new Model({
							label: 'No templates found in workspace',
							withText: true,
							isEnabled: false
						})
					});
				}
				for (const template of state.templates) {
					items.add({
						type: 'button',
						model: new Model({
							label: template.name,
							withText: true,
							isOn: template.path === state.template,
							templatePath: template.path
						})
					});
				}
				dropdownView.buttonView.label = selected ? selected.name : 'Template';
				dropdownView.buttonView.withText = Boolean(selected);
				dropdownView.buttonView.isEnabled = state.templates.length > 0;
			}
		};

		const updateFormatDropdowns = () => {
			const selected = formatById(state.format);
			for (const { dropdownView, items } of formatDropdowns) {
				// Rebuild the list so the selection highlight always derives
				// from state (bundled Model instances don't expose .get()).
				items.clear();
				for (const format of OUTPUT_FORMATS) {
					items.add({
						type: 'button',
						model: new Model({
							label: format.label,
							withText: true,
							isOn: format.id === state.format,
							formatId: format.id
						})
					});
				}
				dropdownView.buttonView.label = selected ? selected.label : 'Format';
				dropdownView.buttonView.withText = Boolean(selected);
			}
		};

		const applyTemplate = (path) => {
			state.template = path;
			const chosen = templateByPath(path);
			if (chosen && chosen.format && formatById(chosen.format)) {
				state.format = chosen.format;
			}
			updateTemplateDropdowns();
			updateFormatDropdowns();
			updateGenerateButtons();
		};

		// Public webview API used by the extension host messages (see
		// markdownEditorInitScript.js).
		window.markdownToolbar = {
			getState: () => ({
				template: state.template,
				format: state.format,
				templates: state.templates.slice()
			}),
			setTemplates: (templates) => {
				state.templates = Array.isArray(templates)
					? templates.filter((template) => template && typeof template.path === 'string')
					: [];
				if (state.template && !templateByPath(state.template)) {
					state.template = null;
				}
				updateTemplateDropdowns();
				updateGenerateButtons();
			},
			setTemplate: (path) => {
				if (templateByPath(path)) {
					applyTemplate(path);
					postMessage({ type: 'templateSelected', template: path, format: state.format });
				}
			},
			setFormat: (format) => {
				if (formatById(format)) {
					state.format = format;
					updateFormatDropdowns();
					updateGenerateButtons();
					postMessage({ type: 'formatSelected', format });
				}
			}
		};

		editor.ui.componentFactory.add('generateCode', (locale) => {
			const buttonView = new ButtonView(locale);
			buttonView.set({
				label: 'Generate',
				icon: GENERATOR_ICON,
				tooltip: 'Generate output from Markdown',
				isEnabled: false
			});
			editor.listenTo(buttonView, 'execute', () => {
				postMessage({ type: 'generateRequest', template: state.template, format: state.format });
			});
			generateButtons.push(buttonView);
			return buttonView;
		});

		editor.ui.componentFactory.add('templateSelector', (locale) => {
			const items = new Collection();
			const dropdownView = createDropdown(locale);
			addListToDropdown(dropdownView, items);
			dropdownView.buttonView.set({
				label: 'Template',
				icon: TEMPLATE_ICON,
				tooltip: 'Template',
				isEnabled: false
			});
			editor.listenTo(dropdownView, 'execute', (evt) => {
				const path = evt.source.templatePath;
				applyTemplate(path);
				postMessage({ type: 'templateSelected', template: path, format: state.format });
			});
			templateDropdowns.push({ dropdownView, items });
			updateTemplateDropdowns();
			return dropdownView;
		});

		editor.ui.componentFactory.add('outputFormat', (locale) => {
			const items = new Collection();
			const dropdownView = createDropdown(locale);
			addListToDropdown(dropdownView, items);
			dropdownView.buttonView.set({
				label: 'Format',
				icon: FORMAT_ICON,
				tooltip: 'Output file format'
			});
			editor.listenTo(dropdownView, 'execute', (evt) => {
				state.format = evt.source.formatId;
				postMessage({ type: 'formatSelected', format: state.format });
				updateFormatDropdowns();
				updateGenerateButtons();
			});
			formatDropdowns.push({ dropdownView, items });
			updateFormatDropdowns();
			return dropdownView;
		});
	},
];

const GENERATOR_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 2a1 1 0 0 1 1-1h6.086a1.5 1.5 0 0 1 1.06.44l2.414 2.414A1.5 1.5 0 0 1 13.5 5.914V18a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V2zm1 .906V18h9V6.086L9.086 2.906H2.5z"/><path d="m12.3 8.7 4.2 3.3-4.2 3.3-.9-1.1 2.5-2.2-2.5-2.2.9-1.1z"/></svg>';
const TEMPLATE_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M11 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7l-7-6z" opacity=".4"/><path d="M11 1v6h6l-6-6z"/><path d="M5 10.5h10V12H5v-1.5zm0 3.3h10v1.5H5v-1.5zM5 17.1h6V18.6H5v-1.5z"/></svg>';
const FORMAT_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 1l4.5 4.5H12.5V10h-5V5.5H5.5L10 1z" opacity=".55"/><path d="M2 12.5h16V14H2v-1.5zm0 3.2h16v3.3H2v-3.3z"/></svg>';

// Editor configuration.
MarkdownEditor.defaultConfig = {
	toolbar: {
		items: [
			'heading',
			'|',
			'bold',
			'italic',
			'underline',
			'strikethrough',
			'code',
			'|',
			'bulletedList',
			'numberedList',
			'blockQuote',
			'codeBlock',
			'|',
			'link',
			'insertImage',
			'insertTable',
			'horizontalLine',
			// '-' is a toolbar line break: it starts the second toolbar row.
			// It only works when shouldNotGroupWhenFull is true.
			'-',
			'generateCode',
			'|',
			'templateSelector',
			'outputFormat'
		],
		shouldNotGroupWhenFull: true
	},
	image: {
		toolbar: ['imageStyle:full', 'imageStyle:side', '|', 'imageTextAlternative'],
	},
	table: {
		contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'],
	},
	heading: {
		options: [
			{ model: 'paragraph', title: 'Paragraph' },
			{ model: 'heading1', view: 'h1', title: 'Heading 1' },
			{ model: 'heading2', view: 'h2', title: 'Heading 2' },
			{ model: 'heading3', view: 'h3', title: 'Heading 3' },
			{ model: 'heading4', view: 'h4', title: 'Heading 4' },
			{ model: 'heading5', view: 'h5', title: 'Heading 5' },
			{ model: 'heading6', view: 'h6', title: 'Heading 6' },
		],
	},
	codeBlock: {
		languages: [
			{ language: '', label: 'Plain text' },
			{ language: 'c', label: 'C' },
			{ language: 'cs', label: 'C#' },
			{ language: 'cpp', label: 'C++' },
			{ language: 'css', label: 'CSS' },
			{ language: 'diff', label: 'Diff' },
			{ language: 'html', label: 'HTML' },
			{ language: 'javascript', label: 'JavaScript' },
			{ language: 'python', label: 'Python' },
			{ language: 'typescript', label: 'TypeScript' },
			{ language: 'xml', label: 'XML' },
		],
	},
	// This value must be kept in sync with the language defined in webpack.config.js.
	language: 'en',
};
