---
name: shirokov-lstd-catalog
description: Exact current object catalog for Shirokov Capital based on the live LSTD/YGroup selection snapshot.
---

# Shirokov LSTD Catalog

Use this skill when the user asks about:

- concrete objects from the current Shirokov Capital base
- exact prices, area ranges, locations, or commissions
- shortlist options from the live catalog
- what is currently in the Shirokov portfolio base

## Source of Truth

Read these files first:

- `SHIROKOV_LSTD_BASE.md`
- `data/shirokov_lstd_selection_f6132c75.json`

These files are sourced from:

- `https://ru.lstd.pro/f6132c75-66ff-4b6f-8442-2ad41bbbca82`

## Operating Rules

- Treat this catalog as the exact current base for concrete object facts.
- Prefer facts from this catalog over generic market talk.
- If a user asks for a shortlist, propose objects from this catalog first.
- If a requested city, budget, or object type does not fit this catalog, say so clearly and then offer a manager handoff or broader search.
- Do not invent:
  - exact availability beyond the catalog snapshot
  - guaranteed returns
  - unpublished discounts
  - legal or tax conclusions

## Response Style

- Stay compact.
- Do not dump the whole catalog unless the user asks.
- Recommend 1-3 best-fit objects, explain why, then offer the next step.
- If the user asks "what is in the catalog now", answer with:
  1. total count or scope of the current base,
  2. 3-5 named examples from the snapshot,
  3. one clean next step such as narrowing by budget, district, or object type.
- Do not answer a catalog question with generic countries or ROI themes when exact objects are available in the snapshot.
