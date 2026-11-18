# Changelog

All notable changes to Jet Search. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- **Words in the order you typed them rank first.** Searching `garden plan` (without quotes) now lists notes that hold those words side by side, in that order, above notes that only contain both. On the demo vault, three words typed in a row find the right note in the top 3 for 88.6% of searches, up from 79.4%. Quoted phrases and single words behave as before.
- **A phone layout, ready for when mobile is supported.** On a phone the window drops the line of key hints, the clear, filter, sort and scope controls have a 44 px touch area, the options in the settings are plain rows, and the confirmation for Search by meaning asks you to use Wi-Fi. Mobile is not officially supported yet.
- **Jet stops cleanly on an engine that is too old.** On a device without iOS 16.4 or Android WebView 98 (or newer) it shows a notice and stays off, instead of failing when a feature is missing.

### Changed
- Jet no longer uses a regular expression that older iOS versions cannot read, and it follows the window you are in when you open Obsidian in a separate window.

### Fixed
- **A rare exact word ranks first.** A word that is spelled exactly in only one or two notes now puts those notes above notes that only hold its word forms or near spellings, in the results and in the Titles block. Searching `waist` no longer buries the one note that has it under notes about `wait` and `waste`.
- **A misspelling finds the whole word first.** While you are still typing, `comand` now finds the word `command` ahead of longer words that merely start like it, such as `commands`.

## 0.6.0 - 2026-11-15

### Added
- **Answers.** Ask a question and the notes are listed by the line that answers it, with that line outlined in the preview.
- **Words and meaning together.** The window can show both kinds of results at once, grouped or ranked together.
- **Search several scopes at once.**
- **Choose your keys.** Every key inside Jet's window can be changed, and so can the double-tap key that opens it.
- **Long searches by meaning**, as an opt-in.
- **Copy a note's path** from the window.

### Changed
- The preview is rendered off the page and drawn once per note, which removes dropped frames while moving through results.
- Settings are drawn the same way on every Obsidian version.

### Fixed
- Money amounts read as answers, a table's row is outlined whole, and words are marked in the theme's own highlight colour.

## 0.5.0 - 2026-10-09

### Added
- **Search by meaning.** An on-device model (downloaded once, after you confirm) finds notes that say the same thing in other words.

### Fixed
- Many fixes for scopes (turned-down scopes are remembered, emoji names work, folder notes), saving and clearing the index, freezes with some languages, and search in the open note.

## 0.4.0 - 2026-10-09

### Added
- **Action panel** with Cmd/Ctrl + K.
- Offers Obsidian's own search when a search uses its operators.

### Changed
- The first index build is gathered in slices of 8 ms, so Obsidian stays smooth while it runs.

## 0.3.0 - 2026-10-09

### Added
- **Scopes.** Type a scope's name and press Tab to search inside it. Jet proposes scopes from your folders, tags and links, and notices new ones as the vault changes.
- **Filters.** Tags, properties, folders, dates and links, typed or from the filters bar, with autocomplete for keys and values.
- Results say why a note matched, and can be sorted.

## 0.2.0 - 2026-10-07

### Added
- **Search as you type** with a live preview and note actions, opened with Shift Shift.
- **Names in the same frame**, before the full text arrives.
- Stemming for nine languages, and word forms and compound parts.
- Search in the open note, and suggestions when nothing matches.
- A settings page with the state of the index.

## 0.1.0 - 2026-10-07

First release: the search engine (typos, prefixes, ranking across names, headings, tags and text), the background worker that holds the index, and the command that opens the search.
