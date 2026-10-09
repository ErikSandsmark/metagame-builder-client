/**
 * MGB sandbox bot (decision 0034). Only on the sandbox page (/m/<slug>/play?sandbox=1).
 *
 * A second connection from the owner's own browser, signed in as the owner's personal bot
 * ("MGB Bot xxxxxx", asserted by our web app for signed-in users only). The main menu's Battle
 * button becomes "Battle the bot": it challenges the bot with the selected team, and the bot accepts
 * with the team chosen under "Bot's team" (a random team from the metagame, the player's own team, or
 * one of the player's saved teams; random teams get a standard EV spread and nature) and picks random legal choices. Nothing runs on the server beyond a
 * normal user connection.
 */
(function () {
	'use strict';
	if (!window.MGB_PLAY || !MGB_PLAY.sandbox || !window.MGB_READY) return;

	var bundle, formatId, ws, botName = '', owner = '', botReady = false, retries = 0;
	// Moves the default clauses ban (Evasion, OHKO); more are learned from the server's rejections.
	var avoid = { doubleteam: 1, minimize: 1, acupressure: 1, fissure: 1, guillotine: 1, horndrill: 1, sheercold: 1 };
	var avoidSpecies = {}, avoidAbility = {};
	var accepting = 0; // retries left while accepting the owner's challenge
	var lastOwnerTeam = ''; // the team the owner challenged with ("Same as mine")
	var STORE = 'mgb-sandbox-botteam';
	var choice = 'random'; // 'random' | 'mirror' | 'team:<name>'
	try { choice = localStorage.getItem(STORE) || 'random'; } catch (e) {}

	function ownTeams() {
		return ((PS.teams && PS.teams.list) || []).filter(function (t) { return t.format === formatId && !t.isBox && t.packedTeam; });
	}
	/** The bot's team for the next battle, or '' for a random one. Fixed teams use engine names like the owner's. */
	function chosenTeam() {
		var engine = window.MGB_ENGINE_TEAM || function (x) { return x; };
		if (choice === 'mirror') return lastOwnerTeam ? engine(lastOwnerTeam) : '';
		if (choice.indexOf('team:') === 0) {
			var name = choice.slice(5);
			var t = ownTeams().filter(function (x) { return x.name === name; })[0];
			return t ? engine(t.packedTeam) : '';
		}
		return '';
	}
	function choiceLabel() {
		return choice === 'mirror' ? 'the same team as yours' : choice.indexOf('team:') === 0 ? '“' + choice.slice(5) + '”' : 'a random team';
	}
	var server = Config.defaultserver;
	var url = (server.httpport ? 'wss' : 'ws') + '://' + server.host + ':' + server.port + '/showdown/websocket';

	function log(msg) { console.log('[MGB bot] ' + msg); }
	function send(room, text) { if (ws && ws.readyState === 1) ws.send((room || '') + '|' + text); }
	function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
	function shuffle(list) {
		var a = list.slice();
		for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
		return a;
	}

	/** Random legal team: distinct species, first ability, up to four random moves. */
	/**
	 * A standard competitive spread from the species' base stats, so damage tests reflect a real set:
	 * 252 in the better attacking stat, 252 Speed if it's fast enough to use it (base 70+) or else 252 HP,
	 * the last 4 in the other bulk stat; the nature raises the attacking stat (or Speed when the other
	 * attacking stat is the one it lowers). Gen 1-2 have no natures and use maximum stat experience.
	 */
	function spread(sp) {
		var b = sp.baseStats || { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
		if (bundle.gen <= 2) return { evs: { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 }, nature: '' };
		var physical = b.atk >= b.spa;
		var fast = b.spe >= 70;
		var evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
		evs[physical ? 'atk' : 'spa'] = 252;
		if (fast) { evs.spe = 252; evs.hp = 4; } else { evs.hp = 252; evs[b.def >= b.spd ? 'spd' : 'def'] = 4; }
		// Jolly/Timid: +Spe, -unused attack; Adamant/Modest: +attack, -unused attack.
		var nature = fast ? (physical ? 'Jolly' : 'Timid') : (physical ? 'Adamant' : 'Modest');
		return { evs: evs, nature: nature };
	}

	function randomTeam() {
		var ids = shuffle(Object.keys(bundle.species).filter(function (id) { return !avoidSpecies[id]; }));
		var size = Math.min(ids.length, (bundle.rules && bundle.rules.teamSize.max) || 6);
		return Teams.pack(ids.slice(0, size).map(function (id) {
			var sp = bundle.species[id];
			var abilities = sp.abilities || {};
			var shown = sp.displayName || sp.name;
			return {
				species: sp.name, // engine name, as the server expects
				name: shown.length <= 18 ? shown : '', // players see the display name (decision 0035)
				ability: ['0', '1', 'H', 'S'].map(function (k) { return abilities[k]; }).filter(function (a) { return a && !avoidAbility[toID(a)]; })[0] || abilities['0'] || '',
				moves: shuffle((bundle.learnsets[id] || []).filter(function (m) { return !avoid[m]; })).slice(0, 4),
				evs: spread(sp).evs,
				nature: spread(sp).nature,
			};
		}));
	}

	/** The main menu's Battle button challenges the bot instead of searching for an opponent. */
	function takeOverBattleButton() {
		var menu = PS.mainmenu;
		menu.startSearch = function (format, team, parentElem) {
			if (!botReady) { PS.alert('The bot is still connecting. Try again in a few seconds.', { parentElem: parentElem }); return; }
			if (!team || !team.packedTeam) { PS.alert('Pick a team first (make one in the Teambuilder).', { parentElem: parentElem }); return; }
			lastOwnerTeam = team.packedTeam;
			PS.send('/utm ' + team.packedTeam);
			PS.send('/challenge ' + botName + ', ' + format);
		};
		// Relabel the button and add the "Bot's team" picker (the client re-renders the menu, so both
		// are re-applied whenever it redraws).
		var relabel = function () {
			var b = document.querySelector('button.mainmenu1');
			if (!b || b.disabled) return;
			if (b.getAttribute('data-mgb') !== 'bot') {
				b.setAttribute('data-mgb', 'bot');
				b.innerHTML = '<strong>Battle the bot</strong><br /><small>Your team vs random moves</small>';
			}
			var form = b.closest('form');
			if (form && !document.getElementById('mgb-botteam')) form.appendChild(botTeamPicker());
		};
		new MutationObserver(relabel).observe(document.body, { childList: true, subtree: true });
		relabel();
	}

	/** "Bot's team": Random / Same as mine / each saved team for this metagame. */
	function botTeamPicker() {
		var wrap = document.createElement('p');
		wrap.id = 'mgb-botteam';
		wrap.style.cssText = 'margin:8px 0 0;text-align:center;font-size:9pt';
		wrap.innerHTML = '<label title="The team the bot battles with">Bot\'s team: <select class="button" style="max-width:140px"></select></label>';
		var select = wrap.querySelector('select');
		var fill = function () {
			var opts = [['random', 'Random'], ['mirror', 'Same as mine']]
				.concat(ownTeams().map(function (t) { return ['team:' + t.name, t.name]; }));
			if (!opts.some(function (o) { return o[0] === choice; })) choice = 'random';
			select.innerHTML = '';
			opts.forEach(function (o) {
				var el = document.createElement('option');
				el.value = o[0]; el.textContent = o[1]; el.selected = o[0] === choice;
				select.appendChild(el);
			});
		};
		fill();
		select.addEventListener('mousedown', fill); // teams may have changed in the Teambuilder
		select.addEventListener('focus', fill);
		select.addEventListener('change', function () {
			choice = select.value;
			try { localStorage.setItem(STORE, choice); } catch (e) {}
		});
		return wrap;
	}

	function acceptWithNewTeam() {
		var fixed = chosenTeam();
		send('', '/utm ' + (fixed || randomTeam()));
		send('', '/accept ' + owner);
		if (fixed) accepting = 1; // a fixed team won't change on retry: one try, then explain
	}

	/** Server rejection lines look like "Tidecat-Wda's move Double Team is banned by Evasion Moves Clause." */
	function learnFromRejection(text) {
		text.split('|').forEach(function (line) {
			var m = /^-?\s*(.+?)'s move (.+?) (?:is banned|is not allowed|can't|is illegal)/.exec(line.trim());
			if (m) avoid[toID(m[2])] = 1;
			var sp = /^-?\s*(.+?) is banned/.exec(line.trim());
			if (sp && !/'s /.test(sp[1])) avoidSpecies[toID(sp[1])] = 1;
			var cant = /^-?\s*(.+?) can't learn (.+?)\.?$/.exec(line.trim());
			if (cant) avoid[toID(cant[2])] = 1;
			var none = /^-?\s*(.+?) has no moves/.exec(line.trim());
			if (none) avoidSpecies[toID(none[1])] = 1;
			var ab = /^-?\s*(.+?)'s ability (.+?) (?:is banned|is not allowed|is illegal)/.exec(line.trim());
			if (ab) avoidAbility[toID(ab[2])] = 1;
		});
	}

	function choose(room, req) {
		if (req.wait) return;
		var choice;
		if (req.teamPreview) choice = 'default';
		else if (req.forceSwitch) {
			var options = [];
			req.side.pokemon.forEach(function (p, i) { if (!p.active && p.condition.slice(-4) !== ' fnt' && p.condition !== '0 fnt') options.push(i + 1); });
			choice = options.length ? 'switch ' + pick(options) : 'pass';
		} else if (req.active) {
			var moves = [];
			req.active[0].moves.forEach(function (m, i) { if (!m.disabled && (m.pp === undefined || m.pp > 0)) moves.push(i + 1); });
			choice = moves.length ? 'move ' + pick(moves) : 'move 1';
		}
		if (choice) send(room, '/choose ' + choice + '|' + req.rqid);
	}

	function onLine(room, line) {
		var parts = line.split('|');
		switch (parts[1]) {
		case 'challstr':
			var body = new URLSearchParams({ act: 'botassertion', challstr: parts.slice(2).join('|') });
			fetch(MGB_PLAY.authEndpoint, { method: 'POST', body: body, credentials: 'include' }).then(function (r) { return r.text(); }).catch(function (e) { log('bot sign-in failed: ' + e); return ''; }).then(function (t) {
				if (t.charAt(0) !== ']') { log('no bot identity: ' + t); return; }
				var data = JSON.parse(t.slice(1));
				botName = data.name;
				send('', '/trn ' + data.name + ',0,' + data.assertion);
			});
			break;
		case 'updateuser':
			if (parts[3] === '1' && toID(parts[2]) === toID(botName)) {
				log('signed in as ' + botName);
				send('', '/utm ' + randomTeam());
				botReady = true;
			}
			break;
		case 'pm':
			// An incoming challenge from the owner: accept with a fresh team.
			// Only the owner's challenges in this tab's metagame (another tab may run another sandbox).
			if (/\/challenge\s/.test(parts.slice(4).join('|')) && toID(parts[2]) === toID(owner) && parts.slice(4).join('|').indexOf(formatId) >= 0) {
				accepting = 8;
				acceptWithNewTeam();
			}
			break;
		case 'popup':
			var text = parts.slice(2).join('|');
			log('server: ' + text);
			// Our team was rejected while accepting: leave out what was banned and try again.
			if (accepting && /rejected|banned|can't learn|not allowed|illegal/i.test(text)) {
				learnFromRejection(text);
				var fixedTeam = choice !== 'random';
				if (!fixedTeam && --accepting > 0) acceptWithNewTeam();
				else {
					accepting = 0;
					send('', '/reject ' + owner);
					// The bot runs in the owner's page, so tell them right there.
					var reasons = text.split('|').filter(function (l) { return /^- /.test(l); }).join('\n');
					PS.alert((fixedTeam
						? 'The bot can\'t battle with ' + choiceLabel() + '. Pick another team, or Random, under "Bot\'s team".'
						: 'The bot couldn\'t build a legal random team for this metagame.') + '\n\n' + reasons);
				}
			}
			break;
		case 'init':
			if (parts[2] === 'battle') accepting = 0;
			break;
		case 'request':
			if (parts[2]) choose(room, JSON.parse(parts.slice(2).join('|')));
			break;
		case 'win': case 'tie':
			send(room, '/leave');
			break;
		}
	}

	function connect() {
		ws = new WebSocket(url);
		ws.onmessage = function (e) {
			var data = String(e.data), room = '';
			if (data.charAt(0) === '>') { var nl = data.indexOf('\n'); room = data.slice(1, nl); data = data.slice(nl + 1); }
			data.split('\n').forEach(function (line) { if (line.charAt(0) === '|') onLine(room, line); });
		};
		// The battle server restarts on deploys: come back on our own (with a growing delay).
		ws.onclose = function () {
			botReady = false;
			log('disconnected; reconnecting');
			setTimeout(connect, Math.min(30000, 2000 * Math.pow(2, retries++)));
		};
		ws.onopen = function () { retries = 0; };
	}

	MGB_READY.then(function () {
		bundle = window.MGB_BUNDLE;
		if (!bundle) return;
		formatId = bundle.formatId;
		var news = document.getElementById('room-news');
		if (news) news.querySelector('.readable-bg').innerHTML = '<div class="newsentry"><h4>Sandbox: your draft vs the bot</h4>' +
			'<p>1. Open <strong>Teambuilder</strong> and make a team.</p><p>2. Back here, pick the team and press <strong>Battle the bot</strong>. ' +
			'Press it again for another battle.</p><p>Under <strong>Bot\'s team</strong>, choose what the bot plays: a random team, the same team as yours, or one of your saved teams (good for testing how a creature holds up).</p>' +
			'<p>The bot picks random moves. Nothing here is published.</p></div>';
		if (window.MGB_HOUSE_RULES) MGB_HOUSE_RULES();
		// Wait until the owner has their own name (signed in), then bring the bot online.
		var wait = setInterval(function () {
			if (!PS.user.named) return;
			clearInterval(wait);
			owner = PS.user.name;
			takeOverBattleButton();
			connect();
		}, 500);
	});
})();
