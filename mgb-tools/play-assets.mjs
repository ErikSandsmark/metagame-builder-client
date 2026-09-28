/**
 * Generates the play client's neutral image set (decision 0030, I3): type and category badges,
 * backgrounds, a trainer silhouette, the substitute doll, status balls and the page icon.
 * All shapes and text are drawn here; nothing is derived from official artwork.
 * Output is committed to vendor/showdown-client/play.pokemonshowdown.com/mgb/assets/.
 *
 * Usage: node packages/sprites/scripts/play-assets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TYPE_COLORS } from '../src/index.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../vendor/showdown-client/play.pokemonshowdown.com/mgb/assets');
fs.mkdirSync(path.join(OUT, 'types'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'categories'), { recursive: true });

const png = (svg, file) => sharp(Buffer.from(svg)).png().toFile(path.join(OUT, file));
const jpg = (svg, file) => sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(path.join(OUT, file));
const FONT = `font-family="Helvetica, Arial, sans-serif" font-weight="700"`;

function badge(label, fill, text = '#fff') {
	const size = label.length > 6 ? 6.2 : label.length > 5 ? 6.8 : 8.5;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="14">
		<rect x="0.5" y="0.5" width="31" height="13" rx="3" fill="${fill}" stroke="rgba(0,0,0,.35)"/>
		<text x="16" y="10.2" text-anchor="middle" font-size="${size}" ${FONT} fill="${text}" stroke="rgba(0,0,0,.35)" stroke-width="0.6" paint-order="stroke">${label}</text>
	</svg>`;
}

const types = { ...TYPE_COLORS, Stellar: '#40B5A5' };
const short = { Fighting: 'FIGHT', Electric: 'ELECTR', Psychic: 'PSYCH', '???': '???' };
for (const [t, c] of Object.entries(types)) {
	const label = short[t] || t.toUpperCase();
	const file = t; // served URL-decoded, so '???' stays literal
	await png(badge(label, c), `types/${file}.png`);
	await png(badge(label, c, '#fffbe0').replace('rx="3"', 'rx="7"'), `types/Tera${file}.png`);
}
await png(badge('PHYS', '#C92112'), 'categories/Physical.png');
await png(badge('SPEC', '#4F5870'), 'categories/Special.png');
await png(badge('STAT', '#8C888C'), 'categories/Status.png');

// Team slot markers, 40 px cells as upstream expects: 0 = unrevealed creature, 40 = statused,
// 80 = empty slot (upstream also greys this cell out for fainted unrevealed creatures).
const ball = (x, fill) => `<circle cx="${x + 11}" cy="11" r="9" fill="${fill}" stroke="#333" stroke-width="1.5"/><circle cx="${x + 11}" cy="11" r="3" fill="#fff" stroke="#333"/>`;
const empty = x => `<circle cx="${x + 11}" cy="11" r="8" fill="none" stroke="#9aa3ad" stroke-width="1.5" stroke-dasharray="3 2"/>`;
await png(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="22">${ball(0, '#5b8def')}${ball(40, '#e0a030')}${empty(80)}</svg>`, 'ball-sheet.png');

// Backgrounds: soft gradients with a few shapes.
const hills = (w, h, a, b, c) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
	<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
	<rect width="${w}" height="${h}" fill="url(#g)"/>
	<ellipse cx="${w * 0.2}" cy="${h * 1.05}" rx="${w * 0.45}" ry="${h * 0.3}" fill="${c}" opacity=".55"/>
	<ellipse cx="${w * 0.8}" cy="${h * 1.1}" rx="${w * 0.5}" ry="${h * 0.32}" fill="${c}" opacity=".4"/>
</svg>`;
await jpg(hills(1600, 1000, '#2c4466', '#1b2536', '#3d5a80'), 'client-bg.jpg');
await jpg(hills(800, 360, '#9fc7e8', '#e9f1f7', '#8fbf7f').replace('</svg>',
	`<ellipse cx="560" cy="170" rx="120" ry="26" fill="#6f9e62" opacity=".7"/><ellipse cx="220" cy="320" rx="150" ry="32" fill="#6f9e62" opacity=".7"/></svg>`), 'battle-bg.jpg');

// Trainer silhouette (80 x 80).
await png(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
	<circle cx="40" cy="24" r="13" fill="#56657a"/><path d="M16 76 C16 50 64 50 64 76 Z" fill="#56657a"/></svg>`, 'trainer.png');

// Substitute doll (96 x 96).
await png(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
	<rect x="30" y="34" width="36" height="46" rx="10" fill="#d9c9a3" stroke="#8a7a55" stroke-width="2"/>
	<circle cx="48" cy="30" r="16" fill="#d9c9a3" stroke="#8a7a55" stroke-width="2"/>
	<circle cx="42" cy="28" r="2.2" fill="#333"/><circle cx="54" cy="28" r="2.2" fill="#333"/></svg>`, 'substitute.png');

// Page icon (256 x 256).
await png(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
	<rect x="8" y="8" width="240" height="240" rx="56" fill="#2f6fde"/>
	<text x="128" y="160" text-anchor="middle" font-size="104" ${FONT} fill="#fff">MB</text></svg>`, 'icon.png');

await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(path.join(OUT, 'blank.png'));
console.log('play assets written to', path.relative(process.cwd(), OUT));
