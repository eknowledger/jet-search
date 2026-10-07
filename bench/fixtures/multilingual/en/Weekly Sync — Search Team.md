---
tags: [meeting, search-team]
date: 2026-09-29
---

# Weekly Sync — Search Team

**Attendees:** Nadia, Ben, Mira, me

## Agenda

1. Ranking regressions from last week
2. Index size on large vaults
3. Beta feedback

## Discussion

- Ben showed the ranking dashboard. Two queries dropped out of the top three after the tokenizer change; both involve hyphenated titles. He thinks the title boost is applied before the hyphen split.
- Mira measured the index on the 40k-note test vault: 38 MB on disk, which is over our budget. Most of it is postings for very common words. Options: drop positions, or compress the body field harder.
- Beta users like the speed but keep asking for search inside PDFs. Out of scope for this quarter; Nadia will reply in the forum thread.

## Decisions

- Keep positions out of the index for now (see [[Search Index Design]]).
- Ship the hyphen fix in the next beta.

## Action items

- [ ] Ben — fix the title boost ordering, add a regression test
- [ ] Mira — try delta-varint on the body postings, report the size next week
- [ ] Nadia — answer the PDF thread
- [ ] Me — update the [[Q4 Project Plan]] with the new beta date
