# NeoSfera Lead Flow

`neosfera-lead-flow` is the branded handoff and manager-routing pack for `NeoSfera`.

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

Recommended use:

1. apply `neosfera-core`
2. layer trust and messenger behavior separately
3. apply `neosfera-lead-flow`
4. set the Telegram lead chat, topic, and manager IDs through UI
5. save the final composition as a blueprint
