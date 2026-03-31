# NeoSfera Core

`neosfera-core` is the branded oracle pack for `NeoSfera`.

It installs:

- branded workspace identity and tone
- compact messenger guardrails
- a NeoSfera-specific oracle router
- a NeoSfera-specific consultation playbook
- product memory for sessions, diagnostics, training, and partner conversations

This pack is meant to be combined with:

- `access-trust`
- `telegram-topic-context`
- optional channel packs such as `vk-channel`

It intentionally does **not** hard-code lead routing or channel credentials.
That keeps the branded oracle reusable before the team decides how NeoSfera
handoff and CRM logic should work.

The current public brand source is:

- `https://neosfera.world/`

Recommended use:

1. apply `neosfera-core`
2. layer trust and messenger behavior separately
3. add channels separately
4. save the final composition as a blueprint
