/**
 * MGB runtime data bundle loader (Spike A).
 *
 * Loads one metagame's client data bundle at runtime and merges it into the
 * client's global data tables, then overrides species list, sprite and icon
 * lookup for that metagame. No upstream file is edited: every hook is a
 * wrapper installed from here, after the upstream scripts have loaded.
 *
 * Bundle URL: MGB_PLAY.bundleUrl (production page), else ?mgb=<url> on the page URL.
 * Also: custom moves and, on the production page, a format list reduced to this metagame
 * (decision 0030).
 *
 * Display names (decision 0035): in the client, our species and custom moves are *named* with the
 * creator's display names ("Emberpup"), with aliases so typed or imported names resolve to them.
 * Teams are stored and exported with display names and converted to engine names ("Emberpup-Cnn")
 * only when sent to the server. Equal information (decision 0033): each active creature shows its
 * types and all its possible abilities under its name.
 */
(function () {
	'use strict';

	var params = new URLSearchParams(location.search.replace(/^\?~~[^&]*&?/, '?'));
	var bundleUrl = (window.MGB_PLAY && window.MGB_PLAY.bundleUrl) || params.get('mgb');
	if (!bundleUrl) return;
	var bundleFormatId = '';

	var custom = {}; // speciesid -> { front, back, icon }
	var engineSpecies = {}; // speciesid -> engine name ("Emberpup-Cnn")
	var engineMoves = {}; // custom move id -> engine name
	var rules = null;
	var formatKey = ''; // format id without the genN prefix, as DexSearch stores it

	function genChar(gen) {
		// The teambuilder lists a move only if its learnset entry has the generation digit; for Gen 9
		// outside natdex its legality check also wants the 'a' marker. So Gen 9 entries are '9a'.
		return gen === 9 ? '9a' : String(gen);
	}

	function insertSearchIndex(id, type) {
		var idx = window.BattleSearchIndex;
		if (!idx) return;
		var lo = 0, hi = idx.length;
		while (lo < hi) {
			var mid = (lo + hi) >> 1;
			if (idx[mid][0] < id) lo = mid + 1; else hi = mid;
		}
		if (idx[lo] && idx[lo][0] === id && idx[lo][1] === type) return;
		idx.splice(lo, 0, [id, type]);
		window.BattleSearchIndexOffset.splice(lo, 0, '');
		// alias entries point at their original entry by index
		for (var i = 0; i < idx.length; i++) {
			if (idx[i].length > 2 && typeof idx[i][2] === 'number' && idx[i][2] >= lo && i !== lo) idx[i][2]++;
		}
	}

	// Search by any word of a species' display name (e.g. "charizard" finds "Missing Charizard"), and by
	// the display name itself when it differs from the engine id (renamed species). Alias entries use
	// Showdown's format [alias, type, index of the real entry, highlight offset]; offset 0 = no highlight.
	function insertSearchAliases(id, type, displayName) {
		var idx = window.BattleSearchIndex;
		if (!idx) return;
		var words = String(displayName).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
		for (var k = 0; k < words.length; k++) {
			var alias = words.slice(k).join('');
			if (!alias || id.indexOf(alias) === 0) continue; // the real entry already matches this prefix
			var lo = 0, hi = idx.length;
			while (lo < hi) { var mid = (lo + hi) >> 1; if (idx[mid][0] < alias) lo = mid + 1; else hi = mid; }
			var dup = false;
			for (var j = lo; j < idx.length && idx[j][0] === alias; j++) if (idx[j].length > 2 && idx[idx[j][2]] && idx[idx[j][2]][0] === id) dup = true;
			if (dup) continue;
			idx.splice(lo, 0, [alias, type, -1, 0]);
			window.BattleSearchIndexOffset.splice(lo, 0, '');
			for (var i = 0; i < idx.length; i++) {
				if (i !== lo && idx[i].length > 2 && typeof idx[i][2] === 'number' && idx[i][2] >= lo) idx[i][2]++;
			}
			var t = 0, u = idx.length;
			while (t < u) { var m = (t + u) >> 1; if (idx[m][0] < id) t = m + 1; else u = m; }
			while (t < idx.length && idx[t][0] === id && !(idx[t].length <= 2 && idx[t][1] === type)) t++;
			idx[lo][2] = t;
		}
	}

	// Items (decision 0045): the teambuilder offers the frame generation's item list; items removed from
	// the metagame leave it, and items added from other generations come first. Items outside the list
	// show as illegal, matching the server (removed items are banned, added ones enabled in the mod).
	function applyItems(bundle) {
		var it = bundle.items;
		var tables = window.BattleTeambuilderTable;
		var table = bundle.gen < 9 ? tables['gen' + bundle.gen] : tables;
		if (!it || !table) return;
		var rows = table.itemSet || (table.items || []).map(function (r) { return typeof r === 'string' ? ['item', r] : [r[0], r[1]]; });
		var removed = {};
		(it.removed || []).forEach(function (id) { removed[id] = true; });
		rows = rows.filter(function (r) { return !(r[0] === 'item' && removed[r[1]]); });
		// Drop headers whose section is now empty.
		rows = rows.filter(function (r, i) { return r[0] !== 'header' || (i + 1 < rows.length && rows[i + 1][0] !== 'header'); });
		var added = (it.added || []).filter(function (id) { return !removed[id]; });
		if (added.length) rows = [['header', 'Added to this metagame']].concat(added.map(function (id) { return ['item', id]; }), rows);
		table.itemSet = rows;
		table.items = null;
	}

	function apply(bundle) {
		var base = new URL(bundleUrl, location.href);
		formatKey = bundle.formatId.replace(/^gen\d/, '');
		var gc = genChar(bundle.gen);
		var tables = window.BattleTeambuilderTable;

		var display = {};
		Object.keys(bundle.species).forEach(function (id) {
			var entry = Object.assign({}, bundle.species[id]);
			var engine = entry.name;
			var shown = entry.displayName || engine;
			entry.name = shown;
			// baseSpecies stays the engine name: the client looks species up by it (a display name
			// would alias back to the same entry and recurse), and the text layer covers where it shows.
			entry.baseSpecies = engine;
			entry.tier = entry.tier || 'OU';
			delete entry.displayName;
			delete entry.specId;
			window.BattlePokedex[id] = entry;
			for (var mod in Dex.moddedDexes) delete Dex.moddedDexes[mod].cache.Species[id];
			if (toID(shown) !== id) window.BattleAliases[toID(shown)] = engine;
			engineSpecies[id] = engine;
			display[engine] = shown;
			var ls = {};
			(bundle.learnsets[id] || []).forEach(function (m) { ls[m] = gc; });
			tables.learnsets[id] = ls;
			var s = bundle.sprites[id] || {};
			custom[id] = {
				front: s.front && new URL(s.front, base).href,
				back: s.back && new URL(s.back, base).href,
				icon: s.icon && new URL(s.icon, base).href,
			};
			insertSearchIndex(id, 'pokemon');
			insertSearchAliases(id, 'pokemon', shown);
		});
		// Library moves this metagame actually uses (in any learnset); custom moves are keyed separately.
		var usedLibrary = {};
		Object.keys(bundle.learnsets).forEach(function (sid) {
			bundle.learnsets[sid].forEach(function (m) { if (!(bundle.moves || {})[m]) usedLibrary[m] = true; });
		});
		Object.keys(bundle.moves || {}).forEach(function (id) {
			var mv = bundle.moves[id];
			var engine = mv.name;
			var shown = mv.displayName || engine;
			var entry = Object.assign({}, mv, { id: id, name: shown });
			delete entry.displayName;
			window.BattleMovedex[id] = entry;
			for (var mod in Dex.moddedDexes) delete Dex.moddedDexes[mod].cache.Moves[id];
			// A custom move's name means the custom move on this page, even when an official move has the
			// same name (e.g. a custom "Bullet Punch" in Gen 3, where the official one is Gen 4). The
			// compiler refuses the ambiguous case: a custom name equal to an official move the metagame uses.
			if (toID(shown) !== id && !usedLibrary[toID(shown)]) {
				window.BattleAliases[toID(shown)] = engine;
				for (var mod2 in Dex.moddedDexes) delete Dex.moddedDexes[mod2].cache.Moves[toID(shown)];
			}
			engineMoves[id] = engine;
			display[engine] = shown;
			insertSearchIndex(id, 'move');
		});
		applyItems(bundle);
		rules = bundle.rules || { teamSize: { min: 1, max: 6 }, level: 100, speciesClause: true };
		// Moves the frame generation dropped ("Past", e.g. Pursuit in Gen 9) exist in this metagame when
		// the creator gave them to a species (the compiler enables them on the server); show them too.
		Object.keys(bundle.learnsets).forEach(function (sid) {
			bundle.learnsets[sid].forEach(function (m) {
				var entry = window.BattleMovedex[m];
				if (entry && entry.isNonstandard === 'Past') {
					entry.isNonstandard = null;
					for (var mod in Dex.moddedDexes) delete Dex.moddedDexes[mod].cache.Moves[m];
				}
			});
		});
		if (window.MGB_TEXT) {
			window.MGB_TEXT.setTitle(bundle.title);
			window.MGB_TEXT.add(display);
		}
		var newsTitle = document.getElementById('mgb-news-title');
		if (newsTitle) newsTitle.textContent = bundle.title;
		showHouseRules(bundle);
		bundleFormatId = bundle.formatId;
		migrateTeams();
		// The team list may already have been drawn (e.g. the page opened on #teambuilder) before this
		// bundle arrived; its cached icons are blanks for our species, so redraw them now.
		if (window.PS && PS.teams) PS.teams.list.forEach(function (team) { team.iconCache = null; });
		refilterFormats();
		if (window.PS) {
			PS.update();
			for (var rid in PS.rooms) if (rid === 'teambuilder' || rid.indexOf('team-') === 0) PS.rooms[rid].update(null);
		}

		var rows = [['header', bundle.title]].concat(Object.keys(bundle.species).map(function (id) {
			return ['pokemon', id];
		}));
		var origBase = BattlePokemonSearch.prototype.getBaseResults;
		BattlePokemonSearch.prototype.getBaseResults = function () {
			if (this.format !== formatKey) return origBase.apply(this, arguments);
			if (!rules.speciesClause || !editor) return rows.slice();
			// Species Clause: species already on the team (other slots) are not offered again.
			var current = this.set;
			var taken = {};
			(editor.sets || []).forEach(function (set) { if (set && set !== current && set.species) taken[Dex.species.get(set.species).id] = true; });
			return rows.filter(function (r) { return r[0] !== 'pokemon' || !taken[r[1]]; });
		};

		console.log('[MGB] bundle applied: ' + bundle.formatId + ', ' + Object.keys(bundle.species).length + ' species');
	}

	// Status rules (decision 0042) are shown to players: changed mechanics must never be a surprise.
	window.MGB_HOUSE_RULES = function () { if (window.MGB_BUNDLE) showHouseRules(window.MGB_BUNDLE); };
	function showHouseRules(bundle) {
		var c = (bundle.mechanics && bundle.mechanics.conditions) || {};
		var names = { par: 'Paralysis', brn: 'Burn', slp: 'Sleep', frz: 'Freeze', psn: 'Poison', tox: 'Bad poison', confusion: 'Confusion', flinch: 'Flinch' };
		var lines = [];
		Object.keys(c).forEach(function (id) {
			var r = c[id];
			if (r.enabled === false) { lines.push(names[id] + ' is turned off.'); return; }
			if (id === 'par' && r.fullParalysis === false) lines.push('Paralysis never fully paralyses.');
			if (id === 'par' && r.speedDrop === false) lines.push('Paralysis doesn\'t lower Speed.');
			if (id === 'brn' && r.residual === false) lines.push('Burn deals no damage at the end of the turn.');
		});
		var news = document.querySelector('#room-news .newsentry');
		if (!lines.length || !news || news.querySelector('.mgb-house-rules')) return;
		var box = document.createElement('div');
		box.className = 'mgb-house-rules';
		box.innerHTML = '<p><strong>House rules</strong></p><ul>' + lines.map(function (l) { return '<li>' + BattleLog.escapeHTML(l) + '</li>'; }).join('') + '</ul>';
		news.appendChild(box);
	}

	function speciesId(pokemon) {
		if (!pokemon) return '';
		var name;
		if (typeof pokemon === 'string') name = pokemon;
		else if (pokemon.volatiles && pokemon.volatiles.formechange && !pokemon.volatiles.transform) name = pokemon.volatiles.formechange[1];
		else name = pokemon.speciesForme || pokemon.species || pokemon.name;
		return Dex.species.get(name).id || toID(name); // display names resolve through aliases
	}

	var origSprite = Dex.getSpriteData;
	Dex.getSpriteData = function (pokemon, isFront, options) {
		var c = custom[speciesId(pokemon)];
		if (!c) return origSprite.apply(this, arguments);
		return {
			gen: (options && options.gen) || 6,
			w: 96, h: 96, y: 0,
			url: isFront ? c.front : (c.back || c.front),
			pixelated: false,
			isFrontSprite: !!isFront,
			cryurl: '',
			shiny: false,
		};
	};

	var origTbSprite = Dex.getTeambuilderSprite;
	Dex.getTeambuilderSprite = function (pokemon) {
		var c = pokemon && custom[speciesId(pokemon.species || pokemon)];
		if (!c) return origTbSprite.apply(this, arguments);
		return 'background-image:url(' + c.front + ');background-position:center;background-size:contain;background-repeat:no-repeat';
	};

	var origIcon = Dex.getPokemonIcon;
	Dex.getPokemonIcon = function (pokemon) {
		var c = custom[speciesId(pokemon)];
		if (!c || !c.icon) return origIcon.apply(this, arguments);
		// Fainted creatures are greyed out and crossed, on both sides (team icons, switch buttons).
		var fainted = pokemon && typeof pokemon === 'object' && pokemon.fainted;
		return fainted
			? 'background:linear-gradient(to top right,transparent 46%,#c00 46%,#c00 54%,transparent 54%),url(' + c.icon + ') no-repeat center;background-size:contain;opacity:.55;filter:grayscale(100%)'
			: 'background:transparent url(' + c.icon + ') no-repeat center;background-size:contain';
	};

	// Production page: the menus only offer this metagame's format.
	var lastFormats = null;
	function filterFormats(list) {
		var keep = [list[0], ',1', 'Metagame Builder'];
		for (var i = 1; i < list.length; i++) {
			var e = list[i];
			if (!e || e.charAt(0) === ',') continue;
			var name = e.lastIndexOf(',') >= 0 ? e.slice(0, e.lastIndexOf(',')) : e;
			if (toID(name) === bundleFormatId) {
				keep.push(e);
				if (window.MGB_TEXT) window.MGB_TEXT.add(makeMap(name));
			}
		}
		return keep;
	}
	function makeMap(name) {
		// The menus show the name with and without the "[Gen N] " prefix.
		var m = {}, title = window.MGB_BUNDLE_TITLE || name;
		m[name] = title;
		m[name.replace(/^\[Gen \d\] /, '')] = title;
		m[bundleFormatId.replace(/^gen\d/, '')] = title; // team folders show the raw id
		return m;
	}
	// The format list can arrive before this script runs, so filter what was already parsed too.
	function refilterFormats() {
		if (!window.MGB_PLAY || !bundleFormatId) return;
		if (lastFormats && window.PS && PS.mainmenu) {
			PS.mainmenu.parseFormats(lastFormats);
		} else if (window.BattleFormats) {
			for (var id in BattleFormats) if (id !== bundleFormatId) delete BattleFormats[id];
			var f = BattleFormats[bundleFormatId];
			if (f && window.MGB_TEXT) window.MGB_TEXT.add(makeMap(f.name));
		}
		if (window.PS && PS.mainmenu) PS.mainmenu.update(null);
	}
	if (window.MGB_PLAY && window.MainMenuRoom) {
		var origParse = MainMenuRoom.prototype.parseFormats;
		MainMenuRoom.prototype.parseFormats = function (list) {
			if (list !== lastFormats) lastFormats = list;
			return origParse.call(this, bundleFormatId ? filterFormats(list) : list);
		};
	}

	// Forms default to this metagame's format instead of upstream's random battle.
	if (window.MGB_PLAY && window.TeamForm) {
		var origRender = TeamForm.prototype.render;
		TeamForm.prototype.render = function () {
			// Before upstream's render picks its random-battle default (empty format), or after it did.
			if (bundleFormatId && !this.props.format && (!this.format ||
				(window.BattleFormats && !BattleFormats[toID(this.format.split('@@@')[0])]))) this.format = bundleFormatId;
			return origRender.apply(this, arguments);
		};
	}

	// A team made for an older version (or the sandbox) of this metagame follows it to the version
	// shown on this page; otherwise it would be validated against the old rules (e.g. a move the
	// creator added later would be "illegal").
	function migrateTeams() {
		if (!window.MGB_PLAY || !window.PS || !PS.teams) return;
		var m = /^(gen\dmgb[0-9a-f]{12})(v\d+|sandbox)$/.exec(bundleFormatId);
		if (!m) return;
		var moved = 0;
		PS.teams.list.forEach(function (team) {
			var f = /^(gen\dmgb[0-9a-f]{12})(v\d+|sandbox)$/.exec(team.format || '');
			if (f && f[1] === m[1] && team.format !== bundleFormatId) { team.format = bundleFormatId; moved++; }
		});
		if (moved) {
			PS.teams.save();
			console.log('[MGB] moved ' + moved + ' team(s) to ' + bundleFormatId);
		}
	}

	// Teams go to the server with engine names; nicknames default to the display name (decision 0035).
	function toEngineTeam(packed) {
		if (!packed || !window.Teams) return packed;
		var sets = Teams.unpack(packed);
		if (!sets) return packed;
		sets.forEach(function (set) {
			var sid = Dex.species.get(set.species).id;
			if (engineSpecies[sid]) {
				var shown = set.species;
				set.species = engineSpecies[sid];
				if (!set.name && shown.length <= 18) set.name = shown;
			}
			set.moves = (set.moves || []).map(function (m) {
				var mid = Dex.moves.get(m).id;
				return engineMoves[mid] || m;
			});
		});
		return Teams.pack(sets);
	}
	window.MGB_ENGINE_TEAM = toEngineTeam; // the sandbox bot sends teams on its own connection
	if (window.PS && PS.send) {
		var origSend = PS.send;
		PS.send = function (msg) {
			if (typeof msg === 'string' && msg.indexOf('/utm ') === 0) {
				arguments[0] = '/utm ' + toEngineTeam(msg.slice(5));
			}
			return origSend.apply(this, arguments);
		};
	}

	// The team editor currently open (for the Species Clause filter above).
	var editor = null;
	if (window.TeamEditorState) {
		var origUpdateTeam = TeamEditorState.prototype.updateTeam;
		TeamEditorState.prototype.updateTeam = function () {
			editor = this;
			return origUpdateTeam.apply(this, arguments);
		};
	}

	// Equal information (decision 0033): types and every possible ability under each active creature.
	if (window.PokemonSprite) {
		var origStatbar = PokemonSprite.prototype.getStatbarHTML;
		PokemonSprite.prototype.getStatbarHTML = function (pokemon) {
			var html = origStatbar.apply(this, arguments);
			try {
				var species = Dex.species.get(pokemon.speciesForme);
				if (!species.exists) return html;
				var types = pokemon.getTypeList ? pokemon.getTypeList() : species.types;
				var abilities = [];
				for (var k in species.abilities) if (species.abilities[k] && abilities.indexOf(species.abilities[k]) < 0) abilities.push(species.abilities[k]);
				var tags = '<div class="mgb-info">' + types.map(function (t) {
					return '<img src="' + Dex.resourcePrefix + 'sprites/types/' + encodeURIComponent(t) + '.png" alt="' + BattleLog.escapeHTML(t) + '" width="32" height="14" />';
				}).join('') + (abilities.length ? ' <span>' + abilities.map(BattleLog.escapeHTML).join(' / ') + '</span>' : '') + '</div>';
				// Upstream leaves the statbar's own div open; the tags go after the HP bar inside it.
				return html + tags;
			} catch (e) {
				return html;
			}
		};
	}

	// New teams start in this metagame's format.
	if (window.MGB_PLAY && window.TeambuilderRoom) {
		var origCreate = TeambuilderRoom.prototype.createTeam;
		TeambuilderRoom.prototype.createTeam = function (copyFrom) {
			var team = origCreate.apply(this, arguments);
			if (!copyFrom && bundleFormatId) team.format = bundleFormatId;
			return team;
		};
	}

	// Version watch (published pages only): never keep players on an older version. A team made
	// there would be checked against the old rules (e.g. a move added in the new version "does not
	// exist"). While a newer version loads on the battle server, say so; once it is live, switch
	// (reload, which also moves teams over) unless a battle is in progress.
	var banner = null;
	function showBanner(html) {
		if (!banner) {
			banner = document.createElement('div');
			banner.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:10000;background:#1e3a8a;color:#fff;' +
				'padding:6px 12px;border-radius:6px;font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:90%';
			document.body.appendChild(banner);
		}
		banner.innerHTML = html;
	}
	function inBattle() {
		return window.PS && Object.keys(PS.rooms).some(function (id) {
			var room = PS.rooms[id];
			return id.indexOf('battle-') === 0 && room.battle && !room.battle.ended && room.side;
		});
	}
	function watchVersions(bundle) {
		if (!window.MGB_PLAY || MGB_PLAY.sandbox || !MGB_PLAY.slug) return;
		var current = bundle.version;
		var check = function () {
			fetch('/api/play/' + MGB_PLAY.slug + '/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (st) {
				if (!st) return schedule(60000);
				if (st.live && st.live > current) {
					if (inBattle()) {
						showBanner(BattleLog.escapeHTML(bundle.title) + ' was updated to version ' + st.live + '. <button class="button" onclick="location.reload()">Reload</button> after your battle to use it.');
						return schedule(30000);
					}
					// Guard against a reload loop if the page keeps getting the old version.
					var key = 'mgb-switch-' + MGB_PLAY.slug + '-' + st.live, tries = 0;
					try { tries = Number(sessionStorage.getItem(key) || 0); sessionStorage.setItem(key, String(tries + 1)); } catch (e) {}
					if (tries >= 2) {
						showBanner('Version ' + st.live + ' is out. <button class="button" onclick="location.reload()">Reload</button> to use it.');
						return schedule(60000);
					}
					showBanner('Switching to version ' + st.live + ' of ' + BattleLog.escapeHTML(bundle.title) + '…');
					setTimeout(function () { location.reload(); }, 1200);
					return;
				}
				if (st.loading && st.latest > current) {
					showBanner('Version ' + st.latest + ' of ' + BattleLog.escapeHTML(bundle.title) + ' is loading on the battle server. This page switches to it automatically; wait a moment before making teams.');
					return schedule(3000);
				}
				if (st.error && st.latest > current) {
					showBanner('Version ' + st.latest + ' could not be loaded on the battle server. You are playing version ' + current + '.');
				}
				schedule(60000);
			}).catch(function () { schedule(60000); });
		};
		var schedule = function (ms) { setTimeout(check, ms); };
		check();
	}

	window.MGB_READY = fetch(bundleUrl).then(function (r) {
		if (!r.ok) throw new Error('bundle HTTP ' + r.status);
		return r.json();
	}).then(function (b) { window.MGB_BUNDLE_TITLE = b.title; window.MGB_BUNDLE = b; return b; }).then(function (b) {
		apply(b);
		watchVersions(b);
		return b;
	}).catch(function (e) {
		console.error('[MGB] bundle failed to load', e);
	});
})();
