/**
 * Exports the built play client (vendor/showdown-client) into apps/web/public/play for Vercel
 * (decision 0030). Upstream files are copied, never edited in place (I4). While copying:
 * - only the files the production page loads are included (no upstream sprites, audio, logos);
 * - fx images are an allow-list of simple effect particles; backgrounds and art are replaced by
 *   our own images from mgb/assets (I3);
 * - absolute upstream URLs in CSS/JS are rewritten to our /play/ path, and the result is scanned
 *   so no file loads anything from the upstream site.
 *
 * Usage: node apps/web/scripts/export-play-client.mjs   (after building the client, see CLAUDE.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(ROOT, 'vendor/showdown-client/play.pokemonshowdown.com');
const DEST = path.join(ROOT, 'apps/web/public/play');

const DATA = ['graphics.js', 'commands.js', 'pokedex.js', 'moves.js', 'items.js', 'abilities.js', 'search-index.js',
	'teambuilder-tables.js', 'typechart.js', 'aliases.js', 'text/en.js'];
// Effect particles drawn by the Showdown project. Weather scenes, backgrounds, the ball, chat-game
// art and anything resembling official artwork are left out.
const FX_EXCLUDE = /^(client-bg|bg-|weather-|groupchat|pokeball|mafia-|hangman|z-symbol|ultra)/;

let files = 0, bytes = 0;
function copy(from, to, transform) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	if (transform) {
		const text = transform(fs.readFileSync(from, 'utf8'));
		fs.writeFileSync(to, text);
		bytes += Buffer.byteLength(text);
	} else {
		fs.copyFileSync(from, to);
		bytes += fs.statSync(to).size;
	}
	files++;
}
function copyDir(rel, filter = () => true, transform) {
	const dir = path.join(SRC, rel);
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue;
		const abs = path.join(entry.parentPath, entry.name);
		const r = path.relative(SRC, abs);
		if (filter(r)) copy(abs, path.join(DEST, r), transform?.(r));
	}
}

const UPSTREAM = /(https?:)?\/\/play\.pokemonshowdown\.com\//g;
const localise = r => (/\.(js|css)$/.test(r) ? text => text.replace(UPSTREAM, '/play/') : undefined);

if (!fs.existsSync(path.join(SRC, 'js/client-main.js'))) {
	console.error('The client is not built. Run: (cd vendor/showdown-client && node build full --no-update)');
	process.exit(1);
}
fs.rmSync(DEST, { recursive: true, force: true });

copyDir('js', r => !r.endsWith('.map') && !r.endsWith('.d.ts') && !r.startsWith('js/oldclient/'), localise);
copyDir('style', r => !r.endsWith('.map'), localise);
copy(path.join(SRC, 'src/battle-log-misc.js'), path.join(DEST, 'src/battle-log-misc.js'), localise('x.js'));
for (const f of DATA) copy(path.join(SRC, 'data', f), path.join(DEST, 'data', f), localise(f));
copyDir('fx', r => !FX_EXCLUDE.test(path.basename(r)));
copyDir('mgb', r => r !== 'mgb/play.html');
copy(path.join(SRC, 'mgb/client.html'), path.join(DEST, 'client.html'));

// Our images at the paths the client asks for; everything else under sprites/ and fx/ falls back
// to a neutral image through rewrites in next.config.ts.
const A = path.join(SRC, 'mgb/assets');
fs.cpSync(path.join(A, 'types'), path.join(DEST, 'sprites/types'), { recursive: true });
fs.cpSync(path.join(A, 'categories'), path.join(DEST, 'sprites/categories'), { recursive: true });
copy(path.join(A, 'ball-sheet.png'), path.join(DEST, 'sprites/pokemonicons-pokeball-sheet.png'));
copy(path.join(A, 'substitute.png'), path.join(DEST, 'sprites/ani/substitute.gif'));
copy(path.join(A, 'substitute.png'), path.join(DEST, 'sprites/ani-back/substitute.gif'));
copy(path.join(A, 'blank.png'), path.join(DEST, 'sprites/pokemonicons-sheet.png'));
copy(path.join(A, 'blank.png'), path.join(DEST, 'sprites/itemicons-sheet.png'));
copy(path.join(A, 'icon.png'), path.join(DEST, 'favicon-256.png'));

// Scan: nothing may load from the upstream site. Plain links (dex, replays) are allowed; they are
// hidden or unreachable in our page and are not requests.
const offenders = [];
for (const entry of fs.readdirSync(DEST, { withFileTypes: true, recursive: true })) {
	if (!entry.isFile() || !/\.(js|css|html)$/.test(entry.name)) continue;
	const abs = path.join(entry.parentPath, entry.name);
	const text = fs.readFileSync(abs, 'utf8');
	const re = /(src=|url\(|import\(|fetch\(|new Worker\()\s*["'`]?(https?:)?\/\/[a-z0-9.-]*(pokemonshowdown\.com|psim\.us|smogon\.com)/gi;
	for (const m of text.matchAll(re)) offenders.push(`${path.relative(DEST, abs)}: ${m[0]}`);
}
if (offenders.length) {
	console.error('Upstream loads left in the export:\n' + offenders.join('\n'));
	process.exit(1);
}
console.log(`play client exported: ${files} files, ${(bytes / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, DEST)}`);
