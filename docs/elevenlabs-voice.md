# ElevenLabs Voice

`elevenlabs-voice` is the reusable voice / TTS pack for OpenClaw bots that use
ElevenLabs in production messengers.

It is designed to be layered on top of branded oracle packs instead of being
hard-coded into each brand core.

## What it installs

It does not write workspace files. Instead, it patches `openclaw.json` with:

- `messages.tts.provider = elevenlabs`
- reusable ElevenLabs provider settings
- voice id, model id, and language defaults
- text-normalization settings
- summary model, timeout, and max text length
- voice tuning values such as stability, similarity boost, style, and speed

## What it intentionally avoids

- brand identity
- branded sales scripts
- trusted access policy
- channel credentials

Those should stay in separate packs such as:

- `access-trust`
- `telegram-topic-context`
- `vk-channel`
- branded core packs like `neodome-sales-core` or `shirokov-capital-core`

## Why this split matters

The same voice layer can be reused across multiple bots while each branded
oracle keeps its own tone, market logic, and commercial playbook.
