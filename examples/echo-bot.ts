/**
 * Minimal echo bot demonstrating the Twilio adapter.
 *
 * Run with `tsx examples/echo-bot.ts` after setting:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (or
 *   TWILIO_WHATSAPP_FROM), and pointing your Twilio number's "A message
 *   comes in" webhook at the public URL of this server.
 */
import { Chat } from "chat";
import { createTwilioAdapter } from "../src";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createServer } from "node:http";

const bot = new Chat({
  userName: "echo-bot",
  adapters: { twilio: createTwilioAdapter() },
  state: createMemoryState(),
});

bot.onDirectMessage(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`Hi! I echo. You said: ${message.text}`);
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`Echo: ${message.text}`);
});

const server = createServer(async (req, res) => {
  if (req.url === "/api/twilio" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");

    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    const fetchReq = new Request(`${proto}://${host}${req.url}`, {
      method: "POST",
      headers: req.headers as Record<string, string>,
      body,
    });

    const response = await bot.webhooks.twilio(fetchReq);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }
  res.writeHead(404);
  res.end();
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Twilio echo bot listening on http://localhost:${port}/api/twilio`);
});
