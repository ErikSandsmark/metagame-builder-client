/**
 * MGB bot (decisions 0034, 0106): battle a random-move bot without waiting for another player.
 *
 * A second connection from the player's own browser, signed in as the player's personal bot
 * ("MGB Bot xxxxxx", asserted by our web app for signed-in users only). What the bot plays and
 * how it chooses is in mgb/bot-core.js. Nothing runs on the server beyond a normal user connection,
 * and bot battles are challenges, so they are never rated (decision 0097).
 *
 * Sandbox (/m/<slug>/play?sandbox=1, the owner's draft): the main menu's Battle button becomes
 * "Battle the bot", with a "Bot's team" picker (a random team, the player's own, or a saved team).
 *
 * Published metagames: Battle! still finds a real opponent; a second button, "Battle the bot",
 * challenges the bot. The player plays a random team or the team selected above (picker under the
 * button); the bot always plays a random one, built from the creator's approved sets where a species
 * has some. With ?bot=1 (the metagame page's "Battle the bot"), the first battle starts by itself.
 * The bot connects only when it is first needed.
 */
(function () {
	'use strict';
	if (!window.MGB_PLAY || !window.MGB_READY || !window.MGB_BOT_CORE) return;
	var core = MGB_BOT_CORE;
	var sandbox = !!MGB_PLAY.sandbox;

	var bundle, formatId, ws, botName = '', owner = '', botReady = false, retries = 0, connecting = false;
	var avoid = core.newAvoid();
	var approved = {}; // engine species id -> approved sets (engine names)
	var accepting = 0; // retries left while accepting the owner's challenge
	var lastOwnerTeam = ''; // the team the owner challenged with ("Same as mine")
	var pending = null; // a battle asked for while the bot was still connecting
	var STORE = 'mgb-sandbox-botteam';
	var PLAYER_STORE = 'mgb-bot-playerteam';
	var choice = 'random'; // the bot's team in the sandbox: 'random' | 'mirror' | 'team:<name>'
	var playerChoice = ''; // the player's team against the bot: 'random' | 'selected' ('' = selected if they have one)
	try { choice = localStorage.getItem(STORE) || 'random'; playerChoice = localStorage.getItem(PLAYER_STORE) || ''; } catch (e) {}

	function ownTeams() {
		return ((PS.teams && PS.teams.list) || []).filter(function (t) { return t.format === formatId && !t.isBox && t.packedTeam; });
	}
	/** The bot's team for the next battle, or '' for a random one. Fixed teams use engine names like the owner's. */
	function chosenTeam() {
		if (!sandbox) return '';
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
	function randomTeam() { return Teams.pack(core.randomTeam(bundle, { avoid: avoid, sets: approved })); }

	/** The creator's approved sets (published metagames only), keyed by engine species id. */
	function loadSets() {
		if (sandbox || !MGB_PLAY.slug || !window.Teams || !Teams.import) return Promise.resolve();
		return fetch('/api/play/' + MGB_PLAY.slug + '/sets').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
			var engine = window.MGB_ENGINE_TEAM || function (x) { return x; };
			((data && data.sets) || []).forEach(function (text) {
				try {
					var set = Teams.unpack(engine(Teams.pack(Teams.import(text))))[0];
					if (!set || !set.moves || !set.moves.length) return;
					var id = toID(set.species);
					(approved[id] = approved[id] || []).push(set);
				} catch (e) {}
			});
			var n = Object.keys(approved).length;
			if (n) log('random teams use the approved sets of ' + n + ' species');
		}).catch(function () {});
	}

	/** Starts a bot battle: the player's team (packed, display names) or '' for a random one. */
	function battleBot(packedTeam, format, parentElem) {
		if (!PS.user.named) return signIn();
		if (!botReady) {
			pending = function () { battleBot(packedTeam, format, parentElem); };
			connect();
			return;
		}
		lastOwnerTeam = packedTeam || randomTeam();
		PS.send('/utm ' + lastOwnerTeam);
		PS.send('/challenge ' + botName + ', ' + (format || formatId));
	}

	function signIn() {
		var next = '/m/' + MGB_PLAY.slug + '/play' + (sandbox ? '?sandbox=1' : '?bot=1');
		window.top.location.href = '/?next=' + encodeURIComponent(next);
	}

	/** Sandbox: the main menu's Battle button challenges the bot instead of searching for an opponent. */
	function takeOverBattleButton() {
		var menu = PS.mainmenu;
		menu.startSearch = function (format, team, parentElem) {
			if (!team || !team.packedTeam) { PS.alert('Pick a team first (make one in the Teambuilder).', { parentElem: parentElem }); return; }
			battleBot(team.packedTeam, format, parentElem);
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

	function selectedTeam() {
		var el = document.querySelector('.mainmenu-left form button[name=team]');
		var team = el && el.value ? PS.teams.byKey[el.value] : null;
		return team && team.packedTeam && team.format === formatId ? team : null;
	}
	function playerTeamChoice() {
		if (playerChoice === 'random' || playerChoice === 'selected') return playerChoice;
		return ownTeams().length ? 'selected' : 'random';
	}

	/** Published metagames: "Battle the bot" under Battle!, and what the player plays with. */
	function addBotButton() {
		var place = function () {
			var search = document.querySelector('.mainmenu-left button.mainmenu1');
			var form = search && search.closest('form');
			if (!form) return;
			var box = document.getElementById('mgb-botbattle');
			if (box && box.parentNode === form) return syncPicker(box);
			if (box) box.remove();
			box = document.createElement('div');
			box.id = 'mgb-botbattle';
			box.style.cssText = 'margin-top:10px;text-align:center';
			box.innerHTML = '<button type="button" class="mainmenu2 mainmenu big button" name="mgb-bot">' +
				'<strong>Battle the bot</strong><br /><small>No waiting, unrated</small></button>' +
				'<p style="margin:6px 0 0;font-size:9pt"><label title="The team you play against the bot">Your team: ' +
				'<select class="button" style="max-width:150px"><option value="random">Random team</option>' +
				'<option value="selected">The team above</option></select></label></p>';
			box.querySelector('button').addEventListener('click', function (ev) {
				ev.preventDefault();
				if (playerTeamChoice() === 'selected') {
					var team = selectedTeam();
					if (!team) { PS.alert('Pick a team above, or choose "Random team".', { parentElem: ev.currentTarget }); return; }
					return battleBot(team.packedTeam, formatId, ev.currentTarget);
				}
				battleBot('', formatId, ev.currentTarget);
			});
			var select = box.querySelector('select');
			select.addEventListener('change', function () {
				playerChoice = select.value;
				try { localStorage.setItem(PLAYER_STORE, playerChoice); } catch (e) {}
			});
			form.appendChild(box);
			syncPicker(box);
		};
		var syncPicker = function (box) {
			var select = box.querySelector('select');
			var hasTeams = ownTeams().length > 0;
			select.querySelector('option[value=selected]').disabled = !hasTeams;
			var want = hasTeams ? playerTeamChoice() : 'random';
			if (select.value !== want) select.value = want;
		};
		new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
		place();
	}

	/** "Bot's team" (sandbox): Random / Same as mine / each saved team for this metagame. */
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
			if (parts[3] === '1' && core.toID(parts[2]) === core.toID(botName)) {
				log('signed in as ' + botName);
				send('', '/utm ' + randomTeam());
				botReady = true;
				if (pending) { var go = pending; pending = null; go(); }
			}
			break;
		case 'pm':
			// An incoming challenge from the player: accept with a fresh team.
			// Only the player's challenges in this tab's metagame (another tab may run another one).
			if (/\/challenge\s/.test(parts.slice(4).join('|')) && core.toID(parts[2]) === core.toID(owner) && parts.slice(4).join('|').indexOf(formatId) >= 0) {
				accepting = 8;
				acceptWithNewTeam();
			}
			break;
		case 'popup':
			var text = parts.slice(2).join('|');
			log('server: ' + text);
			// Our team was rejected while accepting: leave out what was banned and try again.
			if (accepting && /rejected|banned|can't learn|not allowed|illegal/i.test(text)) {
				core.learnFromRejection(text, avoid);
				var fixedTeam = sandbox && choice !== 'random';
				if (!fixedTeam && --accepting > 0) acceptWithNewTeam();
				else {
					accepting = 0;
					send('', '/reject ' + owner);
					// The bot runs in the player's page, so tell them right there.
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
			if (parts[2]) {
				var req = JSON.parse(parts.slice(2).join('|'));
				var c = core.choose(req);
				if (c) send(room, '/choose ' + c + '|' + req.rqid);
			}
			break;
		case 'win': case 'tie':
			send(room, '/leave');
			break;
		}
	}

	function connect() {
		if (connecting) return;
		connecting = true;
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
			setTimeout(function () { connecting = false; connect(); }, Math.min(30000, 2000 * Math.pow(2, retries++)));
		};
		ws.onopen = function () { retries = 0; };
	}

	function sandboxNews() {
		var news = document.getElementById('room-news');
		if (news) news.querySelector('.readable-bg').innerHTML = '<div class="newsentry"><h4>Sandbox: your draft vs the bot</h4>' +
			'<p>1. Open <strong>Teambuilder</strong> and make a team.</p><p>2. Back here, pick the team and press <strong>Battle the bot</strong>. ' +
			'Press it again for another battle.</p><p>Under <strong>Bot\'s team</strong>, choose what the bot plays: a random team, the same team as yours, or one of your saved teams (good for testing how a creature holds up).</p>' +
			'<p>The bot picks random moves. Nothing here is published.</p></div>';
	}
	function publicNews() {
		var news = document.getElementById('room-news');
		var entry = news && news.querySelector('.readable-bg');
		if (!entry || document.getElementById('mgb-bot-news')) return;
		var p = document.createElement('p');
		p.id = 'mgb-bot-news';
		p.innerHTML = '3. Nobody around? <strong>Battle the bot</strong> starts a battle at once, with a random team or yours. The bot picks random moves and the battle is unrated.';
		var first = entry.querySelector('.newsentry');
		(first || entry).appendChild(p);
	}

	MGB_READY.then(function () {
		bundle = window.MGB_BUNDLE;
		if (!bundle) return;
		formatId = bundle.formatId;
		if (sandbox) sandboxNews(); else publicNews();
		if (window.MGB_HOUSE_RULES) MGB_HOUSE_RULES();
		var setsLoaded = loadSets();
		// Wait until the player has their own name (signed in), then bring the bot in.
		if (!sandbox) addBotButton();
		var wait = setInterval(function () {
			if (!PS.user.named) return;
			clearInterval(wait);
			owner = PS.user.name;
			if (sandbox) { takeOverBattleButton(); connect(); return; }
			// From the metagame page's "Battle the bot": start the first battle by itself, once.
			if (MGB_PLAY.bot) setsLoaded.then(function () { battleBot(playerTeamChoice() === 'selected' && selectedTeam() ? selectedTeam().packedTeam : '', formatId); });
		}, 500);
	});
})();
