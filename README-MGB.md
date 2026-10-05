# Metagame Builder — play client source

This is the complete source of the battle client served by Metagame Builder's play pages, published
under the GNU Affero General Public License v3 (see `LICENSE`), as the licence requires.

- **Upstream:** [smogon/pokemon-showdown-client](https://github.com/smogon/pokemon-showdown-client), commit `f7dac498bb00b920227a32502267d7de358ae965`.
- **Our changes** live only in `play.pokemonshowdown.com/mgb/` (production page `client.html`, runtime data
  bundle loader, display-name text layer, sandbox bot, login bridge, theme and our own neutral images).
  Upstream files are not edited.
- **Deployment:** `mgb-tools/export-play-client.mjs` copies an allow-list of the built client for hosting
  and rewrites absolute upstream URLs to our own path; `mgb-tools/play-assets.mjs` generates the images in
  `mgb/assets/`. Both are shown as they run in our private build; paths refer to that layout.
- **Build:** `npm ci && node build full --no-update` (see upstream `README.md`).

Synced from the private repository at `db18fb0` on 2026-10-05. This mirror contains no server
code, keys or private endpoints.
