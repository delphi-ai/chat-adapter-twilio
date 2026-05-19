# chat-adapter-twilio

Twilio adapter for the [Vercel Chat SDK](https://chat-sdk.dev/) — write your bot logic once and run it on **SMS, MMS, and WhatsApp via Twilio**.

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

Then in the Twilio Console, point your sender's incoming-message webhook to `https://yourapp.com/api/twilio` with `HTTP POST`. Twilio sends these webhooks as `application/x-www-form-urlencoded` requests.

## Configuration

| Env var | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` (req) | Twilio account SID (`AC...`) |
| `TWILIO_AUTH_TOKEN` (req) | Auth token — used for both REST and webhook signature verification |
| `TWILIO_FROM_NUMBER` | SMS sender (E.164 like `+15551234567`, or `MG...` Messaging Service SID) |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender (`whatsapp:+15551234567`) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | Recommended for production REST auth |
| `TWILIO_WEBHOOK_URL` | Pin the URL used for signature verification (defaults to `request.url`) |
| `TWILIO_SKIP_VALIDATION` | Set to `1` for local development only |
| `TWILIO_BOT_USERNAME` | Bot display name (default `twilio-bot`) |

Set at least one sender: `TWILIO_FROM_NUMBER` for SMS/MMS, `TWILIO_WHATSAPP_FROM` for WhatsApp, or both.

## Channels

The Twilio adapter handles:

- **SMS** — bare E.164 numbers, plain-text bodies, formatting stripped
- **MMS** — SMS plus media attachments via Twilio `mediaUrl`
- **WhatsApp** — `whatsapp:`-prefixed numbers, WhatsApp-flavored text formatting, inbound profile metadata, and Twilio's WhatsApp typing indicators

## Feature matrix

| Feature | SMS/MMS | WhatsApp |
| --- | --- | --- |
| Post text | ✓ | ✓ |
| Media attachments | ✓ via `mediaUrl` | ✓ via `mediaUrl` |
| Markdown rendering | stripped to plain text | rendered as WhatsApp text formatting |
| Edit message | ✗ (Twilio doesn't support) | ✗ |
| Delete message | ✗ | ✗ |
| Reactions | ✗ (not supported by Programmable Messaging) | ✗ (not supported by Programmable Messaging) |
| Typing indicators | ✗ | ✓ via Twilio Public Beta |
| Streaming | buffered, single send | buffered, single send |
| Webhook signature verification | ✓ HMAC-SHA1 via `validateRequest` | ✓ |
| Status callbacks ignored | ✓ | ✓ |

## WhatsApp setup in Twilio

Twilio supports WhatsApp through WhatsApp Senders and Messaging Services. The adapter only needs a public HTTP endpoint and a configured `whatsapp:+...` sender; it does not require a separate WhatsApp-specific route.

1. Register or select your WhatsApp Sender in Twilio. The sender address should look like `whatsapp:+15551234567`; use that value as `TWILIO_WHATSAPP_FROM` or `whatsappFromNumber`.
2. Configure the sender, or the Messaging Service that contains the sender, to send inbound messages to your app's webhook URL, for example `https://yourapp.com/api/twilio`.
3. Use `HTTP POST` for incoming messages. Twilio sends `application/x-www-form-urlencoded` parameters including `MessageSid`, `From`, `To`, `Body`, `NumMedia`, plus WhatsApp-specific fields such as `ProfileName` and `WaId`.
4. If you configure a fallback URL, it can point to the same webhook route. The adapter handles the same form-encoded inbound payload shape.
5. If you configure a status callback URL, it can also point to the same route. The adapter ignores delivery-status callbacks that include `MessageStatus` and do not include message content.

Messaging Services can either "defer to sender's webhook" or define a service-level inbound request URL. If your WhatsApp sender is in a Messaging Service sender pool, make sure the active Integration setting ultimately points inbound WhatsApp messages at your adapter webhook.

References:

- Twilio incoming message webhook request: <https://www.twilio.com/docs/messaging/guides/webhook-request>
- Twilio WhatsApp Senders API webhook fields: <https://www.twilio.com/docs/whatsapp/api/senders>

## WhatsApp typing indicators

Calling `thread.startTyping()` on a WhatsApp thread sends a Twilio WhatsApp typing indicator when possible. The adapter records the latest inbound WhatsApp `MessageSid` for each thread during webhook handling, then sends that SID to Twilio's Typing Indicators API.

Twilio behavior and caveats:

- Typing indicators are a Twilio WhatsApp Public Beta feature.
- The API requires the inbound message SID (`SM...` or `MM...`) and `channel=whatsapp`.
- Sending a typing indicator marks the referenced WhatsApp message as read.
- The indicator disappears when your reply is delivered or after 25 seconds, whichever comes first.
- The feature is not HIPAA-eligible or PCI-compliant.
- Failures are logged and swallowed so typing-indicator issues never block message replies.

Reference: <https://www.twilio.com/docs/whatsapp/api/typing-indicators-resource>

## Security

Inbound webhooks are verified using the [official `twilio.validateRequest`](https://www.twilio.com/docs/usage/webhooks/webhooks-security) (HMAC-SHA1 over the URL + alphabetically-sorted form params, constant-time compared). If your platform terminates TLS or rewrites the URL, set `TWILIO_WEBHOOK_URL` (or pass `webhookUrl` in config) to the URL Twilio originally called.

## Tests

```bash
pnpm test         # vitest run, 47 tests
pnpm typecheck    # tsc --noEmit
pnpm build        # tsup → dist/
```

## License

MIT
