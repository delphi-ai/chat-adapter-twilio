import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { ConsoleLogger, NotImplementedError, type ChatInstance } from "chat";
import { AdapterRateLimitError } from "@chat-adapter/shared";
import { TwilioAdapter } from "../src/adapter";
import { encodeTwilioThreadId } from "../src/thread-id";
import { createTwilioAdapter } from "../src/factory";

const AUTH_TOKEN = "test-auth-token-deadbeef";
const ACCOUNT_SID = "AC_TEST_ACCOUNT_SID";
const FROM_NUMBER = "+15551234567";
const WHATSAPP_FROM = "whatsapp:+14155238886";
const WEBHOOK_URL = "https://example.com/webhook/twilio";

function signTwilio(url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort();
  const data = sorted.reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", AUTH_TOKEN)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
}

function makeWebhookRequest(params: Record<string, string>): Request {
  const body = new URLSearchParams(params).toString();
  const signature = signTwilio(WEBHOOK_URL, params);
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body,
  });
}

/**
 * A fake Twilio messages client whose `create` we can spy on. The adapter
 * only ever calls `client.messages.create({ from, to, body, mediaUrl? })`.
 */
function makeFakeTwilioClient() {
  const create = vi
    .fn()
    .mockImplementation(async (opts: { from: string; to: string }) => ({
      sid: `SM${Date.now().toString().padStart(32, "0").slice(0, 32)}`,
      from: opts.from,
      to: opts.to,
    }));
  return {
    create,
    client: {
      messages: { create },
    },
  };
}

function makeFakeChat(): ChatInstance {
  return {
    getLogger: () => new ConsoleLogger("silent").child("test"),
    getState: () => ({}) as never,
    getUserName: () => "twilio-bot",
    handleIncomingMessage: vi.fn(),
    processMessage: vi.fn(),
    processAction: vi.fn(),
    processReaction: vi.fn(),
    processSlashCommand: vi.fn(),
    processModalSubmit: vi.fn(),
    processModalClose: vi.fn(),
    processAppHomeOpened: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
  } as unknown as ChatInstance;
}

describe("TwilioAdapter constants and metadata", () => {
  it("identifies as the twilio adapter with channel-scoped locks", () => {
    const fake = makeFakeTwilioClient();
    const adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: fake.client as never,
      logger: new ConsoleLogger("silent"),
    });
    expect(adapter.name).toBe("twilio");
    expect(adapter.lockScope).toBe("channel");
    expect(adapter.persistMessageHistory).toBe(true);
  });
});

describe("TwilioAdapter.postMessage", () => {
  let fake: ReturnType<typeof makeFakeTwilioClient>;
  let adapter: TwilioAdapter;

  beforeEach(() => {
    fake = makeFakeTwilioClient();
    adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      whatsappFromNumber: WHATSAPP_FROM,
      twilioClient: fake.client as never,
      logger: new ConsoleLogger("silent"),
    });
  });

  it("sends an SMS to the user using the SMS sender number", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    await adapter.postMessage(threadId, "Hello from the bot");
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.create).toHaveBeenCalledWith({
      from: FROM_NUMBER,
      to: "+15557654321",
      body: "Hello from the bot",
    });
  });

  it("sends a WhatsApp message using the whatsapp sender number", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "whatsapp",
      botAddress: WHATSAPP_FROM,
      userAddress: "whatsapp:+15557654321",
    });
    await adapter.postMessage(threadId, "Hi via WhatsApp");
    expect(fake.create).toHaveBeenCalledWith({
      from: WHATSAPP_FROM,
      to: "whatsapp:+15557654321",
      body: "Hi via WhatsApp",
    });
  });

  it("renders markdown to plain text on SMS", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    await adapter.postMessage(threadId, { markdown: "Hello **world**" });
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Hello world" }),
    );
  });

  it("renders markdown to WhatsApp formatting on whatsapp threads", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "whatsapp",
      botAddress: WHATSAPP_FROM,
      userAddress: "whatsapp:+15557654321",
    });
    await adapter.postMessage(threadId, { markdown: "Hello **world**" });
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Hello *world*" }),
    );
  });

  it("returns a RawMessage with the Twilio message SID", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    const result = await adapter.postMessage(threadId, "hi");
    expect(result.threadId).toBe(threadId);
    expect(result.id).toMatch(/^SM/);
    expect(result.raw).toBeDefined();
  });
});

describe("TwilioAdapter unsupported operations", () => {
  let adapter: TwilioAdapter;
  beforeEach(() => {
    adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: makeFakeTwilioClient().client as never,
      logger: new ConsoleLogger("silent"),
    });
  });

  it("throws NotImplementedError when editMessage is called (Twilio doesn't support edits)", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    await expect(adapter.editMessage(threadId, "SM123", "new text")).rejects.toThrow(
      NotImplementedError,
    );
    await expect(adapter.editMessage(threadId, "SM123", "new text")).rejects.toThrow(
      /not support.*edit/i,
    );
  });

  it("throws NotImplementedError when deleteMessage is called", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    await expect(adapter.deleteMessage(threadId, "SM123")).rejects.toThrow(
      NotImplementedError,
    );
    await expect(adapter.deleteMessage(threadId, "SM123")).rejects.toThrow(
      /not support.*delet/i,
    );
  });

  it("throws NotImplementedError when addReaction is called on an SMS thread", async () => {
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    await expect(
      adapter.addReaction(threadId, "SM123", "thumbs_up"),
    ).rejects.toThrow(NotImplementedError);
    await expect(
      adapter.addReaction(threadId, "SM123", "thumbs_up"),
    ).rejects.toThrow(/sms/i);
  });
});

describe("TwilioAdapter.stream (no native streaming)", () => {
  it("buffers all chunks and posts a single message", async () => {
    const fake = makeFakeTwilioClient();
    const adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: fake.client as never,
      logger: new ConsoleLogger("silent"),
    });
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });

    async function* chunks() {
      yield "Hello ";
      yield "streaming ";
      yield "world";
    }
    await adapter.stream(threadId, chunks());

    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Hello streaming world" }),
    );
  });
});

describe("TwilioAdapter.postMessage — outbound MMS", () => {
  it("passes mediaUrl when message has file attachments with url", async () => {
    const fake = makeFakeTwilioClient();
    const adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: fake.client as never,
      logger: new ConsoleLogger("silent"),
    });
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });

    const message = {
      raw: "Check this out",
      files: [
        { url: "https://example.com/image1.jpg", filename: "image1.jpg" },
        { url: "https://example.com/image2.png", filename: "image2.png" },
      ],
    };
    await adapter.postMessage(threadId, message as never);
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrl: [
          "https://example.com/image1.jpg",
          "https://example.com/image2.png",
        ],
      }),
    );
  });

  it("does not include mediaUrl when message has no file attachments", async () => {
    const fake = makeFakeTwilioClient();
    const adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: fake.client as never,
      logger: new ConsoleLogger("silent"),
    });
    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });
    await adapter.postMessage(threadId, "plain text");
    const callArgs = fake.create.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("mediaUrl");
  });
});

describe("TwilioAdapter.postMessage — API error mapping", () => {
  let fake: ReturnType<typeof makeFakeTwilioClient>;
  let adapter: TwilioAdapter;

  beforeEach(() => {
    fake = makeFakeTwilioClient();
    adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: fake.client as never,
      logger: new ConsoleLogger("silent"),
    });
  });

  it("throws AdapterRateLimitError when client throws a 429-like error", async () => {
    const rateLimitErr = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    fake.create.mockRejectedValueOnce(rateLimitErr);

    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });

    await expect(adapter.postMessage(threadId, "hi")).rejects.toThrow(
      AdapterRateLimitError,
    );
  });

  it("wraps non-RestException errors in NetworkError", async () => {
    fake.create.mockRejectedValueOnce(new Error("Connection refused"));
    const { NetworkError: NE } = await import("@chat-adapter/shared");

    const threadId = encodeTwilioThreadId({
      channel: "sms",
      botAddress: FROM_NUMBER,
      userAddress: "+15557654321",
    });

    await expect(adapter.postMessage(threadId, "hi")).rejects.toThrow(NE);
  });
});

describe("createTwilioAdapter factory — deferred sender validation", () => {
  it("constructs without throwing when neither fromNumber nor whatsappFromNumber is set", () => {
    // Clear env vars to ensure neither is set via env
    const originalFrom = process.env.TWILIO_FROM_NUMBER;
    const originalWhatsapp = process.env.TWILIO_WHATSAPP_FROM;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_WHATSAPP_FROM;

    try {
      expect(() =>
        createTwilioAdapter({
          accountSid: ACCOUNT_SID,
          authToken: AUTH_TOKEN,
        }),
      ).not.toThrow();
    } finally {
      if (originalFrom !== undefined) process.env.TWILIO_FROM_NUMBER = originalFrom;
      if (originalWhatsapp !== undefined) process.env.TWILIO_WHATSAPP_FROM = originalWhatsapp;
    }
  });
});

describe("TwilioAdapter.handleWebhook", () => {
  let fake: ReturnType<typeof makeFakeTwilioClient>;
  let adapter: TwilioAdapter;
  let chat: ChatInstance;

  beforeEach(async () => {
    fake = makeFakeTwilioClient();
    adapter = new TwilioAdapter({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      twilioClient: fake.client as never,
      webhookUrl: WEBHOOK_URL,
      logger: new ConsoleLogger("silent"),
    });
    chat = makeFakeChat();
    await adapter.initialize(chat);
  });

  it("returns 401 when the signature is missing", async () => {
    const body = new URLSearchParams({
      MessageSid: "SM1",
      AccountSid: ACCOUNT_SID,
      From: "+15557654321",
      To: FROM_NUMBER,
      Body: "hi",
    }).toString();
    const req = new Request(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is invalid", async () => {
    const params = {
      MessageSid: "SM1",
      AccountSid: ACCOUNT_SID,
      From: "+15557654321",
      To: FROM_NUMBER,
      Body: "hi",
    };
    const body = new URLSearchParams(params).toString();
    const req = new Request(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "definitely-wrong",
      },
      body,
    });
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(401);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("processes a valid SMS webhook and returns 200", async () => {
    const params = {
      MessageSid: "SM1",
      AccountSid: ACCOUNT_SID,
      From: "+15557654321",
      To: FROM_NUMBER,
      Body: "hi",
      NumMedia: "0",
    };
    const req = makeWebhookRequest(params);
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const [adapterArg, threadIdArg] = (chat.processMessage as any).mock.calls[0];
    expect(adapterArg).toBe(adapter);
    expect(typeof threadIdArg).toBe("string");
  });

  it("ignores status callbacks (MessageStatus present, no Body) with a 200", async () => {
    const params = {
      MessageSid: "SM1",
      AccountSid: ACCOUNT_SID,
      MessageStatus: "delivered",
      From: FROM_NUMBER,
      To: "+15557654321",
    };
    const req = makeWebhookRequest(params);
    const res = await adapter.handleWebhook(req);
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});
