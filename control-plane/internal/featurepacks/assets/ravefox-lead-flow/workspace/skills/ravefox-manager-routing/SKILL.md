name: RaveFox Manager Routing
description: Use when a qualified RaveFox lead should be delivered to human managers through Telegram in a structured and reliable way.
---

# RaveFox Manager Routing

Use this skill only when:

- the user explicitly asks for a manager, call, estimate follow-up, or scoping conversation
- the user wants a human consultation on custom development, AI automation, Web3, AppNative execution, or architecture review
- the user gives a short explicit confirmation such as `да`, `ок`, or `давай` in direct response to your last consultation offer
- or `RaveFox Lead Handoff` has already produced a ready summary

Before routing:

1. read `LEAD_ROUTING.md`
2. make sure the lead already exists in `RaveFox Lead Registry`
3. if the latest user message is only a short confirmation, reuse the existing thread lead instead of routing an almost empty payload

Preferred implementation path:

- Use `exec` in the current session, not `sessions_spawn`
- Run `node scripts/lead_registry.mjs route-manager`
- pass the qualified lead JSON on stdin
- Use canonical JSON fields:
  - `name`
  - `contact`
  - `telegram_username` or messenger-specific contact when available
  - `market`
  - `project_type`
  - `units`
  - `model_or_use_case`
  - `budget`
  - `key_need`
  - `requested_next_step`
  - `summary`
  - `source`
  - `channel`
  - `chat_id`
  - `topic_id` or `thread`
- Do not send shorthand aliases like `interest`, `goal`, `format`, or `action` in the final routing payload.

Let the script:

- upsert the lead
- assign or reuse `RF-xxxx`
- build the manager card
- send it to configured targets
- edit the previous manager message when possible

## Rules

- Prefer one manager group or topic as the primary destination.
- Use direct manager messages as optional duplicates.
- Do not claim delivery until the send actually succeeded.
- Treat `forbidden`, `aborted`, missing `delivery_completed`, or other tool failures as non-delivery.
- Manager-facing cards may include internal lead ids and numeric Telegram ids.
- User-facing chats must never expose those internal identifiers.
- In manager-facing cards, omit optional empty lines instead of printing long `не указано` blocks.
