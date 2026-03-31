# Model Profile

`model-profile` is the reusable feature pack for defining how a bot should use
its LLM stack in production.

## What it manages

- `agents.defaults.model.primary`
- `agents.defaults.model.fallbacks`
- `agents.defaults.model.timeoutSeconds`

## Why this should be a pack

The model stack is part of a bot’s operational profile, not just its brand.

That means it should be:

- reusable
- visible in UI
- included in blueprints
- easy to compare across bots

## Recommended uses

Use different model profiles for different bot types:

- `Fast Messenger`
  - short timeout
  - strong failover chain
  - optimized for quick customer replies
- `Balanced Oracle`
  - slower but richer primary model
  - stable fallbacks
  - better for internal knowledge work
- `Stable Premium`
  - more conservative provider ordering
  - longer timeout
  - fewer preview-model surprises

## Pair with

- `messenger-responsiveness` for typing and streaming feel
- `access-trust` for safe access posture
- brand packs such as `neodome-sales-core` or `shirokov-capital-core`

## What it does not manage

- channel credentials
- typing indicators
- DM policy
- slash-command access
- voice / TTS
- brand tone or sales playbooks
