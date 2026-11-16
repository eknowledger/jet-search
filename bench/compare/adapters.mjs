// How to drive and read each search tool. All of them are measured through their real window, with real key events.
// `rows` runs in the page and returns the path-like key of each visible result, best first.
const mdKey = (s) => (s.endsWith(".md") ? s : s + ".md");
export const ADAPTERS = {
	core: {
		label: "Obsidian Search",
		open: "global-search:open",
		input: '.workspace-leaf-content[data-type="search"] input[type="search"]',
		root: '.workspace-leaf-content[data-type="search"] .search-result-container',
		closeKey: null, // a pane: the input is cleared, not closed
		rows: `[...document.querySelectorAll('.workspace-leaf-content[data-type="search"] .search-result .search-result-file-title .tree-item-inner')].map((e) => e.textContent.trim() + ".md")`,
		indexed: false,
		kind: "content",
	},
	"core-switcher": {
		label: "Obsidian Quick Switcher",
		plugin: "core",
		open: "switcher:open",
		input: ".prompt .prompt-input",
		root: ".prompt .prompt-results",
		rows: `[...document.querySelectorAll('.prompt .prompt-results .suggestion-item')].map((r) => { const n = r.querySelector('.suggestion-note'); return ((n ?? r.querySelector('.suggestion-title'))?.textContent ?? '').trim() + '.md'; })`,
		indexed: false,
		kind: "names",
	},
	"qs-plus": {
		label: "Quick Switcher++",
		open: "darlal-switcher-plus:switcher-plus:open",
		input: ".prompt .prompt-input",
		root: ".prompt .prompt-results",
		rows: `[...document.querySelectorAll('.prompt .prompt-results .suggestion-item')].map((r) => (r.querySelector('.qsp-breadcrumb')?.textContent ?? r.querySelector('.suggestion-title')?.textContent ?? '').trim())`,
		indexed: false,
		kind: "names",
	},
	aqs: {
		label: "Another Quick Switcher",
		open: "obsidian-another-quick-switcher:search-command_file-name-fuzzy-search",
		input: ".another-quick-switcher__modal-prompt .prompt-input",
		root: ".another-quick-switcher__modal-prompt .prompt-results",
		rows: `[...document.querySelectorAll('.another-quick-switcher__modal-prompt .prompt-results .suggestion-item')].map((r) => { const d = r.querySelector('.another-quick-switcher__item__directory')?.textContent.trim() ?? ''; const t = r.querySelector('.another-quick-switcher__item__title')?.textContent.trim() ?? ''; return (d ? d + '/' : '') + t + '.md'; })`,
		indexed: false,
		kind: "names",
	},
	omnisearch: {
		label: "Omnisearch",
		open: "omnisearch:show-modal",
		input: ".omnisearch-modal .prompt-input",
		root: ".omnisearch-modal .prompt-results",
		rows: `[...document.querySelectorAll('.omnisearch-modal .omnisearch-result')].map((r) => r.getAttribute('data-result-id') ?? '')`,
		indexed: true,
		kind: "content",
	},
	jet: {
		label: "Jet",
		open: "jet-search:open",
		input: ".jet-modal .jet-q",
		root: ".jet-modal .jet-list",
		rows: `[...document.querySelectorAll('.jet-modal .jet-row')].map((r) => { const t = r.querySelector('.jet-rt')?.textContent.trim() ?? ''; const f = (r.querySelector('.jet-cr')?.textContent ?? '').replace(/ \\/ /g, '/').trim(); return (f ? f + '/' : '') + t + '.md'; })`,
		indexed: true,
		kind: "content",
	},
};
// The plugin each tool needs enabled (prep.mjs), by adapter name.
// Smart Connections has no typed-search window in this version: its lookup is read through the plugin's own API,
// so only the quality of its results is compared, not the time on screen.
ADAPTERS["smart-connections"] = {
	label: "Smart Connections",
	kind: "meaning",
	api: (
		q,
	) => `const ss = app.plugins.plugins["smart-connections"].env.smart_sources; const r = await ss.lookup({ hypotheticals: [${JSON.stringify(q)}], filter: { limit: 30 } });
	  const seen = []; for (const x of r) { const p = (x.item?.key ?? x.key).split("#")[0]; if (!seen.includes(p)) seen.push(p); } return seen.slice(0, 10);`,
};
ADAPTERS["jet-meaning"] = { ...ADAPTERS.jet, label: "Jet (search by meaning on)" };
export const PLUGIN_FOR = {
	"smart-connections": "smart-connections",
	"jet-meaning": "jet",
	core: "core",
	"core-switcher": "core",
	"qs-plus": "qs-plus",
	aqs: "aqs",
	omnisearch: "omnisearch",
	jet: "jet",
};
export { mdKey };
