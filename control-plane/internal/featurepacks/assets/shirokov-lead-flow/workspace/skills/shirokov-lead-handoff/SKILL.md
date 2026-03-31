---
name: Shirokov Lead Handoff
description: Use when a prospect becomes commercially warm and it is time to collect the minimum useful inputs for a clean manager handoff.
---

# Shirokov Lead Handoff

Use this skill when the user:

- asks for подбор
- wants a shortlist or commercial calculation
- asks for a manager or a call
- is choosing between real markets, formats, or deal scenarios
- is clearly a warm lead

## Collect only what is needed

Ask only for missing items:

- name
- phone or Telegram
- market / region
- investment goal or object scenario
- budget or ticket size
- time horizon
- preferred format or shortlist direction

Do not restart qualification from zero if half the context is already known.

## Minimum ready state

Treat a lead as ready for handoff when all of the following are known:

- at least one contact channel
- geography or target market
- investment goal, object scenario, or requested selection direction
- requested next step

For Telegram or Slack conversations, the current active messenger thread already counts as a valid contact channel unless the user explicitly asks to switch elsewhere.

When ready:

1. record or update the lead through `Shirokov Lead Registry`
2. then route it through `Shirokov Manager Routing`

## Execution Path

- In this deployment, do not use `sessions_spawn`, `subagent`, or any background handoff path for Telegram group sessions.
- Use the current session and call the local routing tool directly through `exec`.
- Preferred command shape:
  - `node scripts/lead_registry.mjs route-manager`
  - pass the qualified lead JSON on stdin
- Always send canonical JSON fields so manager cards stay consistent across Telegram and Slack:
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
- Do not use shorthand aliases like `interest`, `goal`, `format`, or `action` when constructing the final routing JSON. Convert them to the canonical keys above before calling the tool.
- Only use the short external confirmation after the tool result explicitly shows successful delivery, for example `delivery_completed: true`.
- If the tool returns `forbidden`, `aborted`, or any error, do not claim the lead was forwarded.

## Confirmation rules

- Do not expose internal `SC-xxxx` or numeric Telegram ids to the user.
- Never claim the lead was forwarded until manager routing actually succeeded.
- After a successful handoff, use a short external confirmation without internal ids: `Готово. Я передал ваш запрос команде Shirokov Capital. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.`
- Keep the external confirmation compact. Do not turn it into a long recap unless the user explicitly asks for details.
- Never prepend English internal headers, planner labels, or summaries such as `Order Confirmed`, `Real Estate Order Confirmation`, `Forwarded`, or similar meta text.
- Do not add hype, slang, or a cascade of emojis in the confirmation.
- Do not split the handoff confirmation into multiple user-facing messages.
