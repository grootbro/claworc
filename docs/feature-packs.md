# Feature Packs

`Feature Packs` are reusable capability bundles applied to a running instance through `Claworc`.

They are designed for features that require more than a single skill:

- workspace documents
- scripts
- skill files
- safe config defaults
- routing metadata
- future channel bootstrap inputs
- optional OpenClaw plugin bundles staged into `~/.openclaw/extensions`

## Why packs exist

Some bot capabilities are operational bundles, not isolated skills.

Examples:

- lead registry
- manager routing
- Telegram forum behavior
- voice / TTS
- channel integrations such as VK or MAX

Those features usually need:

- multiple files under `.openclaw/workspace`
- optional config patches
- validation of operator inputs
- careful restarts
- backups before overwrite
- secret-aware channel credentials

That orchestration belongs in `Claworc`, not inside one skill.

## Current API

- `GET /api/v1/instances/{id}/feature-packs`
- `POST /api/v1/instances/{id}/feature-packs/{slug}/apply`

The current UI surfaces packs inside the `Config` tab.
The intended UI surface is a dedicated `Features` tab on each running instance,
so operators can enable capabilities without mixing them into raw JSON edits.

## Current behavior

When a pack is applied:

1. `Claworc` connects to the running instance over SSH.
2. The pack writes its managed workspace files.
3. The pack may also stage managed plugin bundles under `~/.openclaw/extensions`.
4. Existing managed files are backed up before overwrite.
5. Optional safe config defaults are merged into `openclaw.json`.
6. A feature-pack marker is written.
7. `openclaw-gateway` is restarted only if something actually changed.

Secret inputs such as channel tokens are written only into `openclaw.json`.
Feature-pack markers store only a safe `configured` sentinel so the UI can
show that a secret already exists without leaking it into workspace metadata.

`Feature Packs` now expose two states in the UI:

- `Pack-managed settings` — what the pack last applied or now owns
- `Runtime overrides` — where the live bot currently differs from those managed settings

This keeps emergency hotfixes visible instead of turning them into invisible
"magic state" that only exists on one bot.

## Marker and backup paths

Feature-pack marker:

- `.openclaw/workspace/.claworc/feature-packs/<slug>.json`

Automatic backups:

- `.openclaw/workspace/.claworc/feature-packs/backups/<slug>/<timestamp>/...`

## Authoring model

Each pack definition lives in:

- `control-plane/internal/featurepacks/featurepacks.go`

Static assets live under:

- `control-plane/internal/featurepacks/assets/<slug>/workspace/...`

Recommended design rules:

- keep packs idempotent
- avoid destructive config overwrites
- keep secrets out of repo
- keep secrets out of marker files and UI rehydration
- prefer operator inputs over hardcoded runtime ids
- split big capabilities into separate packs when they can be enabled independently

## First production pack

`neodome-sales-core` installs:

- NeoDome workspace docs
- NeoDome sales/oracle skills
- native lead registry
- manager-routing script
- safe Telegram-friendly defaults

It accepts optional routing inputs such as:

- primary sales chat id
- primary Telegram topic id
- direct manager user ids

## Branded oracle packs

`shirokov-capital-core` is the same pattern applied to another brand.

It installs:

- branded workspace identity and tone
- a Shirokov-specific oracle router
- a Shirokov-specific sales playbook
- bundled real-estate reference skills
- compact messenger guardrails for public vs trusted conversations

It intentionally does **not** own channel credentials, slash-command access, or
voice secrets. Those should stay in reusable packs such as:

- `access-trust`
- `telegram-topic-context`
- channel packs like `vk-channel`
- future reusable voice / TTS packs

This is the recommended authoring model for new branded bots:

1. keep the brand oracle in its own core pack
2. layer access and messenger behavior separately
3. layer channels separately
4. save the final composition as a blueprint

`neosfera-core` follows the same model for `NeoSfera`.

It installs:

- branded NeoSfera identity and tone
- compact public messenger guardrails
- a NeoSfera-specific oracle router
- a NeoSfera-specific consultation playbook
- product memory for sessions, diagnostics, operator training, and partner/cabinet conversations

It is meant to stay reusable before the team decides whether NeoSfera should
also get a branded lead-routing pack.

`neosfera-lead-flow` is that branded handoff layer for `NeoSfera`.

It installs:

- native `workspace/leads` files
- a NeoSfera-specific lead registry script
- `NS-XXXX` lead numbering
- branded manager cards and customer-safe handoff confirmations
- Telegram lead chat / topic routing targets

Use it with:

- `neosfera-core`
- `telegram-topic-context`
- `access-trust`

## Branded lead-flow packs

`shirokov-lead-flow` is the branded handoff and manager-routing pack for `Shirokov Capital`.

It installs:

- native `workspace/leads` files
- a Shirokov-specific lead registry script
- `SC-XXXX` lead numbering
- branded manager cards and customer-safe handoff confirmations
- Telegram lead chat / topic routing targets

Use it with:

- `shirokov-capital-core`
- `telegram-topic-context`
- `access-trust`

This is the recommended pattern when a branded oracle should stay reusable on its own, but the team later wants UI-managed lead routing for that specific brand.

## Reusable behavior pack

`telegram-topic-context` is a lighter, reusable pack for any bot that already uses Telegram.

It:

- appends a managed Telegram-topic behavior block into `AGENTS.md`
- patches safe Telegram defaults such as reply anchoring and group policy
- avoids overwriting the rest of the workspace

This is the preferred pattern for generic channel behavior packs that should work across many bots.

## Messenger responsiveness pack

`messenger-responsiveness` is the reusable "make this bot feel awake" layer.

It owns:

- default LLM timeout budget
- Telegram streaming mode
- session typing mode
- session typing refresh interval

Use it when:

- a customer-facing bot feels slow to acknowledge inbound messages
- typing indicators start too late
- Telegram replies feel delayed even though the bot itself is healthy

It intentionally does **not** own:

- direct-message access policy
- allowlists
- group/topic reply rules
- brand-specific model selection or sales logic

Pair it with:

- `telegram-topic-context`
- `access-trust`
- branded cores such as `neodome-sales-core` or `shirokov-capital-core`

## Model profile pack

`model-profile` is the reusable LLM-stack layer.

It owns:

- primary model
- fallback chain
- timeout budget

Use it when:

- one bot should prefer `OpenAI` first and another should prefer `Gemini`
- you want blueprint reuse to carry the bot’s “thinking stack”, not just messenger behavior
- you want failover strategy to be operator-managed instead of hidden inside raw config

Pair it with:

- `messenger-responsiveness`
- `access-trust`
- branded cores such as `neodome-sales-core` or `shirokov-capital-core`

## Access and trust pack

`access-trust` is the operator-facing pack for managing who the bot should treat as:

- `owner`
- `trusted`
- `public`

It creates:

- `ACCESS_TRUST.md` — human-readable access and oracle policy
- `trusted_contexts.json` — machine-friendly mirror for future automations

Use it for:

- trusted Telegram ids
- Telegram command-admin ids
- trusted VK ids
- trusted Slack ids
- public oracle posture
- compact vs balanced messenger style
- how the bot should explain identity and access questions

This is the recommended place to manage access posture for an oracle-style bot instead of scattering those rules across raw markdown or `openclaw.json`.

## Channel packs

`vk-channel` and `max-channel` are reusable operator packs for channel bootstrap.

They:

- patch the default channel account inside `openclaw.json`
- stage the native channel plugin bundle into `~/.openclaw/extensions/<id>`
- enable `plugins.entries.<id>.enabled = true`
- keep tokens and webhook secrets out of feature-pack markers
- append a small managed behavior block into `AGENTS.md`

These packs are intentionally transport-aware but secret-light: they configure
the account, stage the plugin runtime, and apply safe workflow defaults without
requiring a dedicated image rebuild for every channel feature.

## Voice packs

`elevenlabs-voice` is the reusable TTS layer for brand bots that should speak
with the same operator-controlled voice profile.

It owns:

- ElevenLabs API key storage inside `openclaw.json`
- reusable voice id and model defaults
- language and text-normalization defaults
- delivery guardrails such as summary model, timeout, and max text length
- voice tuning values like stability and similarity boost

It intentionally does **not** define brand identity, sales logic, or access
posture. Pair it with a branded core pack such as:

- `neodome-sales-core`
- `shirokov-capital-core`

This keeps voice reusable across bots while the branded oracle remains specific
to each product or company.
