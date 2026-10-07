---
tags: [design, search]
status: draft
---

# Search Index Design

## Context

The plugin keeps a full-text index of every note so that a query returns results within a keystroke. The index lives in a web worker and is saved to disk between sessions.

## Structure

- **Terms**: a sorted array of distinct words, so prefix lookups are two binary searches.
- **Postings**: for each term, the ids of the notes that contain it, plus a per-field score computed at build time.
- **Encoding**: note ids are stored as deltas and written as variable-length integers (delta-varint). On the test vault this cut the postings from 21 MB to 6 MB.

## Updates

A changed note is re-indexed on its own and its old entry is marked with a tombstone. When tombstones pass a quarter of the notes, the index is compacted in the background. No full rebuild is needed for normal editing.

## Worker protocol

Every query carries a sequence number. The worker drops any request older than the latest one it has seen, so fast typing never queues stale searches.

## Alternatives considered

- SQLite FTS5 through WebAssembly: excellent ranking, but a 1 MB download and a slow first load.
- Keeping postings as plain objects: simple, but three times the memory.

## Open points

- Do we store word positions for phrase search? Current answer: no, verify phrases on the main thread instead (decided in [[Weekly Sync — Search Team]]).
