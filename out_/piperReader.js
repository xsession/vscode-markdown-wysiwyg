"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PiperReader = void 0;
const listeningWorkspace_1 = require("./listeningWorkspace");
const readingFilters_1 = require("./readingFilters");
const documentLoader_1 = require("./documentLoader");
const vscode = require("vscode");
const crypto_1 = require("crypto");
const listeningDocument_1 = require("./listeningDocument");
const speechEngine_1 = require("./speechEngine");
const readerHtml_1 = require("./readerHtml");
const emptyDocument = () => ({ segments: [], headings: [], words: 0 });
class PiperReader {
    constructor(voices, state, hooks = {}) {
        this.voices = voices;
        this.state = state;
        this.hooks = hooks;
        this.engineKey = '';
        this.audio = new Map();
        this.native = false;
        this.generation = 0;
        this.doc = emptyDocument();
        this.index = 0;
        this.seconds = 0;
        this.rate = 1;
        this.mode = 'continuous';
        this.stopped = true;
        this.autoStart = false;
        this.sourceText = '';
        this.originalSource = '';
        this.sourceIdentity = '';
        this.filters = { ...readingFilters_1.defaultFilters };
        this.identity = '';
        this.fingerprint = '';
        this.title = '';
        this.bookmarks = [];
        this.history = [];
    }
    notify(text) { this.send({ type: 'status', text }); }
    cancel(reset = true) {
        var _a;
        this.generation++;
        if (reset) {
            (_a = this.engine) === null || _a === void 0 ? void 0 : _a.dispose();
            this.engine = undefined;
            this.engineKey = '';
            this.audio.clear();
        }
    }
    dispose() { var _a; void this.save(); this.cancel(); (_a = this.panel) === null || _a === void 0 ? void 0 : _a.dispose(); this.panel = undefined; }
    async open(markdown, title, identity = title, autoStart = false, startLine) {
        var _a, _b, _c, _d, _e, _f, _g;
        if (!vscode.workspace.isTrusted)
            throw new Error('Trust this workspace before running Piper.');
        const previous = this.snapshot();
        await this.save();
        this.cancel();
        this.sourceIdentity = identity;
        this.originalSource = markdown;
        markdown = ((_b = (_a = this.hooks).prepareSource) === null || _b === void 0 ? void 0 : _b.call(_a, identity, markdown)) || markdown;
        this.title = title;
        this.identity = 'piper.session.' + (0, crypto_1.createHash)('sha256').update(identity).digest('hex');
        this.sourceText = markdown;
        this.filters = (0, documentLoader_1.configuredFilters)(this.state);
        this.fingerprint = (0, crypto_1.createHash)('sha256').update(markdown + JSON.stringify(this.filters)).digest('hex');
        this.doc = (0, listeningDocument_1.listeningDocument)((0, readingFilters_1.filterReadingText)(markdown, this.filters), !this.filters.skipCode);
        if (!this.doc.segments.length)
            throw new Error('No readable text in this document or selection.');
        const saved = (_c = this.state) === null || _c === void 0 ? void 0 : _c.get(this.identity);
        this.index = (saved === null || saved === void 0 ? void 0 : saved.fingerprint) === this.fingerprint ? Math.max(0, Math.min(saved.index, this.doc.segments.length - 1)) : 0;
        this.seconds = (saved === null || saved === void 0 ? void 0 : saved.fingerprint) === this.fingerprint ? Math.max(0, saved.seconds || 0) : 0;
        this.bookmarks = (saved === null || saved === void 0 ? void 0 : saved.fingerprint) === this.fingerprint ? saved.bookmarks.slice(0, 50) : [];
        this.rate = saved ? Math.max(0.5, Math.min(4, saved.rate || 1)) : 1;
        this.mode = ['continuous', 'outline', 'study'].includes((saved === null || saved === void 0 ? void 0 : saved.mode) || '') ? saved.mode : 'continuous';
        if (startLine !== undefined) {
            const i = this.doc.segments.findIndex(s => s.sourceLine >= startLine);
            this.index = i < 0 ? this.doc.segments.length - 1 : i;
            this.seconds = 0;
        }
        await ((_e = (_d = this.hooks).opened) === null || _e === void 0 ? void 0 : _e.call(_d, previous, this.snapshot()));
        this.history = [];
        this.stopped = true;
        this.autoStart = autoStart;
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel('markdownEditor.piperReader', 'Piper Reader', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
            this.panel.onDidDispose(() => { var _a, _b; void this.save(); this.cancel(); this.panel = undefined; void ((_b = (_a = vscode.commands).executeCommand) === null || _b === void 0 ? void 0 : _b.call(_a, 'setContext', 'markdownEditor.listenerActive', false)); });
            this.panel.webview.onDidReceiveMessage(message => this.message(message));
        }
        void ((_g = (_f = vscode.commands).executeCommand) === null || _g === void 0 ? void 0 : _g.call(_f, 'setContext', 'markdownEditor.listenerActive', true));
        this.panel.title = 'Piper: ' + title;
        this.panel.webview.html = (0, readerHtml_1.readerHtml)();
        this.panel.reveal(vscode.ViewColumn.Beside);
    }
    async message(message) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        try {
            if (message.type === 'ready') {
                await ((_b = (_a = this.hooks).action) === null || _b === void 0 ? void 0 : _b.call(_a, 'ready', {}));
                await this.sendVoices();
                this.sendDocument();
                if (this.autoStart) {
                    this.autoStart = false;
                    this.stopped = false;
                    await this.speak();
                }
                return;
            }
            if (message.type === 'projectAction' && typeof message.action === 'string') {
                await ((_d = (_c = this.hooks).action) === null || _d === void 0 ? void 0 : _d.call(_c, message.action, message));
                return;
            }
            if (message.type === 'setup' && this.voices) {
                await this.voices.setup();
                return;
            }
            if (message.type === 'license' && this.voices && typeof message.key === 'string') {
                await this.voices.license(message.key);
                return;
            }
            if (message.type === 'mindmap') {
                await vscode.commands.executeCommand('markdownEditor.documentation.mindmap');
                return;
            }
            if (message.type === 'openDocument') {
                await vscode.commands.executeCommand('markdownEditor.readDocument');
                return;
            }
            if (message.type === 'filters' && message.filters && ['skipCode', 'skipUrls', 'skipHeaders', 'skipFooters'].every(key => typeof message.filters[key] === 'boolean')) {
                const filters = { skipCode: message.filters.skipCode, skipUrls: message.filters.skipUrls, skipHeaders: message.filters.skipHeaders, skipFooters: message.filters.skipFooters };
                const next = (0, listeningDocument_1.listeningDocument)((0, readingFilters_1.filterReadingText)(this.sourceText, filters), !filters.skipCode);
                if (!next.segments.length)
                    throw new Error('These skip options leave no readable text. Change the options or open another document.');
                const line = ((_e = this.doc.segments[this.index]) === null || _e === void 0 ? void 0 : _e.sourceLine) || 0;
                const bookmarkLines = this.bookmarks.map(b => { var _a; return ({ line: ((_a = this.doc.segments[b.index]) === null || _a === void 0 ? void 0 : _a.sourceLine) || 0, label: b.label }); });
                this.stopped = true;
                this.cancel();
                this.doc = next;
                this.filters = filters;
                const nearest = (line) => { const i = next.segments.findIndex(s => s.sourceLine >= line); return i < 0 ? next.segments.length - 1 : i; };
                this.index = nearest(line);
                this.seconds = 0;
                this.history = [];
                this.bookmarks = bookmarkLines.map(b => ({ index: nearest(b.line), label: b.label })).filter((b, i, a) => a.findIndex(x => x.index === b.index) === i);
                this.fingerprint = (0, crypto_1.createHash)('sha256').update(this.sourceText + JSON.stringify(filters)).digest('hex');
                await ((_f = this.state) === null || _f === void 0 ? void 0 : _f.update('piper.readingFilters', filters));
                await this.save();
                this.sendDocument();
                this.send({ type: 'status', reset: true, text: 'Skip options applied. Press Read to continue.' });
                await vscode.commands.executeCommand('markdownEditor.documentation.refresh');
                return;
            }
            if (message.type === 'guide') {
                await vscode.commands.executeCommand('markdownEditor.listeningGuide');
                return;
            }
            if (message.type === 'settings') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'markdownEditor.piper');
                return;
            }
            if (message.type === 'voice' && this.voices && typeof message.key === 'string') {
                this.stopped = true;
                this.cancel();
                this.seconds = 0;
                await this.voices.select(message.key);
                await this.sendVoices();
                return;
            }
            if (message.type === 'progress' && message.id === this.generation && typeof message.seconds === 'number') {
                this.seconds = Math.max(0, Math.min(600, message.seconds));
                await this.save();
                return;
            }
            if (message.type === 'rate' && typeof message.rate === 'number') {
                this.rate = Math.max(0.5, Math.min(4, message.rate));
                await this.save();
                return;
            }
            if (message.type === 'mode' && ['continuous', 'outline', 'study'].includes(message.mode)) {
                this.mode = message.mode;
                await this.save();
                this.sendDocument();
                return;
            }
            if (message.type === 'stop') {
                this.stopped = true;
                this.cancel();
                this.send({ type: 'status', reset: true, text: 'Stopped. Your place is saved.' });
                await this.save();
                return;
            }
            if (message.type === 'bookmark') {
                if (this.bookmarks.length < 50 && !this.bookmarks.some(b => b.index === this.index))
                    this.bookmarks.push({ index: this.index, label: this.doc.segments[this.index].text.slice(0, 100) });
                await this.save();
                this.sendDocument();
                await this.announce('Bookmark saved. ' + this.location());
                return;
            }
            if (message.type === 'deleteBookmark' && Number.isInteger(message.index)) {
                this.bookmarks = this.bookmarks.filter(b => b.index !== message.index);
                await this.save();
                this.sendDocument();
                return;
            }
            if (message.type === 'context') {
                await this.announce(this.location() + '. Press Read to continue.');
                return;
            }
            if (message.type === 'find' && typeof message.query === 'string') {
                const query = message.query.trim().slice(0, 200).toLocaleLowerCase();
                const results = [];
                if (query)
                    for (let i = 0; i < this.doc.segments.length && results.length < 100; i++)
                        if (this.doc.segments[i].text.toLocaleLowerCase().includes(query))
                            results.push({ index: i, label: this.doc.segments[i].text.slice(0, 160) });
                this.send({ type: 'results', results });
                return;
            }
            if (message.type === 'back') {
                const previous = this.history.pop();
                if (previous !== undefined)
                    await this.jump(previous, false);
                else
                    await ((_h = (_g = this.hooks).action) === null || _h === void 0 ? void 0 : _h.call(_g, 'backDocument', {}));
                return;
            }
            if (message.type === 'restart') {
                await this.jump(0);
                return;
            }
            if (message.type === 'jump' && Number.isInteger(message.index)) {
                await this.jump(message.index);
                return;
            }
            if (message.type === 'nextHeading' || message.type === 'previousHeading') {
                await this.jump((0, listeningDocument_1.nextHeading)(this.doc, this.index, message.type === 'previousHeading'));
                return;
            }
            if (message.type === 'previous' || message.type === 'next') {
                await this.jump(this.index + (message.type === 'previous' ? -1 : 1));
                return;
            }
            if (message.type === 'play' || message.type === 'repeat') {
                if (message.type === 'repeat')
                    this.seconds = 0;
                this.stopped = false;
                await this.speak();
                return;
            }
            if (message.type === 'ended' && message.id === this.generation && !this.stopped) {
                this.seconds = 0;
                await ((_k = (_j = this.hooks).position) === null || _k === void 0 ? void 0 : _k.call(_j, this.snapshot(), true));
                let next = this.index + 1;
                if (this.mode === 'outline') {
                    const following = (0, listeningDocument_1.nextHeading)(this.doc, this.index);
                    next = following === this.index ? this.doc.segments.length : following;
                }
                if (next >= this.doc.segments.length) {
                    await ((_m = (_l = this.hooks).position) === null || _m === void 0 ? void 0 : _m.call(_l, this.snapshot(), true, true));
                    if (await ((_p = (_o = this.hooks).finished) === null || _p === void 0 ? void 0 : _p.call(_o, this.snapshot())))
                        return;
                    this.stopped = true;
                    this.send({ type: 'finished' });
                    await this.save();
                    await this.announce('Finished. You have reached the end. Use Start over to read again.');
                    return;
                }
                if (this.mode === 'study' && this.doc.segments[this.index].kind !== 'heading' && this.doc.segments[next].paragraph !== this.doc.segments[this.index].paragraph) {
                    this.index = next;
                    this.stopped = true;
                    this.sendDocument();
                    await this.save();
                    await this.announce('Pause for recall. Explain the main point and how it connects to the previous paragraph. Press Read to continue.');
                    return;
                }
                this.index = next;
                await this.speak();
            }
        }
        catch (error) {
            this.stopped = true;
            this.cancel();
            if (this.doc.segments.length)
                this.sendDocument();
            this.send({ type: 'error', text: String(error) });
        }
    }
    snapshot() { var _a; if (!this.doc.segments.length)
        return; return { fingerprint: this.fingerprint, uri: this.sourceIdentity, title: this.title, text: this.sourceText, line: ((_a = this.doc.segments[this.index]) === null || _a === void 0 ? void 0 : _a.sourceLine) || 0, index: this.index, total: this.doc.segments.length, bookmarks: this.bookmarks.map(b => { var _a; return ({ ...b, line: ((_a = this.doc.segments[b.index]) === null || _a === void 0 ? void 0 : _a.sourceLine) || 0 }); }) }; }
    rawSource() { return this.originalSource; }
    updateProject(value) { this.send({ type: 'projectState', ...value }); }
    projectResult(kind, text, sources) { this.send({ type: 'projectResult', kind, text, sources }); }
    control(type) { if (type === 'pause') {
        this.send({ type: 'externalControl', command: 'pause' });
        return Promise.resolve();
    } return this.message({ type }); }
    async speakInformation(text) { await this.announce(text); }
    jumpToLine(line) { const i = this.doc.segments.findIndex(s => s.sourceLine >= line); return this.jump(i < 0 ? this.doc.segments.length - 1 : i); }
    segmentLanguage(text) { var _a, _b; const mode = ((_b = (_a = this.hooks).language) === null || _b === void 0 ? void 0 : _b.call(_a)) || 'manual'; return mode === 'en' || mode === 'hu' ? mode : (0, listeningWorkspace_1.languageOf)(text); }
    async jump(index, remember = true) {
        if (index < 0 || index >= this.doc.segments.length)
            return;
        if (remember && index !== this.index) {
            this.history.push(this.index);
            if (this.history.length > 100)
                this.history.shift();
        }
        this.index = index;
        this.seconds = 0;
        this.stopped = false;
        await this.speak();
    }
    location() {
        const segment = this.doc.segments[this.index];
        const remaining = this.doc.segments.slice(this.index).reduce((n, s) => n + s.text.split(/\s+/).length, 0);
        return `${this.title}. ${segment.path.join(', ') || 'Introduction'}. Sentence or block ${this.index + 1} of ${this.doc.segments.length}. ${Math.floor(this.index / this.doc.segments.length * 100)} percent. Approximately ${Math.ceil(remaining / (180 * this.rate))} minutes remaining. This is an estimate.`;
    }
    async save() {
        var _a, _b;
        if (this.identity && this.state)
            await this.state.update(this.identity, { fingerprint: this.fingerprint, index: this.index, seconds: this.seconds, rate: this.rate, mode: this.mode, bookmarks: this.bookmarks });
        if (this.doc.segments.length)
            await ((_b = (_a = this.hooks).position) === null || _b === void 0 ? void 0 : _b.call(_a, this.snapshot()));
    }
    async sendVoices() { if (this.voices)
        this.send({ type: 'voices', voices: await this.voices.list(), selected: this.voices.selected() }); }
    sendDocument() {
        var _a;
        this.send({ type: 'document', title: this.title, headings: this.doc.headings, total: this.doc.segments.length, words: this.doc.words,
            structures: (0, listeningWorkspace_1.structures)(this.sourceText), passages: this.doc.segments.slice(Math.max(0, this.index - 6), this.index + 13).map((s, i) => ({ index: Math.max(0, this.index - 6) + i, text: s.text, kind: s.kind, sourceLine: s.sourceLine })), filters: this.filters, index: this.index, path: ((_a = this.doc.segments[this.index]) === null || _a === void 0 ? void 0 : _a.path) || [], bookmarks: this.bookmarks, rate: this.rate, mode: this.mode });
    }
    send(message) { var _a; (_a = this.panel) === null || _a === void 0 ? void 0 : _a.webview.postMessage(message); }
    async getEngine(generation = this.generation) {
        var _a, _b, _c, _d;
        if (!vscode.workspace.isTrusted)
            throw new Error('Workspace trust is required to run Piper.');
        const config = vscode.workspace.getConfiguration('markdownEditor.piper');
        const lang = this.segmentLanguage(((_a = this.doc.segments[this.index]) === null || _a === void 0 ? void 0 : _a.text) || '');
        const languageMode = ((_c = (_b = this.hooks).language) === null || _c === void 0 ? void 0 : _c.call(_b)) || 'manual';
        const resolved = this.voices ? (languageMode !== 'manual' && this.voices.resolveFor ? await this.voices.resolveFor(lang === 'hu' ? 'hu_HU-anna-medium' : 'en_US-ljspeech-medium') : await this.voices.resolve()) : { model: config.get('modelPath', ''), runtime: { executable: config.get('executable', 'piper'), args: config.get('arguments', []) } };
        if (generation !== this.generation)
            return undefined;
        const key = JSON.stringify(resolved);
        if (!this.engine || key !== this.engineKey) {
            (_d = this.engine) === null || _d === void 0 ? void 0 : _d.dispose();
            this.audio.clear();
            this.engine = new speechEngine_1.SpeechEngine(resolved.runtime, resolved.model);
            this.engineKey = key;
            this.native = !!resolved.runtime.native;
        }
        return this.engine;
    }
    audioAt(index) {
        var _a, _b;
        let audio = this.audio.get(index);
        if (!audio) {
            audio = this.engine.render((0, listeningWorkspace_1.pronounce)(this.doc.segments[index].text, ((_b = (_a = this.hooks).pronunciation) === null || _b === void 0 ? void 0 : _b.call(_a)) || [], this.segmentLanguage(this.doc.segments[index].text)));
            this.audio.set(index, audio);
            void audio.catch(() => this.audio.delete(index));
        }
        // Keep a bounded working set instead of synthesizing the entire book.
        for (const key of this.audio.keys())
            if (key < this.index - 1 || key > this.index + 2)
                this.audio.delete(key);
        return audio;
    }
    async speak() {
        var _a, _b;
        if (this.mode === 'outline' && this.doc.segments[this.index].kind !== 'heading') {
            const heading = (0, listeningDocument_1.nextHeading)(this.doc, this.index);
            if (heading === this.index) {
                await this.announce('There are no more headings. Choose Continuous mode to read the text.');
                return;
            }
            this.index = heading;
            this.seconds = 0;
        }
        this.cancel(!this.native);
        const id = this.generation;
        this.send({ type: 'status', text: `Preparing ${this.index + 1} / ${this.doc.segments.length}`, reset: true });
        await ((_b = (_a = this.hooks).highlight) === null || _b === void 0 ? void 0 : _b.call(_a, this.snapshot()));
        this.sendDocument();
        this.send({ type: 'position', index: this.index, total: this.doc.segments.length, path: this.doc.segments[this.index].path });
        await this.save();
        try {
            await this.getEngine(id);
            if (id !== this.generation)
                return;
            const data = await this.audioAt(this.index);
            if (id !== this.generation)
                return;
            this.send({ type: 'audio', id, audio: data.toString('base64'), text: this.doc.segments[this.index].text,
                position: `${this.index + 1} / ${this.doc.segments.length}`, path: this.doc.segments[this.index].path,
                seconds: this.seconds, rate: this.rate, advance: true });
            const next = this.mode === 'outline' ? (0, listeningDocument_1.nextHeading)(this.doc, this.index) : this.index + 1;
            if (this.native && next > this.index && next < this.doc.segments.length && this.segmentLanguage(this.doc.segments[next].text) === this.segmentLanguage(this.doc.segments[this.index].text))
                void this.audioAt(next).catch(() => undefined);
        }
        catch (error) {
            if (id === this.generation)
                throw error;
        }
    }
    async announce(text) {
        this.stopped = true;
        this.cancel(!this.native);
        const id = this.generation;
        this.send({ type: 'status', reset: true, text });
        try {
            await this.getEngine(id);
            if (id !== this.generation)
                return;
            const audio = await this.engine.render(text);
            if (id === this.generation)
                this.send({ type: 'audio', id, audio: audio.toString('base64'), text, position: 'Reader information', rate: 1, seconds: 0, advance: false });
        }
        catch (error) {
            if (id === this.generation)
                throw error;
        }
    }
}
exports.PiperReader = PiperReader;
//# sourceMappingURL=piperReader.js.map