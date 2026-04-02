---
name: NeoDome Lead Handoff
description: Use when a prospect is warm and it is time to collect the minimum useful inputs and prepare a clean sales handoff.
---

# NeoDome Lead Handoff

Use this skill when the user:

- asks for a quote
- wants a call
- asks to be connected with a manager
- is choosing between real project options
- is clearly a warm lead

## Collect only what is needed

Ask only for missing items:

- name
- phone or Telegram
- project region
- project type or use case
- number of units
- target launch timeline
- preferred model or scenario
- budget range if the user is comfortable sharing

Do not restart qualification from zero if half the context is already present.

## Minimum ready state

Treat a lead as ready for handoff when all of the following are known:

- at least one contact channel
- project region
- project type or use case
- requested next step

When ready:

1. record or update the lead through `NeoDome Lead Registry`
2. then route it through `NeoDome Manager Routing`

## Execution path

- In this deployment, do not use raw `node scripts/...` calls for manager handoff in messenger sessions.
- Use the current session and call the local routing wrapper directly through `exec`.
- Do not probe npm tool folders, run `ls`, or inspect the filesystem before handoff.
- Preferred command shape:
  - `./bin/neodome-lead-registry upsert`
  - `./bin/neodome-lead-registry route-manager`
  - pass the qualified lead JSON on stdin
- Always send canonical JSON fields:
  - `name`
  - `contact`
  - `telegram_username` when available
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
- Do not use shorthand aliases like `interest`, `goal`, `format`, or `action` in the final routing JSON.
- If the user is warm but one short confirmation is still needed, first save a draft lead with `./bin/neodome-lead-registry upsert`, then ask the final yes/no question.
- If the final user reply is only `да`, `ок`, `давай`, or similar, do not send an empty payload. Reuse the already known lead context from the active thread.
- If the tool returns `forbidden`, `aborted`, `pairing required`, or any error, do not claim the lead was forwarded.

## Confirmation rules

- Do not expose internal `ND-xxxx` or numeric Telegram ids to the user.
- Never claim the lead was forwarded until manager routing actually succeeded.
- After a successful handoff, use a short external confirmation without internal ids: `Готово. Я передал заявку менеджерам. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.`
- Keep the external confirmation compact. Do not turn it into a long recap unless the user explicitly asks for details.
