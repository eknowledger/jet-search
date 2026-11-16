# Benchmarks

This page explains how Jet was measured, what the numbers do and do not show, and how to run the measurements yourself. Every number in the README comes from here.

There are two kinds of measurement:

1. **In Obsidian, against other tools.** Each tool runs alone in a real Obsidian, is driven with real key presses, and is timed until the result list stops changing on screen. This is what a person feels.
2. **The engine on its own.** Jet's search engine in Node, on public data, with SQLite FTS5 as a reference. This is where the "0.16 ms per keystroke" figures come from.

## What was tested

| Tool | Version | Why it is here |
|---|---|---|
| Jet | 0.6.0 | The subject |
| Obsidian Search | built in (1.15.1) | Everyone has it |
| Obsidian Quick Switcher | built in (1.15.1) | The name matching Jet replaces |
| Omnisearch | 1.32.0 | The most-installed full-text search plugin (2.1 M downloads) |
| Quick Switcher++ | 6.3.0 | The most-installed switcher plugin (527 K) |
| Another Quick Switcher | 14.9.0 | A popular switcher with fuzzy name matching (263 K) |
| Smart Connections | 4.7.2 | The most-installed search by meaning (1.3 M) |

Download counts are from Obsidian's community plugin statistics on 15 November 2026. Each tool was used in its default settings, except Another Quick Switcher, where the "File name fuzzy search" command was used because the plain "File name search" command does not forgive typos. Jet was tested with search by meaning off for the speed tests, and both off and on for the quality tests. Copilot (3.6 M downloads) is left out because it is a chat assistant, not a search tool.

## The setup

- **Machine:** Apple M3 Pro, 12 cores, 36 GB, macOS 26.6.
- **Obsidian:** 1.15.1 (Electron 43, Chromium 150), in a separate, empty profile with one vault open and one search tool enabled. The window is never shown on screen. Background throttling is off, so timers and animation frames run as they would in front.
- **Vaults:** the demo vault (239 notes), and vaults of 1,000 and 10,000 notes made only from the demo vault's own text, recombined with a fixed seed (`gen-vault`). The 10,000-note vault holds 41 MB of text.
- **One tool per launch.** For each tool and vault, Obsidian is started fresh, the tool is enabled, its index is built (if it has one), and the measurements run. Nothing else runs in the lab at the same time.
- **Real input.** Keys are sent as real key events (Chrome DevTools Protocol `Input.dispatchKeyEvent`), one every 110 ms, about what a fast typist does.

## How the time is measured

For each typed search, a page-side recorder watches the tool's **result list** (not the whole window, so a preview pane that draws later does not count) and records:

- **First results:** the time from the last key to the first change of the result list, on the next painted frame.
- **Settled:** the time from the last key to the last change of the result list, on the next painted frame. A search is settled when nothing has changed for 700 ms. This is the number to read as "how long until I can trust what is on screen".
- **Worst freeze:** the longest main-thread task (the browser's Long Tasks report, over 50 ms) while typing. Jet showed none. Omnisearch's longest was 406 ms at 10,000 notes, and Obsidian Search's was 193 ms.
- **First search after launch:** the first typed search of a fresh run, on its own.
- **Index build:** from the moment the plugin is enabled until the index covers every note.

Thirty searches are typed per tool and vault (one or two words, a quarter with a dropped letter, taken from the vault's own vocabulary), after three warm-up searches that are not counted. The 10,000-note runs were done twice and agree to within about 25 % on every median (Jet's settled median was 13.3 and 16.5 ms; Omnisearch's 212 ms both times); the tables show the average of the two.

Jet's "first results" are the names it finds in the same keystroke. Its "settled" time adds the full-text results and the excerpts on each row. The switchers have no second stage, so for them the two are the same.

## Speed

### 10,000 notes (average of two runs)

| Tool | First results | Settled, median | Settled, 95th percentile | Settled, slowest | Index build | First search after launch |
|---|---:|---:|---:|---:|---:|---:|
| Jet | 4.0 ms | 15 ms | 20 ms | 21 ms | 6.4 s | 34 ms |
| Another Quick Switcher | 21 ms | 21 ms | 26 ms | 28 ms | no index | 9.7 ms |
| Obsidian Quick Switcher | 27 ms | 27 ms | 30 ms | 37 ms | no index | 13 ms |
| Quick Switcher++ | 28 ms | 28 ms | 32 ms | 33 ms | no index | 14 ms |
| Obsidian Search | 14 ms | 96 ms | 1.6 s | 2.2 s | no index | 4.1 s |
| Omnisearch | 208 ms | 212 ms | 326 ms | 334 ms | 19.9 s | 328 ms |

### 1,000 notes (one run)

| Tool | First results | Settled, median | Settled, 95th percentile | Settled, slowest | Index build | First search after launch |
|---|---:|---:|---:|---:|---:|---:|
| Jet | 3.4 ms | 13 ms | 19 ms | 22 ms | 823 ms | 20 ms |
| Another Quick Switcher | 11 ms | 11 ms | 13 ms | 13 ms | no index | 9.0 ms |
| Obsidian Quick Switcher | 7.5 ms | 7.5 ms | 11 ms | 12 ms | no index | 9.7 ms |
| Quick Switcher++ | 8.5 ms | 8.5 ms | 13 ms | 13 ms | no index | 9.5 ms |
| Obsidian Search | 15 ms | 34 ms | 137 ms | 149 ms | no index | 53 ms |
| Omnisearch | 203 ms | 203 ms | 328 ms | 330 ms | 2.1 s | 326 ms |

**Reading the table**

- The three quick switchers match names only, so they do less work than Jet or Omnisearch. They are the right comparison for Jet's name matching, and a rough floor for what a list can cost to draw.
- At 1,000 notes the switchers settle slightly faster than Jet (8 to 11 ms against 13 ms), because Jet's settled time includes the full-text stage they lack. At 10,000 notes Jet settles first.
- Obsidian Search has no index: it reads the vault's text when you search. That is fast on a small vault and slow on a large one: a 4.1 s first search at 10,000 notes, and a 95th percentile of 1.6 s.
- Omnisearch's first results appear about 200 ms after the last key, and the list does not change after that. Its index took about 19 s to build for 10,000 notes, against about 6 s for Jet (5.2 to 6.8 s in four runs).
- Jet's index build is end to end inside Obsidian, including reading every note. Run alone in Node (below) it takes 3.6 s.

## Quality: is the right note on top?

Speed is only useful if the right note is there. Two sets of searches were run on the demo vault (239 notes). A search is **found** when the right note is in the top 3.

### 175 generated searches

The searches are generated from the vault itself, with a fixed seed, so every run asks the same questions. There are 25 in each of seven groups:

| Group | What is typed | The right note |
|---|---|---|
| Exact name | A note's title | The note with that title |
| Name with a typo | A title with one letter dropped from one word | The note with that title |
| Start of a name | The first 60% of a title | Any note whose title starts with it |
| One word | A rare word of 5 to 12 letters (in at most 3 notes, and in no title) | Any note whose text holds the whole word |
| Word with a typo | That kind of word with a letter dropped | Any note whose text holds the word |
| Two words | Two words from the same note (each in at most 6 notes) | Any note whose text holds both |
| A phrase | Three words in a row, held by 1 to 3 notes | Any note whose text holds the exact phrase |

Titles are at least 8 characters, words are whole words in the Latin script. File names and queries are compared in the same Unicode form, because macOS stores accented file names in a different form than the one typed (this made every accented note a false miss in a first version of this test, which was thrown away and rerun). Jet was run with search by meaning off. The three quick switchers match names only, so they are scored on the first three groups.

| Found in the top 3 | Exact name | Name with a typo | Start of a name | One word | Word with a typo | Two words | A phrase | All 175 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Jet** | 25 | 25 | 25 | 25 | 22 | 25 | 25 | **172 (98.3%)** |
| Omnisearch | 25 | 14 | 25 | 25 | 23 | 25 | 25 | 162 (92.6%) |
| Smart Connections | 24 | 20 | 25 | 10 | 7 | 14 | 9 | 109 (62.3%) |
| Obsidian Search | 9 | 0 | 10 | 24 | 0 | 25 | 25 | 93 (53.1%) |
| Obsidian Quick Switcher | 25 | 25 | 25 | n/a | n/a | n/a | n/a | 75 of 75 names |
| Quick Switcher++ | 25 | 25 | 25 | n/a | n/a | n/a | n/a | 75 of 75 names |
| Another Quick Switcher | 25 | 23 | 25 | n/a | n/a | n/a | n/a | 73 of 75 names |

**Two sets, and why the table shows the second.** The generator takes a seed. The first set (seed 7) was used while Jet's ranking was being fixed: it exposed four misses, which led to three ranking fixes (listed in the changelog), and Jet then scored 175 of 175 on it. Because the fixes were made by looking at that set, it proves little. The table above is a second set (seed 11), run after the fixes, 159 of whose 175 searches are different from the first. Every tool was run on it, none of them tuned to it. On the first set, before the fixes, Jet scored 171 and Omnisearch 167.

- **Jet missed three searches**, all a word with a typo: `seeting`, `gramar` and `planly`. For `seeting` (meant `setting`) and `gramar` (meant `grammar`) other notes hold words just as close (`meeting`, and names about languages), and Omnisearch misses both as well. `planly` (meant `plainly`) is a real miss: Jet reads the "-ly" as an ending of `plan` and lists the plan notes, while Omnisearch goes straight to the one note that has the word. A fix that handled it broke two other searches, so it is not in.
- **Omnisearch missed eleven misspelled titles** (for example `Biler service` and `Doker Compose stack`), and two words with a typo. It is level with Jet on words in the text (98 of 100 against 97).
- **Smart Connections** ranks pieces of notes by meaning, so it is weak on exact words, typos and phrases. It was read through its own lookup function, because it has no typed-search window in this version.
- **Obsidian Search** matches the exact text you type, so a typo finds nothing, by design.
- **The set favours typo handling** (50 of 175 searches have a typo), it is generated rather than picked, and it runs on a small, invented vault. It is a demonstration of how each tool behaves, not a ranking for your vault.

Run it yourself with `--modes quality-auto`, and `--seed 11` for the second set (see below).

### 16 hand-written searches


The same tools were also given 16 hand-written searches on the demo vault. A search is **found** when the right note is in the top 3. For the questions and the word lookups, "the right note" is any note that contains the answer (for example, every note that holds `2,340` for the price question).

The searches were written to show what each kind of tool is for: names, typos, initials, aliases, accents, Arabic, Japanese, exact words, a phrase, a typo inside the text, and three questions asked in other words. They were chosen from what Jet's guide demonstrates plus cases that suit the other tools (exact names, prefixes, phrases), so this favours the tools that handle many cases. It is a demonstration on a small, invented vault, not a ranking for yours. The searches are in `queries.mjs` if you want to change them.

The quick switchers match names, so the searches that need a note's text are marked n/a for them.

| Case | Jet, meaning on | Jet | Omnisearch | Smart Connections | Obsidian Search | Obsidian Quick Switcher | Quick Switcher++ | Another Quick Switcher |
|---|---|---|---|---|---|---|---|---|
| kitchn renovaton | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 2 | no | found, rank 1 | found, rank 1 | found, rank 1 |
| gaspacho andaluz | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | no | no | no | no |
| jtrip | found, rank 1 | found, rank 1 | no | found, rank 3 | no | found, rank 1 | found, rank 1 | found, rank 1 |
| TLK | found, rank 1 | found, rank 1 | found, rank 1 | no | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 |
| pasteis de nata | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | no | found, rank 1 | found, rank 1 | no |
| شوربة | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 3 | found, rank 1 | found, rank 1 | found, rank 1 |
| 味噌汁 | found, rank 1 | found, rank 1 | found, rank 1 | 7 | 4 | found, rank 1 | found, rank 1 | found, rank 1 |
| Monthly budget | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | 7 | found, rank 1 | found, rank 1 | found, rank 1 |
| rotten joi | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | no | found, rank 1 | found, rank 1 | found, rank 1 |
| calacatta | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | n/a | n/a | n/a |
| ladybird larva | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | n/a | n/a | n/a |
| "first thursday" | found, rank 1 | found, rank 1 | found, rank 2 | no | found, rank 1 | n/a | n/a | n/a |
| restik backup | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | no | n/a | n/a | n/a |
| how do I stop my basil dying | found, rank 1 | 10 | no | found, rank 1 | no | n/a | n/a | n/a |
| keeping plants alive when it gets cold outside | found, rank 1 | found, rank 1 | no | found, rank 1 | no | n/a | n/a | n/a |
| how much was the quartz countertop? | found, rank 1 | found, rank 1 | found, rank 1 | found, rank 1 | no | n/a | n/a | n/a |
| **Found in the top 3** | 16 of 16 | 15 of 16 | 13 of 16 | 13 of 16 | 5 of 16 | 8 of 9 | 8 of 9 | 7 of 9 |

A number is the position of the right note when it was not in the top 3. "no" means it was not in the first ten (or the tool returned nothing).

- **Omnisearch missed `jtrip`**: it does not match the initials of a name.
- **Smart Connections** ranks pieces of notes by meaning, so it did well on the questions and poorly on `TLK` (an alias) and on a quoted phrase. It was read through its own lookup function, because it has no typed-search window in this version, so its time on screen is not compared.
- **Jet without search by meaning** put the right note tenth for "how do I stop my basil dying". With the optional model on, it was first.
- **Obsidian Search** matches the exact text you type, so typos and initials find nothing, by design.

## Memory

Memory was measured in two ways, and neither gives a clean comparison, so the README makes no memory claim about other tools.

- **Jet's engine** in a fresh Node process, loading a saved index: 10 MB for 1,000 notes, 23 MB for 10,000, and about 89 MB for 50,000. This is an upper bound: it includes the file buffer.
- **In Obsidian**, relaunched with every index already saved, after one search and a garbage collection. Memory of the whole app moves by about 40 MB from one launch to the next (Obsidian's own caches), which is more than most differences between tools. The JavaScript heap of the page is steadier:

| JS heap of the page | 1,000 notes | 10,000 notes |
|---|---:|---:|
| Obsidian Quick Switcher (the baseline) | 26 MB | 113 MB |
| Quick Switcher++ | 27 MB | 115 MB |
| Another Quick Switcher | 27 MB | 117 MB |
| Obsidian Search | 35 MB | 144 MB |
| Jet (page only) | 29 MB | 157 MB |
| Omnisearch | 46 MB | 281 MB |

Jet's index lives in a worker, whose heap could not be read from outside, so Jet's row shows the page only. Omnisearch's index is in the page: 168 MB over the baseline at 10,000 notes.

## The engine on its own

Jet's engine in Node (v26.7.0, same machine), on notes recombined from the demo vault with a fixed seed. Per keystroke means every prefix of 150 typed queries (1,122 keystrokes at 50,000 notes).

| Notes | Typical | 95th percentile | Slowest | SQLite FTS5, typical | SQLite FTS5, 95th percentile |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.056 ms | 0.30 ms | 1.7 ms | 0.26 ms | 1.7 ms |
| 10,000 | 0.16 ms | 1.3 ms | 2.0 ms | 2.0 ms | 15 ms |
| 50,000 | 0.77 ms | 7.3 ms | 13 ms | not run | not run |

| Notes | Text | Index on disk | Index time | Load | Edit to searchable |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 4 MB | 1.6 MB | 0.36 s | 0.3 ms | 1.9 ms |
| 10,000 | 41 MB | 14 MB | 3.6 s | 2.3 ms | 0.7 ms |
| 50,000 | 202 MB | 69 MB | 21 s | 9.9 ms | 2.5 ms |

Names are matched on a separate, smaller index: typical 0.03 ms at 1,000 notes, 0.26 ms at 10,000, 1.8 ms at 50,000.

**What the FTS5 comparison is.** FTS5 here is SQLite compiled to WebAssembly, used as the inverted index underneath the same analyzer, typo expansion and ranking that Jet uses, so the comparison isolates the index. It is tuned (one contentless table, `detail=column`, no prefix indexes, a capped page cache). It is not a plain `MATCH` query with BM25, which would rank differently and cannot forgive typos. It was run at 1,000 and 10,000 notes only.

## What these numbers do not show

- **One machine, one operating system.** Windows and Linux were not measured.
- **A synthetic vault.** Recombined demo text is shorter and more repetitive than a real vault, with no images, PDFs or very long notes.
- **Defaults.** Other settings may change a tool's speed or results. Omnisearch can read PDFs and images, which Jet does not, and that costs it time and memory.
- **Thirty searches per run.** The medians repeat well, but the slowest and 95th percentile figures depend on a handful of searches.
- **Smart Connections' time** is not compared, because it was read through its API.
- **The quality sets are small.** The 175 searches are generated from a 239-note vault, and the 16 hand-written ones were chosen by Jet's author.

If a number is wrong, or a tool is mis-set, please open an issue with the correction. The method is meant to be checked.

## Run it yourself

The in-Obsidian comparison is in [`bench/compare/`](../bench/compare/README.md) and needs Node 22 or newer and Obsidian. It starts its own Obsidian on a profile of its own, with a debugging port, and never touches yours. The engine measurement is `bench/run.ts` (and `bench/mem.ts` for memory).

```
# download the other plugins at the versions tested
node bench/compare/fetch.mjs

# speed and accuracy on the demo vault, one fresh Obsidian per tool
node bench/compare/run.mjs --tools jet,omnisearch --vaults n239 --modes speed,quality-auto --seed 11

# speed on a vault of 10,000 notes made from the demo vault
node bench/compare/run.mjs --tools jet,omnisearch --vaults n10000 --modes speed

# the engine on its own
npm run bench:engine -- demo-vault 1000,10000,50000 --fts5
npm run bench:mem -- save demo-vault 10000 /tmp/index.bin
npm run bench:mem -- load /tmp/index.bin
```
