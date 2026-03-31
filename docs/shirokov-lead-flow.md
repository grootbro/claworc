# Shirokov Lead Flow

`shirokov-lead-flow` is the operator-managed lead handoff pack for `Shirokov Capital`.

It installs:

- a native lead registry under `workspace/leads`
- compact manager-facing Telegram lead cards
- a branded `SC-XXXX` lead sequence
- Shirokov-specific lead handoff, registry, and manager-routing skills
- a generated `LEAD_ROUTING.md` and `leads/targets.json`

It accepts optional routing inputs such as:

- primary lead chat id
- primary Telegram topic id
- direct manager Telegram user ids
- duplicate direct delivery

Use it with:

- `shirokov-capital-core`
- `telegram-topic-context`
- `access-trust`

This is the recommended way to let operators configure Shirokov lead delivery from the UI without editing workspace files by hand.
