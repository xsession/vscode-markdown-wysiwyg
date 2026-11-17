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
	// button, a template button and an output format
	// selector. The Template button opens the extension
	// host's native file browser for a Jinja conversion
	// template; selections are posted to the extension
	// host through window.vscode.postMessage, and the
	// host pushes state back through
	// window.markdownToolbar.
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

		const state = { templates: [], template: null, templateName: null, format: null, outputFolder: null };
		const generateButtons = [];
		const templateButtons = [];
		const formatDropdowns = [];
		const outputFolderButtons = [];

		const postMessage = (message) => {
			if (window.vscode) {
				window.vscode.postMessage(message);
			}
		};

		const formatById = (id) => OUTPUT_FORMATS.find((format) => format.id === id) || null;

		const updateGenerateButtons = () => {
			for (const buttonView of generateButtons) {
				buttonView.isEnabled = Boolean(state.template && state.format);
			}
		};

		const updateTemplateButtons = () => {
			for (const buttonView of templateButtons) {
				buttonView.label = state.templateName || 'Template';
				buttonView.withText = Boolean(state.template);
				// Always clickable: it opens the native file browser.
				buttonView.isEnabled = true;
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

		// Public webview API used by the extension host messages (see
		// markdownEditorInitScript.js).
		window.markdownToolbar = {
			getState: () => ({
				template: state.template,
				format: state.format,
				templates: state.templates.slice(),
				outputFolder: state.outputFolder
			}),
			setTemplates: (templates) => {
				state.templates = Array.isArray(templates)
					? templates.filter((template) => template && typeof template.path === 'string')
					: [];
				updateGenerateButtons();
			},
			// Generalized: (path) keeps the legacy call shape; (path, name,
			// format) is used after the Template button's file browser picks a
			// Jinja template (the extension host sends 'templatePicked').
			setTemplate: (path, name, format) => {
				if (typeof path !== 'string' || path === '') {
					return;
				}
				state.template = path;
				state.templateName =
					typeof name === 'string' && name !== '' ? name : path.split(/[\\/]/).pop();
				if (format && formatById(format)) {
					state.format = format;
					updateFormatDropdowns();
				}
				updateTemplateButtons();
				updateGenerateButtons();
				postMessage({ type: 'templateSelected', template: path, format: state.format });
			},
			setFormat: (format) => {
				if (formatById(format)) {
					state.format = format;
					updateFormatDropdowns();
					updateGenerateButtons();
					postMessage({ type: 'formatSelected', format });
				}
			},
			setOutputFolder: (folder) => {
				state.outputFolder = typeof folder === 'string' && folder !== '' ? folder : null;
				for (const buttonView of outputFolderButtons) {
					buttonView.label = state.outputFolder ? state.outputFolder : 'Output folder';
					buttonView.tooltip = state.outputFolder
						? 'Generated files go to: ' + state.outputFolder + ' (click to change)'
						: 'Choose the folder where generated files are written';
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

		// The Template button opens the extension host's native file browser
		// (see markdownEditor.ts pickTemplate). The picked Jinja template's
		// name (and declared output format) are pushed back through
		// window.markdownToolbar.setTemplate.
		editor.ui.componentFactory.add('templateSelector', (locale) => {
			const buttonView = new ButtonView(locale);
			buttonView.set({
				label: 'Template',
				icon: TEMPLATE_ICON,
				tooltip: 'Choose a conversion template (Jinja file)'
			});
			editor.listenTo(buttonView, 'execute', () => {
				postMessage({ type: 'pickTemplate' });
			});
			templateButtons.push(buttonView);
			updateTemplateButtons();
			return buttonView;
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

		editor.ui.componentFactory.add('pickOutputFolder', (locale) => {
			const buttonView = new ButtonView(locale);
			buttonView.set({
				label: 'Output folder',
				withText: true,
				icon: OUTPUT_FOLDER_ICON,
				tooltip: 'Choose the folder where generated files are written'
			});
			editor.listenTo(buttonView, 'execute', () => {
				postMessage({ type: 'pickOutputFolder' });
			});
			outputFolderButtons.push(buttonView);
			return buttonView;
		});

		// Document action buttons: they ask the extension host to run the
		// matching VS Code command on the document this editor shows.
		const commandButtons = [
			{ name: 'mindmap', command: 'markdownEditor.documentation.mindmap', label: 'Documentation mind map', icon: MINDMAP_ICON },
			{ name: 'readAloud', command: 'markdownEditor.readAloud', label: 'Read document aloud', icon: SPEAKER_ICON },
			{ name: 'openDocument', command: 'markdownEditor.documentation.open', label: 'Open document in documentation view', icon: OPEN_DOCUMENT_ICON },
			{ name: 'listenDocument', command: 'markdownEditor.documentation.listen', label: 'Listen to document', icon: LISTEN_ICON }
		];
		for (const { name, command, label, icon } of commandButtons) {
			editor.ui.componentFactory.add(name, (locale) => {
				const buttonView = new ButtonView(locale);
				buttonView.set({ label, icon, tooltip: label });
				editor.listenTo(buttonView, 'execute', () => {
					postMessage({ type: 'executeCommand', command });
				});
				return buttonView;
			});
		}
	},
];

const GENERATOR_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 2a1 1 0 0 1 1-1h6.086a1.5 1.5 0 0 1 1.06.44l2.414 2.414A1.5 1.5 0 0 1 13.5 5.914V18a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V2zm1 .906V18h9V6.086L9.086 2.906H2.5z"/><path d="m12.3 8.7 4.2 3.3-4.2 3.3-.9-1.1 2.5-2.2-2.5-2.2.9-1.1z"/></svg>';
const TEMPLATE_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M11 1H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7l-7-6z" opacity=".4"/><path d="M11 1v6h6l-6-6z"/><path d="M5 10.5h10V12H5v-1.5zm0 3.3h10v1.5H5v-1.5zM5 17.1h6V18.6H5v-1.5z"/></svg>';
const FORMAT_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 1l4.5 4.5H12.5V10h-5V5.5H5.5L10 1z" opacity=".55"/><path d="M2 12.5h16V14H2v-1.5zm0 3.2h16v3.3H2v-3.3z"/></svg>';
const OUTPUT_FOLDER_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M2 4a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/><path d="M10 10v5m-2.5-2.5h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
// Same geometry as media/mindmap-light.svg, scaled 24 -> 20.
const MINDMAP_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.33"/><circle cx="3.33" cy="6.67" r="1.67"/><path d="M13.33 10h2.5M4.67 6.67h2.5M12.33 12.33l2.17 2.17"/></svg>';
const SPEAKER_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M3 7v6h4l5 4V3L7 7H3z"/><path d="M13.6 7.2c1 .9 1.7 2 2 3.3l2-.5c-.4-1.7-1.4-3.2-2.7-4.2l-1.3 1.4z" opacity=".55"/><path d="M14.6 5.1c1.9 1.3 3.2 3.3 3.6 5.5l-.1.4-2-.5c.1-.4.1-.9 0-1.3-.3-1.7-1.2-3.2-2.5-4.2l1-1z" opacity=".35"/></svg>';
const OPEN_DOCUMENT_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M2 4a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" opacity=".35"/><path d="M5 14.5v-2.2l3-3 3 3v2.2H5z" opacity=".7"/><path d="M8.4 9.1l.6-.6 3 3-3 3-.6.6.2-2.6H6l2.4-2.4z"/></svg>';
const LISTEN_ICON =
	'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 2a7 7 0 0 0-7 7v5.5A1.5 1.5 0 0 0 4.5 16h1.7v-7H4.7v-.5A5.3 5.3 0 0 1 10 3.2a5.3 5.3 0 0 1 5.3 5.3v.5h-1.5v7h1.7a1.5 1.5 0 0 0 1.5-1.5V9a7 7 0 0 0-7-7z"/></svg>';

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
			'outputFormat',
			'pickOutputFolder',
			'|',
			'mindmap',
			'readAloud',
			'openDocument',
			'listenDocument'
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
