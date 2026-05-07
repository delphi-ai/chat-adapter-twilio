import { Logger, Adapter, LockScope, ChatInstance, WebhookOptions, AdapterPostableMessage, RawMessage, StreamChunk, EmojiValue, FetchOptions, FetchResult, ThreadInfo, Message, FormattedContent, BaseFormatConverter, Root } from 'chat';

/**
 * Twilio channel type.
 *
 * `sms` and `mms` share the same Twilio sending API and short-code/long-code numbers.
 * `whatsapp` uses Twilio's WhatsApp Business integration with `whatsapp:` prefixed numbers.
 */
type TwilioChannel = "sms" | "whatsapp";
/**
 * Decoded thread ID for Twilio.
 *
 * Twilio conversations are always 1:1 between a Twilio-owned number (the bot)
 * and a user's number. There is no concept of multi-party threads.
 *
 * Format: `twilio:{channel}:{botAddress}:{userAddress}` where addresses are
 * E.164 phone numbers (e.g. `+15551234567`) for SMS or `whatsapp:+15551234567`
 * for WhatsApp, base64url-encoded so colons in WhatsApp addresses don't conflict
 * with the segment separator.
 */
interface TwilioThreadId {
    /** The channel this thread runs on */
    channel: TwilioChannel;
    /** The Twilio-owned address (the bot's number, including any `whatsapp:` prefix) */
    botAddress: string;
    /** The user's address (their phone number, including any `whatsapp:` prefix) */
    userAddress: string;
}
/**
 * Configuration for the Twilio adapter.
 *
 * The adapter authenticates outbound API calls with `accountSid` + `authToken`
 * (or an API key pair), and verifies inbound webhooks with the auth token via
 * the standard `X-Twilio-Signature` HMAC-SHA1 scheme.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
interface TwilioAdapterConfig {
    /** Twilio Account SID (starts with `AC...`) */
    accountSid: string;
    /**
     * Twilio Auth Token used for both REST API auth and webhook signature
     * verification. Required even if you pass an API key pair, because Twilio
     * webhooks are always signed with the account auth token.
     */
    authToken: string;
    /**
     * Optional API key SID (`SK...`) used for outbound REST calls instead of
     * the account auth token. Recommended for production.
     */
    apiKeySid?: string;
    /** Secret paired with `apiKeySid`. */
    apiKeySecret?: string;
    /**
     * Default sender address for SMS / MMS. E.164 format (e.g. `+15551234567`)
     * or a Messaging Service SID (`MG...`). Required if you intend to send SMS.
     */
    fromNumber?: string;
    /**
     * Default sender address for WhatsApp, prefixed with `whatsapp:`
     * (e.g. `whatsapp:+14155238886`). Required if you intend to send WhatsApp messages.
     */
    whatsappFromNumber?: string;
    /**
     * Public URL Twilio is configured to POST webhooks to. Used for signature
     * verification. If omitted, the adapter falls back to `request.url`, which
     * works when the framework forwards the original public URL.
     */
    webhookUrl?: string;
    /**
     * Disable webhook signature verification. **Only for local development.**
     * Set the `TWILIO_SKIP_VALIDATION` env var or pass `true` here.
     */
    skipValidation?: boolean;
    /** Bot display name reported to Chat SDK (default: `"twilio-bot"`). */
    userName?: string;
    /** Logger instance. */
    logger?: Logger;
}
/**
 * Form-encoded fields posted by Twilio on inbound message webhooks.
 *
 * This is a partial type covering the fields the adapter reads. The full
 * Twilio payload is preserved on the `Message.raw` escape hatch.
 *
 * @see https://www.twilio.com/docs/messaging/guides/webhook-request
 */
interface TwilioInboundParams {
    /** Twilio message SID (e.g. `SM...` or `MM...`) */
    MessageSid: string;
    AccountSid: string;
    /** Sender address (the user). For WhatsApp: `whatsapp:+15551234567`. */
    From: string;
    /** Recipient address (the bot's Twilio number). For WhatsApp: `whatsapp:+14155238886`. */
    To: string;
    /** Plain-text message body. Empty for media-only messages. */
    Body: string;
    /** Number of media items attached (string-encoded integer). */
    NumMedia?: string;
    /** WhatsApp profile name (only present for WhatsApp). */
    ProfileName?: string;
    /** WhatsApp user ID — same digits as From without the `whatsapp:` prefix. */
    WaId?: string;
    /** Quoted-message body (WhatsApp). */
    OriginalRepliedMessageSender?: string;
    OriginalRepliedMessageSid?: string;
    /** Button payload from WhatsApp template quick replies. */
    ButtonText?: string;
    ButtonPayload?: string;
    /** Geo fields if the user shared a location. */
    Latitude?: string;
    Longitude?: string;
    Address?: string;
    Label?: string;
    /** Indexed: MediaUrl0, MediaUrl1, ... and MediaContentType0, MediaContentType1, ... */
    [key: string]: string | undefined;
}
/**
 * Platform-specific raw message type stored on `Message.raw`.
 */
interface TwilioRawMessage {
    /** The form-decoded inbound webhook params */
    params: TwilioInboundParams;
    /** Channel inferred from the From/To prefix */
    channel: TwilioChannel;
}

/**
 * Subset of the official Twilio Node client that this adapter actually uses.
 * Tests inject a fake matching this shape; production code passes the real
 * `twilio()` client.
 */
interface TwilioMessagingClient {
    messages: {
        create(opts: {
            from?: string;
            to: string;
            body: string;
            mediaUrl?: string[];
            messagingServiceSid?: string;
        }): Promise<{
            sid: string;
            [k: string]: unknown;
        }>;
    };
}
/**
 * Constructor config — extends the public `TwilioAdapterConfig` with optional
 * dependency-injected internals used in tests.
 */
interface TwilioAdapterCtorConfig extends TwilioAdapterConfig {
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
declare class TwilioAdapter implements Adapter<unknown, TwilioRawMessage> {
    readonly name = "twilio";
    readonly lockScope: LockScope;
    readonly persistMessageHistory = true;
    readonly userName: string;
    private readonly authToken;
    private readonly fromNumber?;
    private readonly whatsappFromNumber?;
    private readonly webhookUrl?;
    private readonly skipValidation;
    private readonly logger;
    private readonly client;
    private chat;
    constructor(config: TwilioAdapterCtorConfig);
    initialize(chat: ChatInstance): Promise<void>;
    handleWebhook(request: Request, options?: WebhookOptions): Promise<Response>;
    postMessage(threadId: string, message: AdapterPostableMessage): Promise<RawMessage<TwilioRawMessage>>;
    /**
     * Twilio doesn't support editing SMS/MMS/WhatsApp messages.
     */
    editMessage(_threadId: string, _messageId: string, _message: AdapterPostableMessage): Promise<RawMessage<TwilioRawMessage>>;
    /**
     * Twilio doesn't support deleting SMS/MMS/WhatsApp messages once sent.
     */
    deleteMessage(_threadId: string, _messageId: string): Promise<void>;
    /**
     * Buffer all chunks then post once. SMS/WhatsApp via Twilio have no
     * incremental-edit API, so streaming is reduced to a single send.
     */
    stream(threadId: string, textStream: AsyncIterable<string | StreamChunk>, _options?: unknown): Promise<RawMessage<TwilioRawMessage>>;
    startTyping(_threadId: string, _status?: string): Promise<void>;
    addReaction(threadId: string, _messageId: string, _emoji: EmojiValue | string): Promise<void>;
    removeReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void>;
    encodeThreadId(data: TwilioThreadId): string;
    decodeThreadId(threadId: string): TwilioThreadId;
    channelIdFromThreadId(threadId: string): string;
    isDM(_threadId: string): boolean;
    openDM(userId: string): Promise<string>;
    fetchMessages(_threadId: string, _options?: FetchOptions): Promise<FetchResult<TwilioRawMessage>>;
    fetchThread(threadId: string): Promise<ThreadInfo>;
    parseMessage(raw: TwilioRawMessage): Message<TwilioRawMessage>;
    renderFormatted(content: FormattedContent): string;
    private resolveFrom;
}

/**
 * Format converter for Twilio. Renders one of two flavors depending on the
 * channel of the message being sent:
 *
 * - `sms`: plain text, formatting stripped
 * - `whatsapp`: WhatsApp markdown (`*bold*`, `_italic_`, `~strike~`, `` ` ``code`` ` ``)
 *
 * The channel is configured per-converter; the adapter creates one converter
 * lazily per outgoing post and chooses the channel from the decoded thread ID.
 */
declare class TwilioFormatConverter extends BaseFormatConverter {
    private readonly channel;
    constructor(channel?: TwilioChannel);
    fromAst(ast: Root): string;
    toAst(platformText: string): Root;
}

/**
 * Create a Twilio adapter, falling back to environment variables for any
 * config not passed explicitly.
 *
 * Required env vars (or config equivalents):
 * - `TWILIO_ACCOUNT_SID`
 * - `TWILIO_AUTH_TOKEN`
 *
 * At least one sender must be set:
 * - `TWILIO_FROM_NUMBER` for SMS / MMS (E.164 or `MG...` Messaging Service SID)
 * - `TWILIO_WHATSAPP_FROM` for WhatsApp (e.g. `whatsapp:+14155238886`)
 *
 * Optional:
 * - `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` — recommended for production
 * - `TWILIO_WEBHOOK_URL` — pin the URL used for signature verification
 * - `TWILIO_SKIP_VALIDATION=1` — skip signature verification (dev only)
 * - `TWILIO_BOT_USERNAME` — display name (default: `twilio-bot`)
 */
declare function createTwilioAdapter(config?: Partial<TwilioAdapterConfig>): TwilioAdapter;

/**
 * Encode a Twilio thread into a stable string ID.
 *
 * Format: `twilio:{channel}:{botAddressB64}:{userAddressB64}`
 *
 * Addresses are base64url-encoded because WhatsApp addresses contain `:`
 * (e.g. `whatsapp:+14155238886`) which would otherwise collide with the
 * segment separator.
 */
declare function encodeTwilioThreadId(data: TwilioThreadId): string;
/**
 * Decode a Twilio thread ID back into platform-specific data.
 *
 * @throws {ValidationError} if the ID is not a valid Twilio thread ID
 */
declare function decodeTwilioThreadId(threadId: string): TwilioThreadId;
/**
 * Infer the channel from a Twilio address. WhatsApp addresses are always
 * prefixed with `whatsapp:`; SMS/MMS addresses are bare E.164 numbers or
 * messaging service SIDs.
 */
declare function inferChannel(address: string): TwilioChannel;

interface VerifySignatureInput {
    authToken: string;
    /** The value of the `X-Twilio-Signature` header, or `null` if absent. */
    signature: string | null | undefined;
    /** The exact URL Twilio called (the public URL configured on the number). */
    url: string;
    /**
     * The raw form-encoded body (`application/x-www-form-urlencoded`).
     * The Twilio helper internally URL-decodes and alphabetically sorts the
     * keys before HMAC-ing them with `authToken`.
     */
    body: string;
}
/**
 * Verify an inbound Twilio webhook request.
 *
 * Delegates to the official `twilio` library's `validateRequest`, which
 * implements the HMAC-SHA1 algorithm and handles edge cases (port number
 * present/absent, legacy querystring encoding, constant-time comparison).
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
declare function verifyTwilioSignature({ authToken, signature, url, body, }: VerifySignatureInput): boolean;

interface ParsedInbound {
    threadId: string;
    channel: TwilioChannel;
    message: Message<TwilioRawMessage>;
}
/**
 * Parse a form-decoded Twilio inbound webhook payload into a normalized
 * Chat SDK `Message`.
 *
 * Handles SMS, MMS (with media attachments), WhatsApp text, WhatsApp button
 * presses (`ButtonText` / `ButtonPayload`), and shared locations.
 */
declare function parseTwilioInbound(params: TwilioInboundParams): ParsedInbound;

export { type ParsedInbound, TwilioAdapter, type TwilioAdapterConfig, type TwilioAdapterCtorConfig, type TwilioChannel, TwilioFormatConverter, type TwilioInboundParams, type TwilioMessagingClient, type TwilioRawMessage, type TwilioThreadId, createTwilioAdapter, decodeTwilioThreadId, encodeTwilioThreadId, inferChannel, parseTwilioInbound, verifyTwilioSignature };
