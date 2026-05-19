import {
  extractCard,
  extractFiles,
  ValidationError,
  AuthenticationError,
  AdapterRateLimitError,
  NetworkError,
  PermissionError,
} from "@chat-adapter/shared";
import {
  ConsoleLogger,
  Message,
  NotImplementedError,
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type Logger,
  type LockScope,
  type RawMessage,
  type StreamChunk,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";
import twilio from "twilio";
import { TwilioFormatConverter } from "./format-converter";
import { parseTwilioInbound } from "./parse-inbound";
import { verifyTwilioSignature } from "./signature";
import {
  decodeTwilioThreadId,
  encodeTwilioThreadId,
} from "./thread-id";
import type {
  TwilioAdapterConfig,
  TwilioInboundParams,
  TwilioRawMessage,
} from "./types";

const ADAPTER_NAME = "twilio";

/**
 * Subset of the official Twilio Node client that this adapter actually uses.
 * Tests inject a fake matching this shape; production code passes the real
 * `twilio()` client.
 */
export interface TwilioMessagingClient {
  messages: {
    create(opts: {
      from?: string;
      to: string;
      body: string;
      mediaUrl?: string[];
      messagingServiceSid?: string;
    }): Promise<{ sid: string; [k: string]: unknown }>;
  };
  messaging?: {
    v2?: {
      typingIndicator?: {
        create(opts: {
          channel: "whatsapp";
          messageId: string;
        }): Promise<{ success: boolean; [k: string]: unknown }>;
      };
    };
  };
}

/**
 * Constructor config — extends the public `TwilioAdapterConfig` with optional
 * dependency-injected internals used in tests.
 */
export interface TwilioAdapterCtorConfig extends TwilioAdapterConfig {
  /** Optional pre-built Twilio messaging client (for tests / DI). */
  twilioClient?: TwilioMessagingClient;
}

/**
 * Twilio adapter for the Vercel Chat SDK.
 *
 * Supports SMS, MMS, and WhatsApp via Twilio. All conversations are 1:1 DMs
 * between a Twilio-owned address (the bot) and a user's address.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createTwilioAdapter } from "chat-adapter-twilio";
 * import { createMemoryState } from "@chat-adapter/state-memory";
 *
 * const chat = new Chat({
 *   userName: "my-bot",
 *   adapters: { twilio: createTwilioAdapter() },
 *   state: createMemoryState(),
 * });
 * ```
 */
export class TwilioAdapter
  implements Adapter<unknown, TwilioRawMessage>
{
  readonly name = ADAPTER_NAME;
  readonly lockScope: LockScope = "channel";
  readonly persistMessageHistory = true;
  readonly userName: string;

  private readonly authToken: string;
  private readonly fromNumber?: string;
  private readonly whatsappFromNumber?: string;
  private readonly webhookUrl?: string;
  private readonly skipValidation: boolean;
  private readonly logger: Logger;
  private readonly client: TwilioMessagingClient;
  private readonly latestInboundMessageSidByThread = new Map<string, string>();
  private chat: ChatInstance | null = null;

  constructor(config: TwilioAdapterCtorConfig) {
    this.authToken = config.authToken;
    this.fromNumber = config.fromNumber;
    this.whatsappFromNumber = config.whatsappFromNumber;
    this.webhookUrl = config.webhookUrl;
    this.skipValidation = config.skipValidation === true;
    this.userName = config.userName ?? "twilio-bot";
    this.logger = config.logger ?? new ConsoleLogger("info").child(ADAPTER_NAME);

    if (config.twilioClient) {
      this.client = config.twilioClient;
    } else {
      const sid = config.apiKeySid ?? config.accountSid;
      const secret = config.apiKeySecret ?? config.authToken;
      this.client = twilio(sid, secret, {
        accountSid: config.accountSid,
      }) as unknown as TwilioMessagingClient;
    }
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Twilio adapter initialized");
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const body = await request.text();
    const signature = request.headers.get("x-twilio-signature");
    const url = this.webhookUrl ?? request.url;

    if (!this.skipValidation) {
      const ok = verifyTwilioSignature({
        authToken: this.authToken,
        signature,
        url,
        body,
      });
      if (!ok) {
        this.logger.warn("Twilio webhook signature invalid", { url });
        return new Response("Invalid signature", { status: 401 });
      }
    }

    const params = parseFormBody(body);

    // Ignore status callbacks (delivery receipts) — Twilio posts these to the
    // same webhook URL by default. They have a MessageStatus and never have
    // a Body or media.
    if (params.MessageStatus && !params.Body && !params.NumMedia) {
      return new Response("ok", { status: 200 });
    }

    if (!params.From || !params.To || !params.MessageSid) {
      this.logger.warn("Twilio webhook missing required fields");
      return new Response("Bad Request", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn("Chat not initialized; dropping webhook");
      return new Response("ok", { status: 200 });
    }

    try {
      const { threadId, channel, message } = parseTwilioInbound(params);
      if (channel === "whatsapp") {
        this.latestInboundMessageSidByThread.set(threadId, params.MessageSid);
      }
      this.chat.processMessage(this, threadId, message, options);
    } catch (error) {
      this.logger.error("Failed to process Twilio webhook", { error });
    }

    return new Response("ok", { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // Posting
  // ---------------------------------------------------------------------------

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<TwilioRawMessage>> {
    const { channel, botAddress, userAddress } =
      decodeTwilioThreadId(threadId);

    // Cards aren't natively supported on SMS/Twilio-WhatsApp the way they are
    // on Slack/Teams. Render the card's fallback text via the converter.
    const card = extractCard(message);
    const converter = new TwilioFormatConverter(channel);
    const body = card
      ? converter.renderPostable({ card })
      : converter.renderPostable(message);

    const from = this.resolveFrom(channel, botAddress);

    const files = extractFiles(message);
    const mediaUrls = files
      .filter((f): f is typeof f & { url: string } => "url" in f && typeof (f as { url?: unknown }).url === "string")
      .map((f) => (f as { url: string }).url);

    let response: { sid: string; [k: string]: unknown };
    try {
      response = await this.client.messages.create({
        from,
        to: userAddress,
        body,
        ...(mediaUrls.length > 0 ? { mediaUrl: mediaUrls } : {}),
      });
    } catch (err) {
      const originalError = err instanceof Error ? err : undefined;
      const status = isTwilioLikeError(err) ? err.status : undefined;
      if (status === 401) {
        throw new AuthenticationError(ADAPTER_NAME, originalError?.message);
      }
      if (status === 403) {
        throw new PermissionError(ADAPTER_NAME, "send message");
      }
      if (status === 429) {
        throw new AdapterRateLimitError(ADAPTER_NAME);
      }
      throw new NetworkError(
        ADAPTER_NAME,
        originalError?.message ?? String(err),
        originalError,
      );
    }

    const synthParams: TwilioInboundParams = {
      MessageSid: response.sid,
      AccountSid: "",
      From: botAddress,
      To: userAddress,
      Body: body,
    };

    return {
      id: response.sid,
      threadId,
      raw: { params: synthParams, channel },
    };
  }

  /**
   * Twilio doesn't support editing SMS/MMS/WhatsApp messages.
   */
  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<TwilioRawMessage>> {
    throw new NotImplementedError(
      "Twilio does not support editing messages. Send a new message instead.",
      "editMessage",
    );
  }

  /**
   * Twilio doesn't support deleting SMS/MMS/WhatsApp messages once sent.
   */
  async deleteMessage(
    _threadId: string,
    _messageId: string,
  ): Promise<void> {
    throw new NotImplementedError(
      "Twilio does not support deleting messages.",
      "deleteMessage",
    );
  }

  /**
   * Buffer all chunks then post once. SMS/WhatsApp via Twilio have no
   * incremental-edit API, so streaming is reduced to a single send.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: unknown,
  ): Promise<RawMessage<TwilioRawMessage>> {
    let accumulated = "";
    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        accumulated += chunk;
      } else if (chunk.type === "markdown_text") {
        accumulated += chunk.text;
      }
    }
    return this.postMessage(threadId, accumulated);
  }

  async startTyping(threadId: string, _status?: string): Promise<void> {
    const { channel } = decodeTwilioThreadId(threadId);
    if (channel !== "whatsapp") return;

    const messageSid = this.latestInboundMessageSidByThread.get(threadId);
    if (!messageSid) {
      this.logger.debug?.("No inbound WhatsApp message SID available for typing indicator", {
        threadId,
      });
      return;
    }

    await this.sendWhatsAppTypingIndicator(messageSid);
  }

  async addReaction(
    threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    const { channel } = decodeTwilioThreadId(threadId);
    if (channel === "sms") {
      throw new NotImplementedError(
        "Reactions are not supported on SMS via Twilio.",
        "addReaction",
      );
    }
    // WhatsApp via Twilio does support reactions via the Conversations API,
    // but the public Programmable Messaging API does not. For now we throw
    // a clearer error so callers know to handle it.
    throw new NotImplementedError(
      "Reactions are not supported by the Twilio Programmable Messaging API.",
      "addReaction",
    );
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    return this.addReaction(threadId, messageId, emoji);
  }

  // ---------------------------------------------------------------------------
  // Identity, threads, channels
  // ---------------------------------------------------------------------------

  encodeThreadId(data: import("./types").TwilioThreadId): string {
    return encodeTwilioThreadId(data);
  }

  decodeThreadId(threadId: string): import("./types").TwilioThreadId {
    return decodeTwilioThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    // Conversations are always 1:1 — channel === thread.
    return threadId;
  }

  isDM(_threadId: string): boolean {
    return true;
  }

  async openDM(userId: string): Promise<string> {
    const channel = userId.startsWith("whatsapp:") ? "whatsapp" : "sms";
    const botAddress = this.resolveFrom(channel, undefined);
    if (!botAddress) {
      throw new ValidationError(
        ADAPTER_NAME,
        `No sender configured for channel ${channel}. Set ${
          channel === "whatsapp" ? "whatsappFromNumber" : "fromNumber"
        }.`,
      );
    }
    return encodeTwilioThreadId({
      channel,
      botAddress,
      userAddress: userId,
    });
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<TwilioRawMessage>> {
    // Twilio has a REST messages list API but it's account-wide and slow;
    // most bots use the SDK-managed message-history cache (we set
    // persistMessageHistory: true) which the framework handles.
    return { messages: [] };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { channel, userAddress } = decodeTwilioThreadId(threadId);
    return {
      id: threadId,
      channelId: threadId,
      channelName: `${channel === "whatsapp" ? "WhatsApp" : "SMS"}: ${userAddress}`,
      isDM: true,
      metadata: { channel },
    };
  }

  parseMessage(raw: TwilioRawMessage): Message<TwilioRawMessage> {
    return parseTwilioInbound(raw.params).message;
  }

  renderFormatted(content: FormattedContent): string {
    // No channel context here — fall back to plain text (the SMS rendering
    // strips formatting, which is the safer default).
    return new TwilioFormatConverter("sms").fromAst(content);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private resolveFrom(
    channel: "sms" | "whatsapp",
    botAddress: string | undefined,
  ): string {
    if (botAddress) return botAddress;
    if (channel === "whatsapp") {
      if (!this.whatsappFromNumber) {
        throw new ValidationError(
          ADAPTER_NAME,
          "whatsappFromNumber is not configured but a WhatsApp message was sent.",
        );
      }
      return this.whatsappFromNumber;
    }
    if (!this.fromNumber) {
      throw new ValidationError(
        ADAPTER_NAME,
        "fromNumber is not configured but an SMS message was sent.",
      );
    }
    return this.fromNumber;
  }

  private async sendWhatsAppTypingIndicator(messageSid: string): Promise<void> {
    try {
      const response = await this.client.messaging?.v2?.typingIndicator?.create({
        channel: "whatsapp",
        messageId: messageSid,
      });

      if (!response?.success) {
        this.logger.warn("Failed to send WhatsApp typing indicator", {
          success: response?.success,
        });
      }
    } catch (error) {
      this.logger.warn("Failed to send WhatsApp typing indicator", { error });
    }
  }
}

/**
 * Duck-type check for Twilio RestException and compatible error shapes.
 * Both real `twilio.RestException` instances and test fakes with a numeric
 * `status` property satisfy this contract.
 */
function isTwilioLikeError(err: unknown): err is { status: number; message?: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  );
}

function parseFormBody(body: string): TwilioInboundParams {
  const search = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [k, v] of search) out[k] = v;
  return out as TwilioInboundParams;
}
