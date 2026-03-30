# Shirokov Capital Core

`shirokov-capital-core` is the branded oracle pack for `Shirokov Capital`.

It installs:

- branded workspace identity and tone
- group and messenger behavior guardrails
- a Shirokov-specific oracle router
- a Shirokov-specific sales playbook
- the bundled `real-estate-skill` reference set
- the safe `api-gateway` helper skill

This pack is meant to be combined with:

- `access-trust`
- `telegram-topic-context`
- optional channel packs such as `vk-channel`

It intentionally does **not** hard-code manager routing or a lead registry yet.
That keeps the branded oracle reusable before a team decides how handoff and
CRM logic should work for this brand.
