# Contributing

Thanks for wanting to help. Jet Search is a small project with a few firm rules, and they are what keep it fast.

## Before you start

- **Bugs and ideas:** open an issue first for anything bigger than a small fix, so we can agree on the shape before you write code.
- **Read [ARCHITECTURE.md](ARCHITECTURE.md).** The rules at the top (nothing at start, the main thread only draws, no stale results, the index outside the vault, no network) are not negotiable without a very good reason.

## Set up

You need Node 22 or newer.

```
git clone https://github.com/eknowledger/jet-search.git
cd jet-search
npm ci
npm run dev        # rebuilds main.js on every change
```

To try it in Obsidian, copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/jet-search/`, or open the `demo-vault/` folder as a vault and put them there.

## Making a change

1. **Write the test first.** A bug fix starts with a test that fails for the right reason. A feature starts with a test that describes it.
2. **Make it pass**, and keep the change to one idea.
3. **Run `npm run check`.** It runs formatting, lint, type checks and every test, and it must pass. `npm run format` fixes formatting.
4. **Commit with a conventional message:** `type(scope): Subject`, for example `fix(modal): Keep the selection after Esc`. The types we use are `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore` and `ci`.
5. **Open a pull request** and say what changed and why. If it touches speed, include numbers (see below).

## Performance

Speed is the product. If a change could slow a keystroke, the first index build, the memory in use or startup, measure it:

- `npm run bench:engine -- demo-vault` times the engine on vaults of 1,000 to 50,000 notes.
- `npm run bench:mem -- save demo-vault 10000 /tmp/idx` then `npm run bench:mem -- load /tmp/idx` measures memory.
- `bench/compare/` measures the real window in Obsidian. See [docs/benchmarks.md](docs/benchmarks.md).

## Test data

Test fixtures are invented, generic text. Never paste notes from a real vault, and never use real people's or companies' names.

## Conduct

Be kind and be direct. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
