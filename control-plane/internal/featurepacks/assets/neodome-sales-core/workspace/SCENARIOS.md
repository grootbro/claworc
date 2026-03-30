# SCENARIOS.md

## P0 internal

- source-of-truth lookup
- explain product or brand logic
- clarify how the bot should behave
- explain lead routing and escalation logic

## P0 client-facing

- basic product explanation
- fit for a hospitality scenario
- choosing between 1-2 models
- custom-project escalation
- quote or manager handoff

## P1

- FAQ-level product answers
- hospitality positioning help
- concise internal drafts
- short Telegram-first replies in active group topics

## Telegram group routing

- `Reply`
  - explicit mention, alias, or reply to the bot
  - direct answer to a question the bot just asked
  - clear customer intent such as `хочу заказать`, `сколько стоит`, `какая модель`, `нужен менеджер`, `подскажите по доставке`
- `Observe`
  - NeoDome-related facts, contacts, or project details shared between people without asking the bot directly
  - operator or manager coordination that the bot may need later for context
- `No_reply`
  - off-topic chatter
  - room-temperature conversation that happens inside a NeoDome topic but is not actually addressed to the bot
  - vague short phrases from other users when there is no active bot exchange around them

## Safe / cautious / escalate

### Safe

- high-level fit,
- known model positioning,
- what information affects the next step.

### Cautious

- timeline orientation,
- what usually affects price,
- likely fit under incomplete data.

Use phrases like:

- `Обычно ориентир такой...`
- `Как правило, здесь смотрят на...`
- `Точный ответ лучше подтвердить с менеджером...`

### Escalate

- exact quote,
- contractual commitments,
- custom engineering promises,
- guarantees,
- logistics with commercial consequence,
- anything where a wrong answer can cost money or trust.
