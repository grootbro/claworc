# Shirokov Capital Core

`shirokov-capital-core` is the branded oracle pack for `Shirokov Capital`.

It installs:

- branded workspace identity and tone
- group and messenger behavior guardrails
- a Shirokov-specific oracle router
- a Shirokov-specific sales playbook
- the current LSTD/YGroup object base snapshot for exact catalog facts
- the bundled `real-estate-skill` reference set
- the safe `api-gateway` helper skill

This pack is meant to be combined with:

- `access-trust`
- `telegram-topic-context`
- optional channel packs such as `vk-channel`

It intentionally does **not** hard-code manager routing or a lead registry yet.
That keeps the branded oracle reusable before a team decides how handoff and
CRM logic should work for this brand.

The current catalog snapshot is sourced from:

- `https://ru.lstd.pro/f6132c75-66ff-4b6f-8442-2ad41bbbca82`

Pack assets include:

- `SHIROKOV_LSTD_BASE.md` for LLM-friendly lookup
- `data/shirokov_lstd_selection_f6132c75.json` for exact structured facts

To refresh the snapshot from the public source, run:

```bash
python3 scripts/refresh_shirokov_lstd_base.py
```

When the team is ready to route leads through Telegram, add:

- `shirokov-lead-flow`
