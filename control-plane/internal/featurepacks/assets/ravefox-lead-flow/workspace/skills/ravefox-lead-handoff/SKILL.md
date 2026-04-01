name: RaveFox Lead Handoff
description: Use when a RaveFox prospect becomes warm and it is time to collect the minimum useful context for a clean manager handoff.
---

# RaveFox Lead Handoff

Use this skill when the user:

- wants to start a project, build, MVP, redesign, audit, or architecture review
- asks for an estimate, scoping call, consultation, or manager
- asks about AI automation, bots, Web3, blockchain, integrations, or AppNative execution
- is clearly a warm lead

## Draft capture before the final yes/no

If warm commercial intent is already obvious but one final short confirmation is still needed:

1. save or update a draft lead first through `RaveFox Lead Registry`
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
- project direction
- current stage
- key integrations / modules / platforms
- budget corridor if the request is commercial
- time horizon
- preferred next step

Do not restart qualification from zero if half the context is already known.

## Minimum ready state

Treat a lead as ready for handoff when all of the following are known:

- at least one contact channel
- project direction, use case, or requested RaveFox / AppNative format
- requested next step

For RaveFox commercial flows:

- city is optional unless geography is materially important to delivery;
- if the user explicitly agrees to a manager, scoping call, or estimate follow-up, route now and let the team collect the rest;
- if that agreement arrives as a short follow-up like `да` in the same thread, reuse the already saved draft lead and route immediately instead of asking the same qualification questions again.

For Telegram or Slack conversations, the current active messenger thread already counts as a valid contact channel unless the user explicitly asks to switch elsewhere.

When ready:

1. record or update the lead through `RaveFox Lead Registry`
2. then route it through `RaveFox Manager Routing`

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

- Do not expose internal `RF-xxxx` or numeric Telegram ids to the user.
- Never claim the lead was forwarded until manager routing actually succeeded.
- After a successful handoff, use a short external confirmation without internal ids: `Готово. Я передал ваш запрос команде RaveFox IT Lab. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.`
- Keep the external confirmation compact. Do not turn it into a long recap unless the user explicitly asks for details.
- Never prepend English internal headers, planner labels, or summaries such as `Order Confirmed`, `Forwarded`, or similar meta text.
- Do not add hype, slang, or emoji-cascades in the confirmation.
- Do not split the handoff confirmation into multiple user-facing messages.
