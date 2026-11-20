# Releasing

How a version of Jet Search gets from `main` to the people who install it. Only the maintainer does this. It is written down so a release is the same every time, and so contributors can see where their change goes.

## What a release is

A release is a git tag plus a GitHub release holding three files: `main.js`, `manifest.json` and `styles.css`. Obsidian installs the plugin from those files.

| File | What it holds |
|---|---|
| `manifest.json` | `version` is the number of the release. `minAppVersion` is the oldest Obsidian that can run it. |
| `package.json` and `package-lock.json` | The same version. |
| `versions.json` | One line per release: the plugin version and the `minAppVersion` it needs. |
| `CHANGELOG.md` | What changed, in words a user can act on. |

The tag is the version with no `v`, for example `0.7.0`. It must equal `manifest.json`, and `versions.json` must have a line for it. The release workflow stops if either is wrong.

## Choosing the number

The project is on 0.x, so the middle number is the one that means "something to know about".

| Change | Bump |
|---|---|
| A new feature, or a change to how something behaves | Minor: 0.7.0 to 0.8.0 |
| Fixes only | Patch: 0.7.0 to 0.7.1 |
| A raised `minAppVersion`, or a raised minimum for iOS or Android | Minor, and say so in the changelog |

## Cutting a release

1. **Branch** from an up to date `main`: `release/0.8.0`.
2. **Set the version** in `manifest.json`, `package.json`, `package-lock.json` and `versions.json`.
3. **Write the changelog.** Add a section `## 0.8.0 - 2026-12-01` with Added, Changed and Fixed. Every entry is `- **Name**: one sentence.`, with the sentence under 120 characters and ending in a full stop. It says what a user can now do, or what stopped being broken. Detail goes on indented lines below the entry. Every number must be measured. A test fails on an entry in any other shape, and on a version with no section.
4. **Run the checks:** `npm run check` and `npm run build`.
5. **Open a pull request** titled `chore(release): 0.8.0`. Once the check passes, squash merge it.
6. **Tag the merge commit** and push the tag:

   ```
   git switch main && git pull
   git log -1 --oneline   # must be the release commit
   git tag -a 0.8.0 -m "0.8.0"
   git push origin 0.8.0
   ```

7. **The workflow does the rest.** It checks the tag against the manifest, runs `npm run check`, builds, attests the build and publishes the release with the three files and the release notes.
8. **Check the result.** The release page lists exactly `main.js`, `manifest.json` and `styles.css`. Install those files in a fresh vault and open the search window once.

## The release notes

The notes on a GitHub release are the first line of every changelog entry, grouped as New, Changed and Fixed with a count, and a link to the full changelog:

```
### New (2)

- **Words in order**: words typed in order, like `garden plan`, rank above notes that only hold both words.
- **Jet on mobile**: the plugin can now be installed on Obsidian mobile, which is not officially supported yet.

### Fixed (1)

- **A misspelling finds the whole word first**: while you type, `comand` now finds `command` ahead of `commands`.

Full changelog: CHANGELOG.md
```

The workflow builds them with `scripts/release-notes.mjs`, so the release and the changelog cannot say different things. You can print a version's notes before a release with `node scripts/release-notes.mjs 0.8.0`. To write the notes of a release that already exists, or to create the page for an old tag, run `node scripts/release-notes.mjs 0.8.0 --apply` (it needs `gh` signed in).

## If something is wrong

- **Tags are never moved or deleted** once they are pushed. A published version is a promise to the people who installed it.
- A bad release is fixed by a new patch release. Mark the bad release as a pre-release on GitHub only if it stops Obsidian from loading the plugin.
- A failed workflow run is re-run from the Actions tab. It publishes nothing until every step passes.

## The Obsidian plugin directory

The first listing is a pull request to the community plugin list that points at this repository. After that, the directory picks up each new GitHub release by its tag, which is why the tag, the manifest version and the release must agree. Nothing else is needed per release.
