const assert = require('assert'), Module = require('module');
const {EventEmitter} = require('events');
let children = [], files = new Map();
const load = Module._load;
Module._load = function(name, ...args) {
 if (name === 'fs') return {promises: {
  mkdtemp: async () => '/tmp/piper-test', stat: async () => ({size:16}), readFile: async name => files.get(name),
  unlink: async name => files.delete(name), readdir: async () => [...files.keys()].map(n => n.split('/').pop()), rmdir: async () => {}
 }};
 if (name === 'child_process') return {spawn(executable, args, options) {
  assert.strictEqual(options.shell, false);
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.requests = []; child.stdin.write = input => child.requests.push(JSON.parse(input));
  child.kill = () => {child.killed = true; child.emit('close',null);};
  children.push(child); return child;
 }};
 return load.call(this,name,...args);
};
const {SpeechEngine} = require('../out/speechEngine');Module._load=load;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const engine=new SpeechEngine({executable:'piper',args:[],native:true},'/voice.onnx');
 const p1=engine.render('One.'),p2=engine.render('Two.');await tick();
 assert.strictEqual(children.length,1);const child=children[0];assert.strictEqual(child.requests.length,2);
 for(const r of child.requests){files.set(r.output_file,Buffer.from('RIFF0000WAVEdata'));child.stdout.emit('data',Buffer.from(r.output_file+'\n'));}
 const out=await Promise.all([p1,p2]);assert(out.every(b=>b.toString().startsWith('RIFF')));
 const pending=engine.render('Three.');await tick();engine.dispose();await assert.rejects(pending,/cancelled/);
 assert(child.killed);console.log('Persistent speech worker: one model process, ordered queued audio, WAV validation and cancellation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
