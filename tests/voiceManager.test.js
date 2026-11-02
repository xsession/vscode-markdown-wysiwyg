// Unit tests use temporary fixture files and a mocked process launcher.
// Real models and runtimes are checked separately by npm run test:package.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {EventEmitter} = require('events');
const original = Module._load;
const calls = [];
const values = {executable: 'auto'};
const vscode = {
 workspace: {
  isTrusted: true,
  getConfiguration: () => ({
   get: (key, fallback) => values[key] === undefined ? fallback : values[key],
   update: async (key, value) => {values[key] = value;}
  })
 },
 ConfigurationTarget: {Global: 1}
};
Module._load = function(name, ...args) {
 if (name === 'vscode') return vscode;
 if (name === 'child_process') return {
  spawn(executable, args, options) {
   assert.strictEqual(options.shell, false);
   calls.push({executable, args});
   const child = new EventEmitter();
   child.stdin = {end() {}};
   child.stdout = new EventEmitter();
   child.stderr = new EventEmitter();
   setImmediate(() => child.emit('close', 0));
   return child;
  }
 };
 return original.call(this, name, ...args);
};
let VoiceManager, usesBundledRuntime;
try { ({VoiceManager, usesBundledRuntime} = require('../out/voiceManager')); }
finally { Module._load = original; }

const keys = [
 'en_US-ljspeech-medium', 'en_US-john-medium', 'en_US-kristin-medium',
 'hu_HU-anna-medium', 'hu_HU-berta-medium', 'hu_HU-imre-medium'
];
function fixture(root, platform, arch) {
 const extensionPath = path.join(root, 'extension');
 const catalog = {};
 for (const key of keys) {
  const folder = path.join(extensionPath, 'resources', 'voices', key);
  fs.mkdirSync(folder, {recursive: true});
  fs.writeFileSync(path.join(folder, key + '.onnx'), 'UNIT TEST FIXTURE - NOT A VOICE MODEL');
  fs.writeFileSync(path.join(folder, key + '.onnx.json'), '{}');
  fs.writeFileSync(path.join(folder, 'MODEL_CARD'), 'Unit-test fixture only.');
  catalog[key] = {key, name: key, quality: 'medium', language: {
   code: key.split('-')[0], name_english: key.startsWith('hu_') ? 'Hungarian' : 'English', name_native: key.startsWith('hu_') ? 'Magyar' : 'English'
  }, files: {}};
 }
 fs.writeFileSync(path.join(extensionPath, 'resources', 'voice-catalog.json'), JSON.stringify(catalog));
 const executable = path.join(extensionPath, 'resources', 'runtime', platform + '-' + arch, 'piper', platform === 'win32' ? 'piper.exe' : 'piper');
 fs.mkdirSync(path.dirname(executable), {recursive: true});
 fs.writeFileSync(executable, 'UNIT TEST FIXTURE - NEVER EXECUTED');
 const stored = new Map();
 return {executable, stored, context: {
  extensionPath, globalStorageUri: {fsPath: path.join(root, 'storage')},
  globalState: {get: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
   update: async (key, value) => {stored.set(key, value);}}
 }};
}
async function checkPlatform(platform) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piper-manager-'));
 const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
 const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch');
 try {
  Object.defineProperty(process, 'platform', {value: platform, configurable: true});
  Object.defineProperty(process, 'arch', {value: 'x64', configurable: true});
  vscode.workspace.isTrusted = true;
  values.executable = 'auto';
  delete values.modelPath;
  calls.length = 0;
  const {context, executable, stored} = fixture(root, platform, 'x64');
  const manager = new VoiceManager(context, () => {});
  assert.strictEqual((await manager.list()).filter(voice => voice.installed).length, 6);
  const [a, b] = await Promise.all([manager.resolve(), manager.resolve()]);
  assert(a.runtime.native && b.runtime.native);
  assert.strictEqual(a.runtime.executable, executable);
  assert.strictEqual(path.basename(executable), platform === 'win32' ? 'piper.exe' : 'piper');
  assert(a.model.endsWith('en_US-ljspeech-medium.onnx'));
  assert.strictEqual(calls.length, 1, 'Concurrent resolutions share the runtime check');
  assert(calls.every(call => !call.args.includes('pip') && !call.args.includes('install')));
  await manager.select('hu_HU-anna-medium');
  assert((await manager.resolve()).model.endsWith('hu_HU-anna-medium.onnx'));
  assert.strictEqual(stored.get('piper.voice'), 'hu_HU-anna-medium');
  await assert.rejects(manager.select('../../escape'), /Unknown/);

  // Upgrade compatibility: old bare PATH settings must use bundled Piper.
  for (const legacy of ['piper', 'piper.exe', ' PIPER ', 'auto', 'AUTO', '']) {
   values.executable = legacy; values.arguments = [];
   const upgraded = await new VoiceManager(context, () => {}).resolve();
   assert.strictEqual(upgraded.runtime.executable, executable);
   assert(upgraded.runtime.native);
  }
  values.executable = 'C:\\Custom Voice Engine\\piper.exe';
  values.arguments = ['--custom'];
  const custom = await new VoiceManager(context, () => {}).resolve();
  assert.strictEqual(custom.runtime.executable, values.executable);
  assert.deepStrictEqual(custom.runtime.args, ['--custom']);
  assert(!usesBundledRuntime('piper', ['--custom']));
  assert(!usesBundledRuntime('python', ['-m', 'piper']));
  values.executable = 'auto'; values.arguments = [];

  // Missing packages must still fail clearly, rather than being silently skipped.
  fs.unlinkSync(executable);
  const missing = new VoiceManager(context, () => {});
  await assert.rejects(missing.resolve(), new RegExp('No bundled runtime for ' + platform + '-x64'));
  fs.writeFileSync(executable, 'RESTORED UNIT TEST FIXTURE');
  assert((await missing.resolve()).runtime.native, 'A failed runtime check can be retried');

  vscode.workspace.isTrusted = false;
  await assert.rejects(manager.resolve(), /Trust/);
  await assert.rejects(manager.select('hu_HU-imre-medium'), /Trust/);
  console.log('Voice manager fixture tests passed: ' + platform + '-x64 (no real assets or processes)');
 } finally {
  Object.defineProperty(process, 'platform', platformDescriptor);
  Object.defineProperty(process, 'arch', archDescriptor);
  vscode.workspace.isTrusted = true;
  fs.rmSync(root, {recursive: true, force: true});
 }
}
(async () => {
 await checkPlatform('win32');
 await checkPlatform('linux');
})().catch(error => {console.error(error); process.exitCode = 1;});
