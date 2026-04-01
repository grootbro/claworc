# RaveFox IT Lab Core

`ravefox-it-lab-core` is the branded oracle pack for `RaveFox IT Lab`.

It installs:

- branded workspace identity and tone
- compact messenger guardrails
- a RaveFox-specific oracle router
- a RaveFox-specific consultation playbook
- product memory for custom engineering, AI automation, Web3, AppNative, blog, and the wider brand ecosystem

This pack is meant to be combined with:

- `access-trust`
- `telegram-topic-context`
- optional channel packs such as `vk-channel`

It intentionally does **not** hard-code lead routing or channel credentials.
That keeps the branded oracle reusable before the team decides how RaveFox
handoff and CRM logic should work.

The current public brand sources are:

- `https://lab.ravefox.dev/`
- `https://appnative.pro/`
- `https://blog.ravefox.dev/`
- `https://mindforest.us/`

Recommended use:

1. apply `ravefox-it-lab-core`
2. layer trust and messenger behavior separately
3. add channels separately
4. save the final composition as a blueprint
