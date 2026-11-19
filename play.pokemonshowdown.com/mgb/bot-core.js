/**
 * MGB bot core (decisions 0034, 0106): what the bot does, with no connection and no page around it.
 * Used by mgb/bot.js in the play client and by vendor/showdown-server/mgb/test-bot-battle.mjs, so
 * the headless test plays exactly the bot that players meet.
 *
 * - randomTeam(bundle, opts): a legal-looking team from the metagame's client bundle, as set objects
 *   (pack them with Teams.pack). A species with creator-approved sets (decision 0098) plays one of them;
 *   the rest get up to four random moves and a standard spread.
 * - choose(request): a random legal choice for a battle request, or '' when there is nothing to send.
 * - learnFromRejection(text, avoid): reads the server's team rejection and fills `avoid` so the next
 *   random team leaves out what was banned.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.MGB_BOT_CORE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var toID = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };

	/** Moves the default clauses ban (Evasion, OHKO); more are learned from the server's rejections. */
	function newAvoid() {
		return {
			moves: { doubleteam: 1, minimize: 1, acupressure: 1, fissure: 1, guillotine: 1, horndrill: 1, sheercold: 1 },
			species: {}, abilities: {},
		};
	}

	function shuffle(list, rnd) {
		var a = list.slice();
		for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
		return a;
	}

	/**
	 * A standard competitive spread from the species' base stats, so damage tests reflect a real set:
	 * 252 in the better attacking stat, 252 Speed if it's fast enough to use it (base 70+) or else 252 HP,
	 * the last 4 in the other bulk stat; the nature raises the attacking stat (or Speed when the other
	 * attacking stat is the one it lowers). Gen 1-2 have no natures and use maximum stat experience.
	 */
	function spread(sp, gen) {
		var b = sp.baseStats || { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
		if (gen <= 2) return { evs: { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 }, nature: '' };
		var physical = b.atk >= b.spa;
		var fast = b.spe >= 70;
		var evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
		evs[physical ? 'atk' : 'spa'] = 252;
		if (fast) { evs.spe = 252; evs.hp = 4; } else { evs.hp = 252; evs[b.def >= b.spd ? 'spd' : 'def'] = 4; }
		var nature = fast ? (physical ? 'Jolly' : 'Timid') : (physical ? 'Adamant' : 'Modest');
		return { evs: evs, nature: nature };
	}

	/**
	 * opts.sets: engine species id -> list of set objects (engine names), the creator-approved sets.
	 * opts.avoid: from newAvoid(), grown by learnFromRejection. opts.random: a () => [0, 1) source.
	 */
	function randomTeam(bundle, opts) {
		opts = opts || {};
		var avoid = opts.avoid || newAvoid();
		var rnd = opts.random || Math.random;
		var sets = opts.sets || {};
		// Mega forms (decision 0076) aren't picked: a team has the species and its stone, the form comes in battle.
		var ids = shuffle(Object.keys(bundle.species).filter(function (id) { return !avoid.species[id] && !bundle.species[id].megaOf; }), rnd);
		var size = Math.min(ids.length, (bundle.rules && bundle.rules.teamSize && bundle.rules.teamSize.max) || 6);
		return ids.slice(0, size).map(function (id) {
			var sp = bundle.species[id];
			var shown = sp.displayName || sp.name;
			var name = shown.length <= 18 ? shown : ''; // players see the display name (decision 0035)
			var own = (sets[toID(sp.name)] || []).filter(function (s) {
				return !s.moves.some(function (m) { return avoid.moves[toID(m)]; }) && !(s.ability && avoid.abilities[toID(s.ability)]);
			});
			if (own.length) {
				var s = own[Math.floor(rnd() * own.length)];
				var copy = {};
				for (var k in s) copy[k] = s[k];
				copy.species = sp.name;
				copy.name = name;
				return copy;
			}
			var abilities = sp.abilities || {};
			var sd = spread(sp, bundle.gen);
			return {
				species: sp.name, // engine name, as the server expects
				name: name,
				ability: ['0', '1', 'H', 'S'].map(function (k) { return abilities[k]; }).filter(function (a) { return a && !avoid.abilities[toID(a)]; })[0] || abilities['0'] || '',
				moves: shuffle((bundle.learnsets[id] || []).filter(function (m) { return !avoid.moves[m]; }), rnd).slice(0, 4),
				evs: sd.evs,
				nature: sd.nature,
			};
		});
	}

	/** Server rejection lines look like "Tidecat-Wda's move Double Team is banned by Evasion Moves Clause." */
	function learnFromRejection(text, avoid) {
		String(text).split('|').forEach(function (raw) {
			var line = raw.trim();
			var m = /^-?\s*(.+?)'s move (.+?) (?:is banned|is not allowed|can't|is illegal)/.exec(line);
			if (m) avoid.moves[toID(m[2])] = 1;
			var sp = /^-?\s*(.+?) is banned/.exec(line);
			if (sp && !/'s /.test(sp[1])) avoid.species[toID(sp[1])] = 1;
			var cant = /^-?\s*(.+?) can't learn (.+?)\.?$/.exec(line);
			if (cant) avoid.moves[toID(cant[2])] = 1;
			var none = /^-?\s*(.+?) has no moves/.exec(line);
			if (none) avoid.species[toID(none[1])] = 1;
			var ab = /^-?\s*(.+?)'s ability (.+?) (?:is banned|is not allowed|is illegal)/.exec(line);
			if (ab) avoid.abilities[toID(ab[2])] = 1;
		});
	}

	function pick(list, rnd) { return list[Math.floor(rnd() * list.length)]; }

	/** A random legal choice: team preview keeps the order, a forced switch picks a healthy reserve, else a usable move. */
	function choose(req, rnd) {
		rnd = rnd || Math.random;
		if (!req || req.wait) return '';
		if (req.teamPreview) return 'default';
		if (req.forceSwitch) {
			var options = [];
			req.side.pokemon.forEach(function (p, i) { if (!p.active && !/ fnt$/.test(p.condition)) options.push(i + 1); });
			return options.length ? 'switch ' + pick(options, rnd) : 'pass';
		}
		if (req.active) {
			var moves = [];
			req.active[0].moves.forEach(function (m, i) { if (!m.disabled && (m.pp === undefined || m.pp > 0)) moves.push(i + 1); });
			return moves.length ? 'move ' + pick(moves, rnd) : 'move 1';
		}
		return '';
	}

	return { toID: toID, newAvoid: newAvoid, spread: spread, randomTeam: randomTeam, learnFromRejection: learnFromRejection, choose: choose };
});
