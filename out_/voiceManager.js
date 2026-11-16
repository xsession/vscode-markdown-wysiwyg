"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.usesBundledRuntime = exports.VoiceManager = void 0;
const vscode = require("vscode");
const fs_1 = require("fs");
const path = require("path");
const child_process_1 = require("child_process");
const https = require("https");
const url_1 = require("url");
const crypto_1 = require("crypto");
/** Bundled models work offline; only runtime setup/additional voices require network. */
class VoiceManager {
    constructor(context, report) {
        this.context = context;
        this.report = report;
        this.selectionGeneration = 0;
        this.downloads = new Map();
        this.selectedKey = context.globalState.get('piper.voice', 'en_US-ljspeech-medium');
    }
    selected() { return this.selectedKey; }
    async catalog() {
        return JSON.parse(await fs_1.promises.readFile(path.join(this.context.extensionPath, 'resources', 'voice-catalog.json'), 'utf8'));
    }
    async modelPath(key) {
        if (!/^[a-zA-Z0-9_-]+$/.test(key))
            return undefined;
        for (const root of [path.join(this.context.extensionPath, 'resources', 'voices'), path.join(this.context.globalStorageUri.fsPath, 'voices')]) {
            const model = path.join(root, key, key + '.onnx');
            try {
                await fs_1.promises.access(model);
                await fs_1.promises.access(model + '.json');
                await fs_1.promises.access(path.join(root, key, 'MODEL_CARD'));
                return model;
            }
            catch { /* Try downloaded path. */ }
        }
        return undefined;
    }
    async list() {
        const catalog = await this.catalog();
        return Promise.all(Object.values(catalog).map(async (voice) => ({ key: voice.key,
            label: `${voice.language.name_english} / ${voice.language.name_native} · ${voice.name} · ${voice.quality}`,
            installed: !!await this.modelPath(voice.key) })));
    }
    async select(key) {
        if (!vscode.workspace.isTrusted)
            throw new Error('Trust this workspace before selecting or downloading voices.');
        const generation = ++this.selectionGeneration;
        const catalog = await this.catalog();
        const voice = Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : undefined;
        if (!voice || !/^[a-zA-Z0-9_-]+$/.test(key))
            throw new Error('Unknown voice. Select a voice from the catalog.');
        if (!await this.modelPath(key)) {
            this.report(`Downloading ${key} with checksum verification…`);
            const destination = path.join(this.context.globalStorageUri.fsPath, 'voices', key);
            let download = this.downloads.get(key);
            if (!download) {
                download = downloadVoice(voice, destination).finally(() => this.downloads.delete(key));
                this.downloads.set(key, download);
            }
            await download;
        }
        if (generation !== this.selectionGeneration)
            return;
        this.selectedKey = key;
        await this.context.globalState.update('piper.voice', key);
        // An explicit voice selection supersedes a legacy custom model setting.
        await vscode.workspace.getConfiguration('markdownEditor.piper').update('modelPath', '', vscode.ConfigurationTarget.Global);
        this.report(`Voice ready: ${key}`);
    }
    async license(key) {
        const model = await this.modelPath(key);
        if (model) {
            const file = path.join(path.dirname(model), 'MODEL_CARD');
            try {
                await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)), { preview: true });
                return;
            }
            catch { /* Offer upstream card. */ }
        }
        const catalog = await this.catalog();
        if (!Object.prototype.hasOwnProperty.call(catalog, key))
            return;
        const card = Object.keys(catalog[key].files).find(name => name.endsWith('/MODEL_CARD'));
        if (card)
            await vscode.env.openExternal(vscode.Uri.parse('https://huggingface.co/rhasspy/piper-voices/blob/main/' + card));
    }
    async setup() { await this.ensureRuntime(); this.report('Piper is ready. Select a voice and press Read.'); }
    async resolve() {
        if (!vscode.workspace.isTrusted)
            throw new Error('Trust this workspace before running Piper.');
        const custom = vscode.workspace.getConfiguration('markdownEditor.piper').get('modelPath', '');
        const model = custom || await this.modelPath(this.selectedKey);
        if (!model)
            throw new Error('Voice is not installed. Choose a bundled voice in the Voices section.');
        await fs_1.promises.access(model);
        await fs_1.promises.access(model + '.json');
        return { model, runtime: await this.ensureRuntime() };
    }
    async resolveFor(key) {
        if (!vscode.workspace.isTrusted)
            throw new Error('Trust this workspace before running Piper.');
        const model = await this.modelPath(key);
        if (!model)
            throw new Error('Language voice is not installed: ' + key);
        return { model, runtime: await this.ensureRuntime() };
    }
    async ensureRuntime() {
        if (!vscode.workspace.isTrusted)
            throw new Error('Trust this workspace before installing or running Piper.');
        const config = vscode.workspace.getConfiguration('markdownEditor.piper');
        const exe = config.get('executable', '').trim();
        const args = config.get('arguments', []);
        // Older releases saved the bare command "piper". It bypassed the bundled
        // runtime after upgrading and failed on PCs with no Piper on PATH.
        if (!usesBundledRuntime(exe, args))
            return { executable: exe, args };
        if (/^piper(?:\.exe)?$/i.test(exe))
            this.report('Using the bundled offline engine instead of the legacy Piper PATH setting.');
        if (!this.installing)
            this.installing = this.installRuntime().catch(error => { this.installing = undefined; throw error; });
        return this.installing;
    }
    async installRuntime() {
        const platform = process.platform + '-' + process.arch;
        const root = path.join(this.context.extensionPath, 'resources', 'runtime', platform, 'piper');
        const executable = path.join(root, process.platform === 'win32' ? 'piper.exe' : 'piper');
        try {
            await fs_1.promises.access(executable);
        }
        catch {
            throw new Error('No bundled runtime for ' + platform + '. This offline package supports Windows x64 and Linux x64. Configure a custom Piper executable for another platform.');
        }
        if (process.platform !== 'win32')
            await fs_1.promises.chmod(executable, 0o755);
        this.report('Checking bundled offline speech engine…');
        await run(executable, ['--help'], 30000);
        return { executable, args: ['--espeak_data', path.join(root, 'espeak-ng-data'), '--tashkeel_model', path.join(root, 'libtashkeel_model.ort')], native: true };
    }
}
exports.VoiceManager = VoiceManager;
function usesBundledRuntime(executable, args) {
    const value = executable.trim();
    return !value || value.toLowerCase() === 'auto' || (args.length === 0 && /^piper(?:\.exe)?$/i.test(value));
}
exports.usesBundledRuntime = usesBundledRuntime;
function run(executable, args, timeout) {
    return new Promise((resolve, reject) => {
        var _a, _b, _c;
        const child = (0, child_process_1.spawn)(executable, args, { shell: false, windowsHide: true });
        let output = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Setup timed out. Check your network, Python version and proxy settings, then retry.')); }, timeout);
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', data => { output = (output + data).slice(-5000); });
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', data => { output = (output + data).slice(-5000); });
        (_c = child.stdin) === null || _c === void 0 ? void 0 : _c.end();
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${executable} failed (${code}): ${output}`)); });
    });
}
exports.run = run;
async function downloadVoice(voice, destination) {
    await fs_1.promises.mkdir(destination, { recursive: true });
    for (const [remote, expected] of Object.entries(voice.files)) {
        const name = remote.split('/').pop();
        if (![voice.key + '.onnx', voice.key + '.onnx.json', 'MODEL_CARD'].includes(name))
            continue;
        if (!/^[A-Za-z0-9_./-]+$/.test(remote) || remote.split('/').includes('..'))
            throw new Error('Invalid voice catalog path.');
        const output = path.join(destination, name), partial = output + '.' + (0, crypto_1.randomBytes)(8).toString('hex') + '.partial';
        try {
            await new Promise((resolve, reject) => {
                const deadline = setTimeout(() => { request === null || request === void 0 ? void 0 : request.destroy(new Error('Voice download timed out.')); reject(new Error('Voice download timed out.')); }, 600000);
                let request;
                const fail = (error) => { clearTimeout(deadline); reject(error); };
                const fetch = (url, redirects) => {
                    if (!url.startsWith('https://') || redirects > 6) {
                        fail(new Error('Invalid download redirect.'));
                        return;
                    }
                    request = https.get(url, response => {
                        if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
                            response.resume();
                            fetch(new url_1.URL(response.headers.location, url).toString(), redirects + 1);
                            return;
                        }
                        if (response.statusCode !== 200) {
                            response.resume();
                            fail(new Error('Voice download HTTP ' + response.statusCode));
                            return;
                        }
                        const file = require('fs').createWriteStream(partial, { flags: 'wx' });
                        let complete = false;
                        const hash = (0, crypto_1.createHash)('md5');
                        let bytes = 0;
                        const abort = (error) => { response.destroy(); file.destroy(); fail(error); };
                        response.on('data', (data) => { bytes += data.length; hash.update(data); if (bytes > expected.size_bytes)
                            abort(new Error('Voice exceeds catalog size.')); });
                        response.once('error', abort);
                        file.once('error', abort);
                        file.once('finish', () => { complete = true; });
                        file.once('close', () => { clearTimeout(deadline); if (!complete)
                            return; if (bytes !== expected.size_bytes || hash.digest('hex') !== expected.md5_digest)
                            reject(new Error('Voice checksum mismatch.'));
                        else
                            resolve(); });
                        response.pipe(file);
                    });
                    request.setTimeout(60000, () => request === null || request === void 0 ? void 0 : request.destroy(new Error('Voice connection timed out.')));
                    request.once('error', fail);
                };
                fetch('https://huggingface.co/rhasspy/piper-voices/resolve/main/' + remote, 0);
            });
            await fs_1.promises.rename(partial, output);
        }
        finally {
            await fs_1.promises.unlink(partial).catch(() => undefined);
        }
    }
}
//# sourceMappingURL=voiceManager.js.map