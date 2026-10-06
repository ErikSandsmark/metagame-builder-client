/**
 * MGB sandbox bot (decision 0034). Only on the sandbox page (/m/<slug>/play?sandbox=1).
 *
 * A second connection from the owner's own browser, signed in as the owner's personal bot
 * ("MGB Bot xxxxxx", asserted by our web app for signed-in users only). The main menu's Battle
 * button becomes "Battle the bot": it challenges the bot with the selected team, and the bot accepts
 * with a random team from the metagame and picks random legal choices. Nothing runs on the server
 * beyond a normal user connection.
 */
(function () {
	'use strict';
	if (!window.MGB_PLAY || !MGB_PLAY.sandbox || !window.MGB_READY) return;

	var bundle, formatId, ws, botName = '', owner = '', botReady = false;
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
	function randomTeam() {
		var ids = shuffle(Object.keys(bundle.species));
		var size = Math.min(ids.length, (bundle.rules && bundle.rules.teamSize.max) || 6);
		return Teams.pack(ids.slice(0, size).map(function (id) {
			var sp = bundle.species[id];
			var abilities = sp.abilities || {};
			var shown = sp.displayName || sp.name;
			return {
				species: sp.name, // engine name, as the server expects
				name: shown.length <= 18 ? shown : '', // players see the display name (decision 0035)
				ability: abilities['0'] || '',
				moves: shuffle(bundle.learnsets[id] || []).slice(0, 4),
				evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
			};
		}));
	}

	/** The main menu's Battle button challenges the bot instead of searching for an opponent. */
	function takeOverBattleButton() {
		var menu = PS.mainmenu;
		menu.startSearch = function (format, team, parentElem) {
			if (!botReady) { PS.alert('The bot is still connecting. Try again in a few seconds.', { parentElem: parentElem }); return; }
			if (!team || !team.packedTeam) { PS.alert('Pick a team first (make one in the Teambuilder).', { parentElem: parentElem }); return; }
			PS.send('/utm ' + team.packedTeam);
			PS.send('/challenge ' + botName + ', ' + format);
		};
		// Relabel the button (rendered by the client, so re-applied whenever the menu redraws).
		var relabel = function () {
			var b = document.querySelector('button.mainmenu1');
			if (!b || b.disabled || b.getAttribute('data-mgb') === 'bot') return;
			b.setAttribute('data-mgb', 'bot');
			b.innerHTML = '<strong>Battle the bot</strong><br /><small>Your team vs random moves</small>';
		};
		new MutationObserver(relabel).observe(document.body, { childList: true, subtree: true });
		relabel();
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
			fetch(MGB_PLAY.authEndpoint, { method: 'POST', body: body, credentials: 'include' }).then(function (r) { return r.text(); }).then(function (t) {
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
			if (/\/challenge\s/.test(parts.slice(4).join('|')) && toID(parts[2]) === toID(owner)) {
				send('', '/utm ' + randomTeam());
				send('', '/accept ' + owner);
			}
			break;
		case 'popup':
			log('server: ' + parts.slice(2).join('|'));
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
		ws.onclose = function () { log('disconnected'); };
	}

	MGB_READY.then(function () {
		bundle = window.MGB_BUNDLE;
		if (!bundle) return;
		formatId = bundle.formatId;
		var news = document.getElementById('room-news');
		if (news) news.querySelector('.readable-bg').innerHTML = '<div class="newsentry"><h4>Sandbox: your draft vs the bot</h4>' +
			'<p>1. Open <strong>Teambuilder</strong> and make a team.</p><p>2. Back here, pick the team and press <strong>Battle the bot</strong>. ' +
			'Press it again for another battle.</p><p>The bot picks random moves. Nothing here is published.</p></div>';
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
