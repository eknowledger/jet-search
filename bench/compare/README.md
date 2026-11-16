# Comparison harness

Runs Jet and other search tools inside a real Obsidian, one tool at a time, and measures how fast they answer and whether they find the right note. The method and the published results are in [docs/benchmarks.md](../../docs/benchmarks.md).

Each run starts a fresh Obsidian on a profile of its own, with a copy of the vault that holds only the tool under test. Your own Obsidian and vaults are never touched.

## Set up

1. Build Jet: `npm run build` in the repository root.
2. Download the other plugins at the versions pinned in `tools.json`: `node bench/compare/fetch.mjs`. Files go to `bench/compare/.work/plugins`.
3. Point the harness at an Obsidian executable. The default is the installed app. To use another one, set `OBSIDIAN_BIN`. Other variables: `CMP_PORT` (debugging port, default 9346), `CMP_PROFILE` (profile folder) and `CMP_WORK` (working folder, default `bench/compare/.work`).

The first run on a new profile needs the community plugins to be trusted; the harness clicks the dialog for you.

## Run

```
node bench/compare/run.mjs --tools jet,omnisearch --vaults n239 --modes speed,quality-auto
```

| Option             | Meaning                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--tools`          | `core` (Obsidian Search), `core-switcher`, `qs-plus`, `aqs`, `omnisearch`, `jet`, `jet-meaning`, `smart-connections` (quality only) |
| `--vaults`         | `n239` is the demo vault as it is. `nN`, for example `n10000`, is a vault of N notes made from it                                   |
| `--modes`          | `speed`, `quality`, `quality-auto`, `mem`                                                                                           |
| `--count`          | Searches per query in `speed` mode                                                                                                  |
| `--seed`           | Seed of the generated searches in `quality-auto` (default 7; 11 is the second set)                                                  |
| `--gap`, `--quiet` | Milliseconds between keys, and the quiet window that ends a search                                                                  |

Results are written to `.work/out`. `speed-table.mjs` and `report.mjs` turn them into tables.

## The modes

- **speed**: types each query with real key events and times the first paint of results and the last one, and counts freezes (tasks over 50 ms).
- **quality**: a short, hand-written set of searches.
- **quality-auto**: 175 searches generated from the vault: 25 each of exact names, names with a typo, name prefixes, single words, single words with a typo, two words from one note, and a three-word phrase. A search passes if a right note is in the top 3. The right note is the one with that title, or any note whose text holds the word or the exact phrase. The set is generated with a fixed seed, so every run asks the same questions.
- **mem**: JavaScript heap and process memory after a relaunch with the index already saved.

Tools that only match note names (`core-switcher`, `qs-plus`, `aqs`) are scored on the three name groups only.

The generated set leans on typo handling, and it runs on a vault of 239 notes. Read it as a demonstration of how each tool behaves, not as a ranking.
