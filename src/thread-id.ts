import { ValidationError } from "@chat-adapter/shared";
import type { TwilioChannel, TwilioThreadId } from "./types";

const ADAPTER_NAME = "twilio";

/**
 * Encode a Twilio thread into a stable string ID.
 *
 * Format: `twilio:{channel}:{botAddressB64}:{userAddressB64}`
 *
 * Addresses are base64url-encoded because WhatsApp addresses contain `:`
 * (e.g. `whatsapp:+14155238886`) which would otherwise collide with the
 * segment separator.
 */
export function encodeTwilioThreadId(data: TwilioThreadId): string {
  const bot = Buffer.from(data.botAddress).toString("base64url");
  const user = Buffer.from(data.userAddress).toString("base64url");
  return `${ADAPTER_NAME}:${data.channel}:${bot}:${user}`;
}

/**
 * Decode a Twilio thread ID back into platform-specific data.
 *
 * @throws {ValidationError} if the ID is not a valid Twilio thread ID
 */
export function decodeTwilioThreadId(threadId: string): TwilioThreadId {
  const parts = threadId.split(":");
  if (parts.length !== 4 || parts[0] !== ADAPTER_NAME) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid Twilio thread ID: ${threadId}`,
    );
  }
  const channel = parts[1] as TwilioChannel;
  if (channel !== "sms" && channel !== "whatsapp") {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid Twilio channel "${parts[1]}" in thread ID ${threadId}`,
    );
  }
  const botAddress = Buffer.from(parts[2], "base64url").toString("utf8");
  const userAddress = Buffer.from(parts[3], "base64url").toString("utf8");
  return { channel, botAddress, userAddress };
}

/**
 * Infer the channel from a Twilio address. WhatsApp addresses are always
 * prefixed with `whatsapp:`; SMS/MMS addresses are bare E.164 numbers or
 * messaging service SIDs.
 */
export function inferChannel(address: string): TwilioChannel {
  return address.startsWith("whatsapp:") ? "whatsapp" : "sms";
}
