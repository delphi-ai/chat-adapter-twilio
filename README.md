# chat-adapter-twilio

Twilio adapter for the [Vercel Chat SDK](https://chat-sdk.dev/) — write your bot logic once and run it on **SMS**, **MMS**, and **WhatsApp via Twilio**.

> Community adapter. The `@chat-adapter/` npm scope is reserved for official Vercel adapters.

## Install

```bash
pnpm add chat chat-adapter-twilio twilio
```

You'll also need a state adapter (see [chat-sdk.dev/state](https://chat-sdk.dev/)):

```bash
pnpm add @chat-adapter/state-memory       # dev
# or
pnpm add @chat-adapter/state-redis        # prod
```

## Quick start

```typescript
import { Chat } from "chat";
import { createTwilioAdapter } from "chat-adapter-twilio";
import { createMemoryState } from "@chat-adapter/state-memory";

const bot = new Chat({
  userName: "my-bot",
  adapters: { twilio: createTwilioAdapter() },
  state: createMemoryState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`You said: ${message.text}`);
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post({ markdown: `**Echo:** ${message.text}` });
});
```

Wire the webhook to whatever HTTP framework you use:

```typescript
// app/api/twilio/route.ts (Next.js App Router)
export async function POST(request: Request) {
  return bot.webhooks.twilio(request);
}
```

Then in the Twilio Console, point your phone number's **A MESSAGE COMES IN** webhook to `https://yourapp.com/api/twilio` (POST, `application/x-www-form-urlencoded`).

## Configuration

| Env var | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` (req) | Twilio account SID (`AC...`) |
| `TWILIO_AUTH_TOKEN` (req) | Auth token — used for both REST and webhook signature verification |
| `TWILIO_FROM_NUMBER` | SMS / MMS sender (E.164 like `+15551234567`, or `MG...` Messaging Service SID) |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender (e.g. `whatsapp:+14155238886`) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Recommended for production REST auth |
| `TWILIO_WEBHOOK_URL` | Pin the URL used for signature verification (defaults to `request.url`) |
| `TWILIO_SKIP_VALIDATION` | Set to `1` for local development only |
| `TWILIO_BOT_USERNAME` | Bot display name (default `twilio-bot`) |

At least one of `TWILIO_FROM_NUMBER` or `TWILIO_WHATSAPP_FROM` must be set.

## Channels

A single Twilio adapter handles **all** of these — channel is inferred from the `From` / `To` of each message:

- **SMS** — bare E.164 numbers, plain-text bodies, formatting stripped
- **MMS** — same as SMS plus image/video/audio/file attachments via `MediaUrlN`
- **WhatsApp via Twilio** — `whatsapp:` prefixed addresses, WhatsApp markdown (`*bold*`, `_italic_`, `~strike~`, `` `code` ``), `ProfileName` used for display name, button presses surfaced as text with `ButtonPayload` available on `Message.raw`

## Feature matrix

| Feature | SMS | WhatsApp |
| --- | --- | --- |
| Post text | ✓ | ✓ |
| Markdown rendering | stripped to plain text | rendered to WhatsApp syntax |
| Media attachments (inbound) | ✓ | ✓ |
| Edit message | ✗ (Twilio doesn't support) | ✗ |
| Delete message | ✗ | ✗ |
| Reactions | ✗ (not supported by Programmable Messaging) | ✗ |
| Typing indicators | ✗ | ✗ |
| Streaming | buffered, single send | buffered, single send |
| Webhook signature verification | ✓ HMAC-SHA1 via `validateRequest` | ✓ |
| Status callbacks ignored | ✓ | ✓ |

## Security

Inbound webhooks are verified using the [official `twilio.validateRequest`](https://www.twilio.com/docs/usage/webhooks/webhooks-security) (HMAC-SHA1 over the URL + alphabetically-sorted form params, constant-time compared). If your platform terminates TLS or rewrites the URL, set `TWILIO_WEBHOOK_URL` (or pass `webhookUrl` in config) to the URL Twilio originally called.

## Tests

```bash
pnpm test         # vitest run, 45 tests
pnpm typecheck    # tsc --noEmit
pnpm build        # tsup → dist/
```

## License

MIT
