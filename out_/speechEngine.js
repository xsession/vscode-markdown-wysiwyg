"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechEngine = void 0;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os = require("os");
const path = require("path");
const crypto_1 = require("crypto");
/** Native JSON-input mode keeps one voice loaded and supports a bounded look-ahead. */
class SpeechEngine {
    constructor(runtime, model) {
        this.runtime = runtime;
        this.model = model;
        this.disposed = false;
        this.pending = new Map();
        this.tail = '';
        this.stderr = '';
    }
    async render(text) {
        var _a, _b, _c;
        if (this.disposed)
            throw new Error('Speech cancelled.');
        if (!this.directory) {
            if (!this.initializing)
                this.initializing = fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'markdown-piper-'));
            this.directory = await this.initializing;
        }
        if (this.disposed) {
            await this.cleanup();
            throw new Error('Speech cancelled.');
        }
        const output = path.join(this.directory, (0, crypto_1.randomBytes)(12).toString('hex') + '.wav');
        if (!this.runtime.native)
            return this.renderOnce(text, output);
        if (!this.child) {
            const child = (0, child_process_1.spawn)(this.runtime.executable, [...this.runtime.args, '--model', this.model, '--json-input', '--output_dir', this.directory], { shell: false, windowsHide: true });
            this.child = child;
            (_a = child.stdin) === null || _a === void 0 ? void 0 : _a.on('error', error => this.fail(error));
            (_b = child.stdout) === null || _b === void 0 ? void 0 : _b.on('data', data => {
                this.tail += data.toString();
                let newline;
                while ((newline = this.tail.indexOf('\n')) >= 0) {
                    const filename = this.tail.slice(0, newline).trim();
                    this.tail = this.tail.slice(newline + 1);
                    const task = this.pending.get(filename);
                    if (task) {
                        this.pending.delete(filename);
                        clearTimeout(task.timer);
                        this.read(filename).then(task.resolve, task.reject);
                    }
                }
                if (this.tail.length > 8192)
                    this.fail(new Error('Invalid Piper worker response.'));
            });
            (_c = child.stderr) === null || _c === void 0 ? void 0 : _c.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
            child.once('error', error => this.fail(error));
            child.once('close', code => { if (!this.disposed)
                this.fail(new Error(`Piper worker exited (${code}): ${this.stderr}`)); void this.cleanup(); });
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new Error('Piper synthesis timed out.')), 120000);
            this.pending.set(output, { resolve, reject, timer });
            this.child.stdin.write(JSON.stringify({ text, output_file: output }) + '\n');
        });
    }
    async read(filename) {
        try {
            const stat = await fs_1.promises.stat(filename);
            if (stat.size > 32 * 1024 * 1024)
                throw new Error('Piper output exceeds 32 MB.');
            const audio = await fs_1.promises.readFile(filename);
            if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE')
                throw new Error('Invalid Piper WAV.');
            return audio;
        }
        finally {
            await fs_1.promises.unlink(filename).catch(() => undefined);
        }
    }
    async renderOnce(text, filename) {
        await new Promise((resolve, reject) => {
            var _a, _b, _c, _d;
            const child = (0, child_process_1.spawn)(this.runtime.executable, [...this.runtime.args, '--model', this.model, '--output_file', filename], { shell: false, windowsHide: true });
            this.child = child;
            const timer = setTimeout(() => { child.kill(); reject(new Error('Piper synthesis timed out.')); }, 120000);
            (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
            (_b = child.stdout) === null || _b === void 0 ? void 0 : _b.resume();
            (_c = child.stdin) === null || _c === void 0 ? void 0 : _c.on('error', () => { });
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', code => { clearTimeout(timer); this.child = undefined; code === 0 ? resolve() : reject(new Error(`Piper failed (${code}): ${this.stderr}`)); if (this.disposed)
                void this.cleanup(); });
            (_d = child.stdin) === null || _d === void 0 ? void 0 : _d.end(text + '\n', 'utf8');
        });
        return this.read(filename);
    }
    fail(error) {
        for (const task of this.pending.values()) {
            clearTimeout(task.timer);
            task.reject(error);
        }
        this.pending.clear();
        this.dispose();
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        if (this.child) {
            this.child.kill();
            this.child = undefined;
        }
        else
            void this.cleanup();
        for (const task of this.pending.values()) {
            clearTimeout(task.timer);
            task.reject(new Error('Speech cancelled.'));
        }
        this.pending.clear();
    }
    async cleanup() {
        if (!this.directory)
            return;
        const directory = this.directory;
        this.directory = undefined;
        const files = await fs_1.promises.readdir(directory).catch(() => []);
        await Promise.all(files.map(f => fs_1.promises.unlink(path.join(directory, f)).catch(() => undefined)));
        await fs_1.promises.rmdir(directory).catch(() => undefined);
    }
}
exports.SpeechEngine = SpeechEngine;
//# sourceMappingURL=speechEngine.js.map