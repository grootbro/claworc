name: NeoSfera Lead Handoff
description: Use when a NeoSfera prospect becomes warm and it is time to collect the minimum useful context for a clean manager handoff.
---

# NeoSfera Lead Handoff

Use this skill when the user:

- wants to book a session or consultation
- asks about diagnostics, operator training, a cabinet launch, or partnership
- asks for a manager or a call
- is clearly a warm lead

## Draft capture before the final yes/no

If warm commercial intent is already obvious but one final short confirmation is still needed:

1. save or update a draft lead first through `NeoSfera Lead Registry`
2. include the current messenger context in that draft:
   - `source`
   - `channel`
   - `chat_id`
   - `topic_id` or `thread`
3. only then ask the final closing question

This prevents losing the thread context when the user later answers with a short message like `да`, `ок`, `давай`, `поехали`, or `беру`.

## Collect only what is needed

Ask only for missing items:

- name
- phone or Telegram
- city / geography
- product direction or requested format
- scenario / goal
- budget if the request is commercial
- time horizon
- preferred next step

Do not restart qualification from zero if half the context is already known.

## Minimum ready state

Treat a lead as ready for handoff when all of the following are known:

- at least one contact channel
- city or geography
- product direction, use case, or requested NeoSfera format
- requested next step

Special case for NeoSfera commercial flows:

- if the user explicitly agrees to a manager consultation about training, cabinet launch, or partnership, the lead is ready even when city is still missing;
- in that case, route now and leave geography for manager follow-up instead of pretending the handoff already happened.
- If that agreement arrives as a short follow-up like `да` in the same thread, reuse the already saved draft lead and route immediately instead of asking the same qualification questions again.

For Telegram or Slack conversations, the current active messenger thread already counts as a valid contact channel unless the user explicitly asks to switch elsewhere.

When ready:

1. record or update the lead through `NeoSfera Lead Registry`
2. then route it through `NeoSfera Manager Routing`

## Execution Path

- In this deployment, do not use `sessions_spawn`, `subagent`, or any background handoff path for Telegram group sessions.
- Use the current session and call the local routing tool directly through `exec`.
- If the user is warm but not fully ready yet, first run `node scripts/lead_registry.mjs upsert` with the known context so the active thread is anchored to a lead before the final confirmation.
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
- When the final user message is only a short confirmation, do not send an empty payload. Reuse the already known context from the active thread lead and pass it together with the confirmation.
- Only use the short external confirmation after the tool result explicitly shows successful delivery, for example `delivery_completed: true`.
- If the tool returns `forbidden`, `aborted`, or any error, do not claim the lead was forwarded.

## Confirmation rules

- Do not expose internal `NS-xxxx` or numeric Telegram ids to the user.
- Never claim the lead was forwarded until manager routing actually succeeded.
- After a successful handoff, use a short external confirmation without internal ids: `Готово. Я передал ваш запрос команде NeoSfera. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.`
- Keep the external confirmation compact. Do not turn it into a long recap unless the user explicitly asks for details.
- Never prepend English internal headers, planner labels, or summaries such as `Order Confirmed`, `Forwarded`, or similar meta text.
- Do not add hype, slang, or a cascade of emojis in the confirmation.
- Do not add the `🜂` symbol in routine answers or confirmations.
- Do not split the handoff confirmation into multiple user-facing messages.
