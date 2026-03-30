---
name: NeoDome Manager Routing
description: Use when a qualified NeoDome lead should be delivered to human managers through Telegram in a structured and reliable way.
---

# NeoDome Manager Routing

Use this skill only when:

- the user explicitly asks to be connected to a manager
- the user asks for a quote, call, or follow-up
- or `NeoDome Lead Handoff` has already produced a ready summary

Before routing:

1. read `LEAD_ROUTING.md`
2. make sure the lead already exists in `NeoDome Lead Registry`

Preferred implementation path:

- `node scripts/lead_registry.mjs route-manager`
- pass the qualified lead JSON on stdin

Let the script:

- upsert the lead
- assign or reuse `ND-xxxx`
- build the manager card
- send it to configured targets
- edit the previous manager message when possible

## Rules

- Prefer one manager group or topic as the primary destination.
- Use direct manager messages as optional duplicates.
- Do not claim delivery until the send actually succeeded.
- Manager-facing cards may include internal lead ids and numeric Telegram ids.
- User-facing chats must never expose those internal identifiers.
