# RaveFox Lead Flow

`ravefox-lead-flow` is the branded handoff and manager-routing pack for `RaveFox IT Lab`.

It installs:

- native `workspace/leads` files
- a RaveFox-specific lead registry script
- `RF-XXXX` lead numbering
- branded manager cards and customer-safe handoff confirmations
- Telegram lead chat / topic routing targets

Use it with:

- `ravefox-it-lab-core`
- `telegram-topic-context`
- `access-trust`

Recommended use:

1. apply `ravefox-it-lab-core`
2. layer trust and messenger behavior separately
3. apply `ravefox-lead-flow`
4. set the Telegram lead chat, topic, and manager IDs through UI
5. save the final composition as a blueprint
