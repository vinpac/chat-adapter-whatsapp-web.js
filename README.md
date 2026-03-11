# chat-adapter-whatsapp-web.js

[![npm version](https://img.shields.io/npm/v/chat-adapter-whatsapp-web.js)](https://www.npmjs.com/package/chat-adapter-whatsapp-web.js)
[![npm downloads](https://img.shields.io/npm/dm/chat-adapter-whatsapp-web.js)](https://www.npmjs.com/package/chat-adapter-whatsapp-web.js)

WhatsApp adapter for [Chat SDK](https://chat-sdk.dev) using [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js).

## Installation

```bash
pnpm add chat-adapter-whatsapp-web.js whatsapp-web.js
```

## Usage

```typescript
import { Chat } from "chat";
import { Client, LocalAuth } from "whatsapp-web.js";
import { createWhatsAppAdapter } from "chat-adapter-whatsapp-web.js";

const client = new Client({
  authStrategy: new LocalAuth(),
});

await client.initialize();

const bot = new Chat({
  userName: "mybot",
  adapters: {
    whatsapp: createWhatsAppAdapter(client, "mybot"),
  },
});

await bot.initialize();
```

## Features

- Receives incoming WhatsApp messages through `whatsapp-web.js` client events
- Sends, edits, and deletes messages
- Adds/removes reactions
- Sends typing indicator
- Fetches recent messages from a chat
- Converts incoming WhatsApp media to Chat SDK attachments

## Notes

- This adapter does not expose webhook handling; `handleWebhook` returns `501`.
- You are responsible for `whatsapp-web.js` client lifecycle and authentication.
- Thread IDs are encoded as `whatsapp:<base64url-chat-id>`.

## License

MIT
