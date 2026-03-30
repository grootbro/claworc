# @openclaw/vk

VK channel plugin scaffold for OpenClaw.

This package is the correct transport-level foundation for integrating VK
Community Messages into OpenClaw. It is intentionally structured as a channel
extension, not a skill, so that auth, webhook delivery, outbound sending,
retry, dedupe, and routing all live in the same native plugin layer as
Telegram, Slack, Discord, and Zalo.

## Status

Current MVP coverage:

- package + plugin metadata
- account resolution
- config schema
- runtime store
- channel registration + status surface
- OpenClaw setup adapter + onboarding wizard for token, group id, webhook metadata, and DM policy
- Callback API webhook verification
- inbound `message_new` normalization
- outbound `messages.send`
- optional `messages.markAsRead`
- mention-gated group reply flow

Still pending:

- attachments/media upload support
- richer sender/profile enrichment
- optional dev-only Long Poll fallback

## Why webhook-first

VK supports both Callback API and Bots Long Poll. For production, this plugin
is designed around Callback API first so the deployment model matches the rest
of OpenClaw's externally hosted chat channels.

Official references:

- [VK Bots Overview](https://dev.vk.com/ru/api/bots/overview)
- [VK Community Messages Getting Started](https://dev.vk.com/ru/api/community-messages/getting-started)

## Planned config

```json5
{
  channels: {
    vk: {
      enabled: true,
      accessToken: "vk-community-token",
      groupId: 123456789,
      webhookUrl: "https://example.com/api/channels/vk/webhook",
      webhookSecret: "vk-webhook-secret",
      callbackSecret: "vk-callback-secret",
      confirmationToken: "vk-callback-confirm-token",
      dmPolicy: "pairing",
      allowFrom: ["*"],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
      markAsRead: true
    }
  }
}
```

## Current implementation notes

- Production path is webhook-first through VK Callback API.
- `message_new` is acknowledged immediately and processed asynchronously.
- Group chats currently require mention before the agent replies.
- DMs respect the existing OpenClaw DM/pairing policy surface.

## Next implementation steps

1. Add attachments/media upload support.
2. Add optional sender enrichment for better human-readable labels.
3. Add dev-only Long Poll fallback.
4. Add richer group allowlist UX once group-policy semantics are widened beyond mention-gated chats.
