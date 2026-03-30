# Blueprints

`Blueprints` are reusable bot profiles built on top of the existing feature-pack system.

They solve a different problem than individual packs:

- `Feature Packs` turn one capability on for one live bot.
- `Blueprints` capture a known-good bundle of packs and inputs, then apply that bundle to another bot later or during create.

## What gets captured

When an operator saves a bot as a blueprint, `claworc` captures:

- every active feature pack detected on that bot
- the current effective inputs for each pack
- source bot metadata for traceability

Secrets are intentionally **not** copied as raw values.
They are stored as configured placeholders, so a target bot can keep its own tokens.

## What gets applied

When a blueprint is applied, `claworc` replays the saved feature packs in order.
That means:

- workspace guidance and scripts are written through the same pack engine
- `openclaw.json` patches still go through the same safe config helpers
- backups still happen before overwriting managed files
- gateway restarts still happen only when a pack actually needs them

## Operator flow

For an existing bot:

1. Open `Blueprints`
2. Select the source bot
3. Save it as a blueprint
4. Select the target bot
5. Apply the blueprint

For a new bot:

1. Open `Blueprints`
2. Save a source bot as a blueprint
3. Open `Create Instance`
4. Pick that blueprint in the form
5. `claworc` will create the bot first, then apply the blueprint over SSH

## Good practice

- Use `Feature Packs` for individual capabilities
- Use `Blueprints` for thematic bots such as sales assistants, support bots, or internal oracle profiles
- Keep secrets bot-specific even when the rest of the setup is reused
- Re-capture a blueprint after you intentionally improve a source bot, so the reusable baseline stays current
