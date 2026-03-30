# TOOLS.md

## Preferred operating path

- Use `NeoDome Oracle Router` for mode selection.
- Use `NeoDome Sales Playbook` for fit, objections, and model recommendation.
- Use `NeoDome Lead Handoff` when the conversation becomes a real opportunity.
- Use `NeoDome Lead Registry` before human routing.
- Use `NeoDome Manager Routing` only when the lead is ready.

## Registry script

Use the native Node script:

- `node scripts/lead_registry.mjs upsert`
- `node scripts/lead_registry.mjs route-manager`

Pass JSON through stdin.

Do not claim a manager handoff happened until the routing step actually succeeded.
