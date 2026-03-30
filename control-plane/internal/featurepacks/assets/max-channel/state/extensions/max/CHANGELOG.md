# @openclaw/max

## 2026.3.30-beta.0

- Added webhook-first MAX channel foundation for OpenClaw.
- Added native webhook route registration and teardown via MAX subscriptions.
- Added webhook secret verification with `X-Max-Bot-Api-Secret`.
- Added inbound normalization for `message_created`, `bot_started`, and `message_callback`.
- Added native dispatch into the OpenClaw reply pipeline with DM pairing and
  mention-gated group handling.
- Added thin official MAX SDK client integration via `@maxhub/max-bot-api`.
- Added outbound send helpers for chats and users, typing actions, and message
  edits.
- Added callback acknowledgement via `answerOnCallback`.
- Added shared interactive reply mapping to MAX inline callback keyboards.
- Added serialized pacing around the documented `30 rps` MAX API ceiling.
- Added `channelData.max` support for native attachments, contact/location
  request shortcuts, link buttons, and merged MAX inline keyboards.
