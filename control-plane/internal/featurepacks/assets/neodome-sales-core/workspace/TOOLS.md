# TOOLS.md

## Preferred operating path

- Use `NeoDome Oracle Router` for mode selection.
- Use `NeoDome Sales Playbook` for fit, objections, and model recommendation.
- Use `NeoDome Lead Handoff` when the conversation becomes a real opportunity.
- Use `NeoDome Lead Registry` before human routing.
- Use `NeoDome Manager Routing` only when the lead is ready.
- In the user-facing handoff confirmation, never expose `ND-xxxx`, numeric Telegram ids, or raw thread ids.
- Use this short customer-facing confirmation after a successful handoff: `Готово. Я передал заявку менеджерам. Они свяжутся с вами здесь или в Telegram в ближайшее рабочее время.`
- In manager-facing Telegram cards, show only filled fields; do not print long `не указано` blocks.

## Registry script

Use the native Node script:

- `node scripts/lead_registry.mjs upsert`
- `node scripts/lead_registry.mjs route-manager`

Pass JSON through stdin.

Do not claim a manager handoff happened until the routing step actually succeeded.
