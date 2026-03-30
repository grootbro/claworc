# @openclaw/max

MAX channel plugin for OpenClaw.

This package keeps MAX transport, auth, webhook processing, outbound delivery,
and agent routing in the same native channel layer as the other OpenClaw
integrations.

## Status

Current MVP coverage:

- package + plugin metadata
- account resolution
- config schema
- runtime store
- channel registration + status surface
- OpenClaw setup adapter + onboarding wizard for bot token, webhook URL/secret/path, and DM policy
- webhook registration and teardown via `POST /subscriptions`
- webhook ingress with `X-Max-Bot-Api-Secret` verification
- inbound normalization for `message_created`, `bot_started`, and `message_callback`
- native dispatch into the OpenClaw reply pipeline
- thin outbound API client around the official `@maxhub/max-bot-api`
- send-to-chat / send-to-user helpers
- edit-message helper
- typing action helper
- callback acknowledgement via `answerOnCallback`
- shared interactive reply blocks mapped to MAX inline callback keyboards
- serialized runtime pacing around the documented `30 rps` ceiling
- `channelData.max` support for native MAX attachments and keyboard shortcuts
- mention-gated group handling and DM pairing policy hooks

Still pending for full channel runtime:

- richer non-keyboard attachments
- optional dev-only Long Poll fallback

## Why webhook-first

The official MAX docs explicitly recommend:

- Long Polling for development and testing
- Webhook only for production

Official references:

- [MAX API docs](https://dev.max.ru/docs-api)
- [Creating MAX chatbots](https://dev.max.ru/docs/chatbots/bots-create)
- [Official MAX JavaScript library](https://dev.max.ru/docs/chatbots/bots-coding/library/js)
- [Webhook subscription method](https://dev.max.ru/docs-api/methods/POST/subscriptions)

The current implementation follows those constraints:

- production uses webhook delivery, not polling
- webhook URL must be public HTTPS
- the endpoint should acknowledge with HTTP 200 quickly and process business
  logic asynchronously
- MAX webhook secrets are verified via `X-Max-Bot-Api-Secret`
- outbound requests are paced under the documented `30 rps` ceiling
- callback button presses are acknowledged natively and can continue through the
  same reply pipeline as normal user messages
- MAX-native transport details can be added via `channelData.max` without
  breaking the shared OpenClaw reply model

## Planned config

```json5
{
  channels: {
    max: {
      enabled: true,
      botToken: "max-bot-token",
      webhookUrl: "https://example.com/max/default/webhook",
      webhookSecret: "max-webhook-secret",
      webhookPath: "/max/default/webhook",
      format: "markdown",
      dmPolicy: "pairing",
      allowFrom: ["*"],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
      useLongPoll: false
    }
  }
}
```

Notes:

- `webhookUrl` is the public URL MAX calls.
- `webhookPath` is the local OpenClaw ingress path registered inside the app.
- If you run behind a reverse proxy, route the public `webhookUrl` to the same
  local `webhookPath`.

## Implementation stance

- Use the official MAX JS SDK as a thin client for API methods.
- Keep webhook lifecycle, routing, dedupe, and agent dispatch native to OpenClaw.
- Treat polling as a development-only fallback, not the production runtime model.
- Keep shared OpenClaw interactive replies as the default authoring surface.
- Use `channelData.max` only for MAX-native extras such as contact/location
  request buttons or raw attachment payloads.

## MAX-native channelData escape hatch

When shared `interactive` blocks are not enough, the plugin supports a native
`channelData.max` envelope:

```json5
{
  text: "Оставьте контакт, и менеджер свяжется с вами.",
  interactive: {
    blocks: [
      {
        type: "buttons",
        buttons: [{ label: "Подтвердить", value: "lead:confirm", style: "success" }]
      }
    ]
  },
  channelData: {
    max: {
      requestContactText: "Отправить контакт",
      requestGeoLocationText: "Отправить локацию",
      requestGeoLocationQuick: true,
      linkButtons: [{ text: "Каталог NeoDome", url: "https://neodome.ai" }],
      attachments: [
        {
          type: "contact",
          payload: {
            name: "NeoDome Sales",
            vcf_phone: "+79030000000"
          }
        }
      ]
    }
  }
}
```

The plugin merges all of these into a single MAX-native attachment set:

- raw `attachments`
- `keyboard.buttons`
- `requestContactText` shortcut
- `requestGeoLocationText` shortcut
- `linkButtons`
- shared OpenClaw `interactive` callback buttons/selects

## Next implementation steps

1. Add richer attachments beyond inline keyboards.
2. Add optional dev-only Long Poll fallback.
3. Add deeper media/edit parity tests once the workspace dependencies are wired.
4. Add richer operator-facing setup hints for request-contact and native MAX attachment recipes.
