name: NeoSfera Lead Registry
description: Use when a NeoSfera lead reaches handoff readiness and should be recorded in the native workspace lead database with a stable numbered ID.
---

# NeoSfera Lead Registry

Use this skill when:

- a lead is already warm and you want to preserve thread context before the final consultation question
- a lead is qualified
- a manager handoff is about to happen
- an existing lead should be updated with fresh commercial context

Before using it, read `LEAD_DATABASE.md`.

## Workflow

1. Check whether the person or thread already maps to an active lead.
2. If yes, update the existing lead.
3. If not, issue the next `NS-XXXX`.
4. Write or update:
   - `leads/registry.jsonl`
   - `leads/cards/NS-XXXX.md`
5. Use draft saves proactively when the user is warm but may answer the final confirmation with a very short follow-up.

Preferred implementation path:

- `node scripts/lead_registry.mjs upsert`
- pass JSON on stdin
- if the user explicitly starts a separate deal, pass `force_new = true`
- For thread-draft saves, always include `source`, `channel`, and the current `chat_id` plus `topic_id` or `thread`.

## Rules

- Do not create duplicates for the same active lead when Telegram user id, contact, or active thread clearly match.
- If the same contact explicitly opens a different deal or scenario, create a new lead instead of silently merging it.
