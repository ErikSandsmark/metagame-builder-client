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
		// The teambuilder learnset check uses 'a' for gen 9 outside natdex.
		return gen === 9 ? 'a' : String(gen);
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
		});
		Object.keys(bundle.moves || {}).forEach(function (id) {
			var mv = bundle.moves[id];
			var engine = mv.name;
			var shown = mv.displayName || engine;
			var entry = Object.assign({}, mv, { id: id, name: shown });
			delete entry.displayName;
			window.BattleMovedex[id] = entry;
			for (var mod in Dex.moddedDexes) delete Dex.moddedDexes[mod].cache.Moves[id];
			// The compiler guarantees display names don't repeat a library move's name.
			if (toID(shown) !== id && !window.BattleMovedex[toID(shown)]) window.BattleAliases[toID(shown)] = engine;
			engineMoves[id] = engine;
			display[engine] = shown;
			insertSearchIndex(id, 'move');
		});
		rules = bundle.rules || { teamSize: { min: 1, max: 6 }, level: 100, speciesClause: true };
		if (window.MGB_TEXT) {
			window.MGB_TEXT.setTitle(bundle.title);
			window.MGB_TEXT.add(display);
		}
		var newsTitle = document.getElementById('mgb-news-title');
		if (newsTitle) newsTitle.textContent = bundle.title;
		bundleFormatId = bundle.formatId;
		refilterFormats();
		if (window.PS) PS.update();

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

	window.MGB_READY = fetch(bundleUrl).then(function (r) {
		if (!r.ok) throw new Error('bundle HTTP ' + r.status);
		return r.json();
	}).then(function (b) { window.MGB_BUNDLE_TITLE = b.title; window.MGB_BUNDLE = b; return b; }).then(apply).catch(function (e) {
		console.error('[MGB] bundle failed to load', e);
	});
})();
