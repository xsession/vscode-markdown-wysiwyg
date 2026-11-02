// Keep Node's real filesystem resolution outside webpack's require.resolve rewrite.
const path = require('path');
exports.assetDirectory = path.dirname(require.resolve('pdfjs-dist/package.json'));
