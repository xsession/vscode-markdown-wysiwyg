const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'resources/voice-catalog.json')));
const keys = ['en_US-ljspeech-medium', 'en_US-john-medium', 'en_US-kristin-medium', 'hu_HU-anna-medium', 'hu_HU-berta-medium', 'hu_HU-imre-medium'];
for (const key of keys) {
 for (const [remote, metadata] of Object.entries(catalog[key].files)) {
  const name = path.basename(remote);
  if (![key + '.onnx', key + '.onnx.json', 'MODEL_CARD'].includes(name)) continue;
  const data = fs.readFileSync(path.join(root, 'resources/voices', key, name));
  if (data.length !== metadata.size_bytes || crypto.createHash('md5').update(data).digest('hex') !== metadata.md5_digest) throw new Error('Invalid bundled voice file: ' + remote);
 }
}
console.log('Verified 6 bundled voice packs against upstream catalog');
