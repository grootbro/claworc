# LEAD_DATABASE.md

## Native lead registry

This workspace stores leads inside `workspace/leads`.

## Rules

- Lead ids use the format `ND-0001`.
- Do not renumber historical leads.
- Prefer updating the same active lead when the same person continues the same project.
- If the same contact explicitly opens a separate project, create a new lead.

## Files

- `leads/SEQUENCE.txt` stores the next sequence seed
- `leads/registry.jsonl` stores compact structured records
- `leads/cards/ND-XXXX.md` stores readable lead cards
- `leads/targets.json` stores routing targets for manager delivery

## Privacy

- Registry and manager cards may contain internal lead ids and numeric Telegram ids.
- User-facing confirmations must not expose those identifiers.
