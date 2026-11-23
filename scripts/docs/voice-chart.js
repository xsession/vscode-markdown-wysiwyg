// Draws docs/assets/images/voice_latency_{light,dark}.svg from the measured
// synthesis times in docs/development/validation/native_voices_0_10.json.
// Usage: node scripts/docs/voice-chart.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/development/validation/native_voices_0_10.json'), 'utf8'));

const themes = {
	light: { surface: '#fcfcfb', ink: '#0b0b0b', soft: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', first: '#2a78d6', warm: '#eb6834' },
	dark: { surface: '#1a1a19', ink: '#f0efec', soft: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', first: '#3987e5', warm: '#d95926' },
};
const name = (v) => {
	const [lang, voice] = v.voice.split('-');
	const label = voice === 'ljspeech' ? 'LJSpeech' : voice[0].toUpperCase() + voice.slice(1);
	return label + (lang.startsWith('hu') ? ' (hu)' : ' (en)');
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function chart(t) {
	const W = 720, left = 120, right = 60, top = 64, rowH = 40, barH = 12, gap = 2;
	const H = top + data.length * rowH + 44;
	const max = 2500, plotW = W - left - right;
	const x = (ms) => left + (ms / max) * plotW;
	const out = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`);
	out.push(`<title id="t">Piper synthesis time per bundled voice</title>`);
	out.push(`<desc id="d">First segment including model load, and a following segment, in milliseconds. ${data.map((v) => `${name(v)}: ${v.initialMs} ms first, ${v.warmMs} ms next`).join('; ')}.</desc>`);
	out.push(`<rect width="${W}" height="${H}" rx="8" fill="${t.surface}"/>`);
	out.push(`<text x="20" y="28" font-size="15" font-weight="600" fill="${t.ink}">Synthesis time per bundled voice (ms)</text>`);
	// legend
	const lg = (lx, color, label) => `<rect x="${lx}" y="40" width="12" height="12" rx="3" fill="${color}"/><text x="${lx + 18}" y="50" font-size="12" fill="${t.soft}">${label}</text>`;
	out.push(lg(20, t.first, 'First segment (includes loading the voice)'));
	out.push(lg(310, t.warm, 'Next segment (engine already running)'));
	// grid + ticks
	for (let ms = 0; ms <= max; ms += 500) {
		const gx = x(ms);
		out.push(`<line x1="${gx}" y1="${top - 6}" x2="${gx}" y2="${top + data.length * rowH}" stroke="${ms ? t.grid : t.axis}" stroke-width="1"/>`);
		out.push(`<text x="${gx}" y="${top + data.length * rowH + 18}" font-size="11" fill="${t.muted}" text-anchor="middle">${ms}</text>`);
	}
	const bar = (y, ms, color, label) => {
		const w = Math.max(1, x(ms) - left);
		// 4px rounded data end, square at the baseline
		const r = Math.min(4, w);
		out.push(`<path d="M${left} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${barH - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}z" fill="${color}"><title>${esc(label)}: ${ms} ms</title></path>`);
		out.push(`<text x="${left + w + 6}" y="${y + barH - 2}" font-size="11" fill="${t.soft}">${ms}</text>`);
	};
	data.forEach((v, i) => {
		const y0 = top + i * rowH + (rowH - (2 * barH + gap)) / 2;
		out.push(`<text x="${left - 10}" y="${y0 + barH + 4}" font-size="12" fill="${t.ink}" text-anchor="end">${esc(name(v))}</text>`);
		bar(y0, v.initialMs, t.first, name(v) + ', first segment');
		bar(y0 + barH + gap, v.warmMs, t.warm, name(v) + ', next segment');
	});
	out.push(`<text x="${W - 20}" y="${H - 8}" font-size="10" fill="${t.muted}" text-anchor="end">Linux x64, bundled native Piper, short passages; single measurements</text>`);
	out.push('</svg>\n');
	return out.join('\n');
}

for (const [mode, t] of Object.entries(themes)) {
	const file = path.join(root, 'docs/assets/images', `voice_latency_${mode}.svg`);
	fs.writeFileSync(file, chart(t));
	console.log('wrote', path.relative(root, file));
}
