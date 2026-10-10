# Jet Search

Fast search for Obsidian: note names in the same keystroke, full text with typos and word forms, excerpts and a preview, scopes (search only a project's or an area's notes), filters as chips (`status:draft`, `#tag`, `path:`, `edited:7d`), and an optional search by meaning for questions.

Open it with the command **Jet Search: Search notes** (give it any hotkey in Obsidian's Hotkeys), or with a double tap of Shift (in the settings: Shift, Control, Option, Command or off).

## Highlights

- **Names first, instantly.** Titles, aliases and paths match as you type; full-text results follow from a background worker.
- **Scopes.** Generated from your folders, properties and tags. Type a scope's name and press Tab, or `@name`, to search only its notes; add a second scope to search both.
- **Filters.** Typed (`type:"meeting"`, `#project`, `edited:7d`, `links:[[Note]]`) or from the filters bar (⌘F), with autocomplete for keys and values.
- **Search by meaning (optional, off by default).** A search that reads like a question ("how do we ship a release?") finds the notes about it, even in other words. ⌘J switches between words and meaning.
- **Your keys.** The keys for the actions in the search window can be changed in the settings (Esc, the arrows and ⌫ stay as they are), and the hints in the window follow.
- **Works with Jade** when it is installed (its panel, floating bar and double-Shift shortcut); works fully without it.

## Network use

Jet works offline. It makes one kind of network request, and only when you ask for it: turning on **Search by meaning** asks first, then downloads its model (~31 MB, once) from Hugging Face (`huggingface.co/minishlab/potion-base-8M`, a pinned revision; each file is checked against a SHA-256 in Jet's code). You can instead give it the two model files yourself (**Use files…**), with no network at all. Your notes never leave your device.

## Storage

The index and the note vectors live in IndexedDB on your device (one per vault, outside the vault). The packed model (about 8 MB) is kept in Jet's plugin folder. Clear the index or remove the model from Jet's settings.

## Licence

Jet Search: chosen before publishing. The meaning model, potion-base-8M by Minish Lab, is MIT-licensed.
