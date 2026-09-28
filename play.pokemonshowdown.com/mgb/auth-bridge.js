/**
 * MGB auth bridge (Spike F). Sends the client's login-server actions to our web app instead of
 * the upstream login server (I7: Supabase is the only identity source). No upstream file is edited:
 * this replaces PSLoginServer.rawQuery right after client-connection.js loads. Nothing is ever
 * sent to the upstream login server.
 *
 * Endpoint: MGB_PLAY.authEndpoint (production page, same origin), else ?mgbauth=<url>,
 * else <same host>:3100/api/showdown/action (spike page, local dev).
 * Identity travels only in the web app's Supabase session cookie (credentials: 'include');
 * this file never sees a token.
 */
(function () {
	'use strict';
	if (typeof PSLoginServer === 'undefined') return;
	var params = new URLSearchParams(location.search.replace(/^\?~~[^&]*&?/, '?'));
	var endpoint = (window.MGB_PLAY && window.MGB_PLAY.authEndpoint) || params.get('mgbauth') || (location.protocol + '//' + location.hostname + ':3100/api/showdown/action');
	var BRIDGED = { upkeep: 1, getassertion: 1, logout: 1 };

	// Never fall back to the upstream login server (I7): other actions (team sync, ladder, …) are not
	// supported yet and resolve to null, which the client treats as "no data".
	PSLoginServer.rawQuery = function (act, data) {
		if (!BRIDGED[act]) {
			console.log('[MGB] login-server action "' + act + '" not bridged; skipped');
			return Promise.resolve(null);
		}
		var body = new URLSearchParams();
		body.set('act', act);
		for (var k in data) if (data[k] !== undefined && data[k] !== null && k !== 'act') body.set(k, String(data[k]));
		return fetch(endpoint, { method: 'POST', body: body, credentials: 'include' })
			.then(function (res) { return res.ok ? res.text() : null; })
			.catch(function (e) { console.error('[MGB] auth bridge failed', e); return null; });
	};
	console.log('[MGB] auth bridge -> ' + endpoint);
})();
