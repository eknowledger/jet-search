# Changelog

All notable changes to Jet Search. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each entry is a bold name, a colon and one short sentence. Detail, if any, goes on the lines below it. The notes on each GitHub release are built from the first line of every entry.

## 0.7.1 - 2026-11-20

### Changed
- **Same build every time**: the release file is now built the same way every time, so it can be rebuilt from the source and compared.

### Fixed
- **Layout on older devices**: the chips and the sort header no longer rely on CSS that some older web views cannot draw.

## 0.7.0 - 2026-11-19

### Added
- **Words in order**: words typed in order, like `garden plan`, rank above notes that only hold both words.
  Notes that hold the words side by side, in that order, are listed first. On the demo vault, three words typed in a row find the right note in the top 3 for 88.6% of searches, up from 79.4%. Quoted phrases and single words behave as before.
- **Jet on mobile**: the plugin can now be installed on Obsidian mobile, which is not officially supported yet.
  On a phone the window drops the line of key hints, the clear, filter, sort and scope controls have a 44 px touch area, the options in the settings are plain rows, and the confirmation for Search by meaning asks you to use Wi-Fi. It was tested on an emulated phone and in WebKit, not on real devices.
- **Smooth opening on a phone**: note names are built in small slices, and the saved index opens with the window.
  Large vaults open without freezing the phone.
- **Old engine guard**: a device older than iOS 15.4 or Android WebView 98 gets a notice, and Jet stays off.

### Changed
- **Older iOS support**: Jet no longer uses a regular expression that iOS before 16.4 cannot read.
- **Separate windows**: Jet follows the window you are in when you open Obsidian in a separate window.

### Fixed
- **A rare exact word ranks first**: a word spelled exactly in only one or two notes now puts those notes first.
  They go above notes that only hold its word forms or near spellings, in the results and in the Titles block. Searching `waist` no longer buries the one note that has it under notes about `wait` and `waste`.
- **A misspelling finds the whole word first**: while you type, `comand` now finds `command` ahead of `commands`.

## 0.6.0 - 2026-11-15

### Added
- **Answers**: ask a question and the notes are listed by the line that answers it, with that line outlined in the preview.
- **Words and meaning together**: the window can show both kinds of results at once, grouped or ranked together.
- **Several scopes**: search more than one scope at once.
- **Choose your keys**: every key inside Jet's window can be changed, and so can the double-tap key that opens it.
- **Long searches by meaning**: a long search can use Search by meaning, as an opt-in.
- **Copy a note's path**: copy a note's path from the window.

### Changed
- **Smoother preview**: the preview is drawn once per note, which removes dropped frames while moving through results.
- **Same settings everywhere**: settings are drawn the same way on every Obsidian version.

### Fixed
- **Answers**: money amounts read as answers, and a table's row is outlined whole.
- **Theme highlight**: words are marked in the theme's own highlight colour.

## 0.5.0 - 2026-10-09

### Added
- **Search by meaning**: an on-device model, downloaded once after you confirm, finds notes that say the same thing in other words.

### Fixed
- **Scopes**: turned-down scopes are remembered, emoji names work, and folder notes work.
- **Saving the index**: saving and clearing the index got several fixes.
- **Freezes**: the window no longer freezes with some languages.
- **Search in the open note**: it got several fixes.

## 0.4.0 - 2026-10-09

### Added
- **Action panel**: Cmd/Ctrl + K opens a panel of actions for the selected note.
- **Obsidian search hand-off**: Jet offers Obsidian's own search when a search uses its operators.

### Changed
- **Gentler first build**: the first index build is gathered in slices of 8 ms, so Obsidian stays smooth while it runs.

## 0.3.0 - 2026-10-09

### Added
- **Scopes**: type a scope's name and press Tab to search inside it.
  Jet proposes scopes from your folders, tags and links, and notices new ones as the vault changes.
- **Filters**: tags, properties, folders, dates and links, typed or from the filters bar, with autocomplete for keys and values.
- **Why it matched**: results say why a note matched.
- **Sorting**: results can be sorted.

## 0.2.0 - 2026-10-07

### Added
- **Search as you type**: a live preview and note actions, opened with Shift Shift.
- **Names first**: note names appear in the same frame, before the full text arrives.
- **Word forms**: stemming for nine languages, plus word forms and compound parts.
- **Search in the open note**: find text in the note you are reading.
- **Suggestions**: Jet offers other searches when nothing matches.
- **Settings page**: it shows the state of the index.

## 0.1.0 - 2026-10-07

### Added
- **Search engine**: typos, prefixes, and ranking across names, headings, tags and text.
- **Background worker**: it holds the index, off the main thread.
- **Open command**: a command that opens the search.
