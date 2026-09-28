/**
 * MGB display text layer (decision 0030). No upstream file is edited.
 *
 * The upstream client renders its own UI copy and the battle server's engine names. This layer
 * rewrites visible text nodes as they appear:
 * - brand words: UI copy never says "Pokémon" or "Poké" (I3);
 * - display names: engine names like "Emberpup-Tst" become the creator's "Emberpup"
 *   (runtime-bundle.js registers them with MGB_TEXT.add).
 * Inputs, textareas and team text are left alone, so exported teams keep their engine names.
 */
(function () {
	'use strict';
	var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1 };
	var pairs = [];
	var regex = null;

	var brand = [
		['Pokémon Showdown!', 'Metagame Builder'],
		['Pokémon Showdown', 'Metagame Builder'],
		['Pokémon', 'creature'], ['Pokemon', 'creature'], ['POKéMON', 'CREATURE'], ['POKÉMON', 'CREATURE'],
		['Pokédex', 'dex'], ['Poké Ball', 'ball'], ['Poké', ''],
	];

	function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
	function rebuild() {
		var map = {};
		pairs.forEach(function (p) { map[p[0]] = p[1]; });
		var keys = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
		regex = keys.length ? { re: new RegExp(keys.map(escape).join('|'), 'g'), map: map } : null;
	}

	function replaceText(text) {
		if (!regex) return text;
		return text.replace(regex.re, function (m, offset, whole) {
			var out = regex.map[m];
			var before = whole.slice(0, offset);
			// Capitalise replacements at the start of a sentence or a label.
			if (out && /^[a-z]/.test(out) && (!before.trim() || /[.!?:]\s*$/.test(before))) out = out[0].toUpperCase() + out.slice(1);
			return out;
		});
	}

	function fixNode(node) {
		if (node.nodeType === 3) {
			var p = node.parentNode;
			if (!p || SKIP[p.nodeName] || p.isContentEditable) return;
			var t = replaceText(node.nodeValue);
			if (t !== node.nodeValue) node.nodeValue = t;
			return;
		}
		if (node.nodeType !== 1 || SKIP[node.nodeName] || node.isContentEditable) return;
		var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		var n = node;
		do {
			if (n.nodeType === 3) fixNode(n);
			else fixAttributes(n);
		} while ((n = walker.nextNode()));
	}
	function fixAttributes(el) {
		['title', 'placeholder', 'aria-label', 'alt'].forEach(function (a) {
			if (el.hasAttribute(a)) {
				var v = el.getAttribute(a), t2 = replaceText(v);
				if (t2 !== v) el.setAttribute(a, t2);
			}
		});
	}

	var titleDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
	var titleSuffix = 'Metagame Builder';
	Object.defineProperty(document, 'title', {
		configurable: true,
		get: function () { return titleDesc.get.call(document); },
		set: function (v) {
			v = String(v).replace(/Showdown!/g, titleSuffix);
			titleDesc.set.call(document, replaceText(v));
		},
	});

	var observer = new MutationObserver(function (records) {
		observer.disconnect();
		records.forEach(function (r) {
			if (r.type === 'characterData') fixNode(r.target);
			else if (r.type === 'attributes') fixNode(r.target);
			else r.addedNodes.forEach(fixNode);
		});
		observe();
	});
	function observe() {
		observer.observe(document.body, {
			childList: true, subtree: true, characterData: true,
			attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'alt'],
		});
	}

	window.MGB_TEXT = {
		/** Register display replacements, e.g. { 'Emberpup-Tst': 'Emberpup' }. */
		add: function (map) {
			for (var k in map) if (k && map[k] && k !== map[k]) pairs.push([k, map[k]]);
			rebuild();
			fixNode(document.body);
		},
		setTitle: function (t) { titleSuffix = t; },
		replace: replaceText,
	};
	pairs = brand.slice();
	rebuild();
	if (document.body) { fixNode(document.body); observe(); }
	else document.addEventListener('DOMContentLoaded', function () { fixNode(document.body); observe(); });
})();
