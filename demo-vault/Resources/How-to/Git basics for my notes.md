---
type: how-to
tags: [how-to, git, tech]
---
# Git basics for my notes

My notes folder is a git repository, so I can see what changed and go back if I break something. The remote lives on the [[Home Server]] (the Pi at 192.168.1.20), so nothing leaves the house — and restic backs the Pi up to Backblaze B2 every night at 02:00 anyway.

## One-time setup

On the Pi, a bare repository to push to:

```bash
ssh noa@192.168.1.20
sudo mkdir -p /srv/git && sudo chown noa:noa /srv/git
git init --bare /srv/git/notes.git
```

On the laptop, inside the notes folder:

```bash
cd ~/Notes
git config --global init.defaultBranch main
git init
git config user.name "Noa Marques"
git config user.email "noa@example.com"
git remote add origin ssh://noa@192.168.1.20/srv/git/notes.git
```

A `.gitignore` so junk stays out:

```gitignore
.DS_Store
.trash/
Attachments/*.mov
```

## Every day

```bash
git status                  # what changed since the last commit
git add -A                  # stage everything
git commit -m "Japan: Kyoto days, ryokan notes"
git push                    # the first time: git push -u origin main
```

Small commits with real messages. "stuff" is not a message — future me can't search for it.

## Looking back

```bash
git log --oneline -15                                   # the last 15 commits
git log --oneline -- "Projects/The Lighthouse Keeper"   # history of one folder
git log --follow -- "Areas/Home/Things to fix.md"       # one note, even after renames
git diff HEAD~1 -- "Areas/Finances/Monthly budget.md"   # what changed in the last commit
git show 3f2c1a9                                        # one commit in full
```

## Undo

```bash
git restore "Areas/Home/Things to fix.md"                         # drop uncommitted edits to one file
git restore --source=3f2c1a9 "Areas/Finances/Monthly budget.md"   # bring back an old version
git revert 3f2c1a9                                                # undo a commit, keep the history
git commit --amend -m "Better message"                            # fix the last commit message (before pushing)
```

## On a second machine

```bash
git clone ssh://noa@192.168.1.20/srv/git/notes.git ~/Notes
git pull --rebase           # always pull before starting to write
```

## When two machines edited the same note

Git marks the clash inside the file:

```text
<<<<<<< HEAD
- [ ] Book the boiler service
=======
- [x] Book the boiler service (2026-10-29)
>>>>>>> origin/main
```

Keep what's right, delete the markers, then:

```bash
git add "Areas/Home/Boiler service.md"
git rebase --continue
```

## Things I learned the hard way

- Commit **before** big reorganisations (moving folders). Git spots renames when the content stays the same.
- Paths with spaces need quotes — most of my note names have spaces.
- Photos don't belong here. They live in Nextcloud; the repo stays small.
- `git status` first, always. It tells you what to do next.

Related: [[Back up a phone]] — same idea, different device.
