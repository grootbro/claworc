# Messenger Responsiveness

`messenger-responsiveness` is the reusable pack for making OpenClaw bots feel
faster and more alive in live chats without mixing that behavior into a
brand-specific oracle pack.

## What it manages

- `agents.defaults.model.timeoutSeconds`
- `channels.telegram.streaming`
- `session.typingMode`
- `session.typingIntervalSeconds`

## Why this is a separate pack

Fast messenger UX is operational behavior, not brand identity.

The same responsiveness defaults may be right for:

- `NeoDome`
- `ravefox`
- `Shirokov`
- future branded assistants

Keeping this in its own pack means:

- one fix can be rolled out to many bots
- blueprints can reuse the same low-latency behavior
- live hotfixes become visible and manageable in UI instead of staying hidden in runtime config

## Recommended defaults

- model timeout: `12`
- Telegram streaming: `partial`
- session typing mode: `instant`
- typing refresh interval: `4`

These defaults are tuned for messenger bots that should acknowledge user input
quickly, show typing immediately, and avoid long silent waits before the first
visible output.

## Pair with

- `telegram-topic-context` for reply anchoring and topic behavior
- `access-trust` for public vs trusted posture
- brand cores such as `neodome-sales-core` or `shirokov-capital-core`

## What it does not control

- DM allowlists
- slash-command admins
- group reply policy
- voice / TTS
- channel credentials
- brand tone or sales process
