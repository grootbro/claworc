---
name: api-gateway
description: |
  Managed Maton API gateway for services that do not already have a native skill on this bot.
  Use this only when the user explicitly needs the Maton/OAuth gateway path for a third-party service other than Notion.
compatibility: Requires network access and valid Maton API key
metadata:
  author: maton+ravefox
  version: "1.1"
  clawdbot:
    emoji: 🧠
    homepage: "https://maton.ai"
    requires:
      env:
        - MATON_API_KEY
---

# API Gateway

Managed passthrough proxy for third-party APIs through Maton.

Important rules for this bot:
- Do not use this skill for Notion on `Shirokov AI`.
- For Notion tasks, always use the dedicated `notion` skill and the native Notion API with `NOTION_KEY`.
- Only use this gateway when the user needs a third-party service that does not already have a native direct path on this bot.
- If the gateway key is missing, explain that the gateway path is unavailable for that specific service.

## Quick Start

```bash
python <<'EOF'
import urllib.request, os, json
data = json.dumps({'channel': 'C0123456', 'text': 'Hello from gateway!'}).encode()
req = urllib.request.Request('https://gateway.maton.ai/slack/api/chat.postMessage', data=data, method='POST')
req.add_header('Authorization', f'Bearer {os.environ["MATON_API_KEY"]}')
req.add_header('Content-Type', 'application/json')
print(json.dumps(json.load(urllib.request.urlopen(req)), indent=2))
EOF
```

## Base URL

```
https://gateway.maton.ai/{app}/{native-api-path}
```

## Authentication

```
Authorization: Bearer $MATON_API_KEY
```

## Service Selection Guidance

- Prefer native/local skills when they exist.
- On this bot, `notion` is native and must not be routed through Maton.
- Good candidates for this skill are services without a dedicated native skill or when the user explicitly asks to use the Maton gateway.
