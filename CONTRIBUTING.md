# Contributing

Thanks for wanting to help. Jet Search is a small project with a few firm rules, and they are what keep it fast.

## Before you start

- **Bugs and ideas:** open an issue first for anything bigger than a small fix, so we can agree on the shape before you write code. For a bug, use *Jet Search: Report issue* in the command palette. It opens a new bug report with your versions and settings already filled in, so you only add what happened.
- **Read [docs/architecture.md](docs/architecture.md)** (about 30 minutes). The six rules in section 2 (nothing at start, the main thread only draws, no stale results, the index outside the vault, no network) are not negotiable without a very good reason. When you need the detail behind a part, the [architecture reference](docs/architecture-reference.md) has it.

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

Every change reaches `main` through a pull request, the maintainer's own included. Nobody pushes to `main` directly.

1. **Open or find an issue** for anything bigger than a small fix, and say you are taking it.
2. **Fork the repository** (maintainers: make a branch). Name the branch for the change, for example `fix-selection-after-esc`.
3. **Write the test first.** A bug fix starts with a test that fails for the right reason. A feature starts with a test that describes it.
4. **Make it pass**, and keep the change to one idea. One pull request does one thing.
5. **Run `npm run check`.** It runs formatting, lint, type checks and every test, and it must pass. `npm run format` fixes formatting.
6. **Commit with a conventional message:** `type(scope): Subject`, for example `fix(modal): Keep the selection after Esc`. The types we use are `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore` and `ci`. Say why in the body when the reason is not obvious.
7. **Open a pull request** and fill in the template: what changed and why, and how you tested it. If it touches speed, include numbers (see below). Put `Closes #123` in the description when it finishes an issue.

## How a change lands

- **The title is the commit.** Pull requests are squash merged, so the pull request title becomes the commit message on `main`. It has to read `type(scope): Subject`, with a capital letter and no final full stop. A check fails the pull request until it does, and you can fix it by editing the title.
- **What must pass before a merge:** the `check` job (formatting, lint, types, every test and a production build), a branch that is up to date with `main`, and every review conversation resolved. The history of `main` stays linear.
- **Review:** the maintainer reads every pull request. Expect questions about the rules in the architecture document, and about numbers when speed is involved. A change that works but breaks one of those rules is sent back.
- **Workflows from a first contribution wait for the maintainer to approve them** before they run. Nothing in them has access to secrets.
- **Release notes:** the maintainer writes `CHANGELOG.md` when a release is cut, from the merged pull requests, so you do not edit it. A clear title and description is what makes that easy. See [docs/releasing.md](docs/releasing.md).

## Performance

Speed is the product. If a change could slow a keystroke, the first index build, the memory in use or startup, measure it:

- `npm run bench:engine -- demo-vault` times the engine on vaults of 1,000 to 50,000 notes.
- `npm run bench:mem -- save demo-vault 10000 /tmp/idx` then `npm run bench:mem -- load /tmp/idx` measures memory.
- `bench/compare/` measures the real window in Obsidian. See [docs/benchmarks.md](docs/benchmarks.md).

## Test data

Test fixtures are invented, generic text. Never paste notes from a real vault, and never use real people's or companies' names.

## Conduct

Be kind and be direct. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
