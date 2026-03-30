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

## Confirmation rules

- Do not expose internal `ND-xxxx` or numeric Telegram ids to the user.
- Never claim the lead was forwarded until manager routing actually succeeded.
- After a successful handoff, use a short external confirmation without internal ids: `Готово. Я передал заявку менеджерам. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.`
