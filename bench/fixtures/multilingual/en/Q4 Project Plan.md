---
tags: [project, planning]
aliases: [Search plugin roadmap]
---

# Q4 Project Plan

## Goal

Get the search plugin from private beta to a public release by mid-December, without breaking anyone's vault.

## Milestones

| Milestone                     | Target date | Owner |
| ----------------------------- | ----------- | ----- |
| Beta 3 with the new tokenizer | 17 Oct      | Ben   |
| Index format frozen           | 31 Oct      | Mira  |
| Public release candidate      | 28 Nov      | me    |
| Store submission              | 12 Dec      | Nadia |

## Scope

- In: tokenizer rewrite, faster first index, keyboard-only navigation, settings page.
- Out: PDF search, semantic search, mobile-specific layout.

## Risks

- The index format changes again after Beta 3, forcing a full rebuild for testers. Fallback: ship a one-time rebuild prompt.
- Store review takes longer than two weeks. Fallback: submit the release candidate early and patch afterwards.
- Only one person knows the worker protocol well. Pair on it in October.

## Open questions

- Do we need telemetry, even opt-in? Leaning no.
- Should the weekly sync move to Thursdays during the release crunch?

Related: [[Weekly Sync — Search Team]], [[Search Index Design]]
