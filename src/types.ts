import type { Logger } from "chat";

/**
 * Twilio channel type.
 *
 * `sms` and `mms` share the same Twilio sending API and short-code/long-code numbers.
 * `whatsapp` uses Twilio's WhatsApp Business integration with `whatsapp:` prefixed numbers.
 */
export type TwilioChannel = "sms" | "whatsapp";

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
export interface TwilioThreadId {
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
export interface TwilioAdapterConfig {
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
export interface TwilioInboundParams {
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
export interface TwilioRawMessage {
  /** The form-decoded inbound webhook params */
  params: TwilioInboundParams;
  /** Channel inferred from the From/To prefix */
  channel: TwilioChannel;
}
