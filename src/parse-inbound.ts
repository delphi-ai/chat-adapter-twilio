import { Message, type Attachment, type Author } from "chat";
import { TwilioFormatConverter } from "./format-converter";
import { encodeTwilioThreadId, inferChannel } from "./thread-id";
import type {
  TwilioChannel,
  TwilioInboundParams,
  TwilioRawMessage,
} from "./types";

export interface ParsedInbound {
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
export function parseTwilioInbound(
  params: TwilioInboundParams,
): ParsedInbound {
  const channel = inferChannel(params.From);
  const threadId = encodeTwilioThreadId({
    channel,
    botAddress: params.To,
    userAddress: params.From,
  });

  const text = extractText(params);
  const author = buildAuthor(params);
  const attachments = buildAttachments(params);
  const formatted = new TwilioFormatConverter(channel).toAst(text);
  const raw: TwilioRawMessage = { params, channel };

  const message = new Message<TwilioRawMessage>({
    id: params.MessageSid,
    threadId,
    text,
    formatted,
    raw,
    author,
    attachments,
    metadata: {
      dateSent: new Date(),
      edited: false,
    },
  });

  return { threadId, channel, message };
}

function extractText(params: TwilioInboundParams): string {
  if (params.Body && params.Body.trim().length > 0) {
    return params.Body;
  }
  // WhatsApp button press: surface the visible label as the text. Handlers
  // can still read params.ButtonPayload via Message.raw if they need the
  // postback ID.
  if (params.ButtonText) {
    return params.ButtonText;
  }
  // Shared location: render as a human-readable summary.
  if (params.Latitude && params.Longitude) {
    const parts = [`Location: ${params.Latitude}, ${params.Longitude}`];
    if (params.Label) {
      parts[0] = `Location (${params.Label}): ${params.Latitude}, ${params.Longitude}`;
    }
    if (params.Address) {
      parts.push(params.Address);
    }
    return parts.join(" — ");
  }
  return "";
}

function buildAuthor(params: TwilioInboundParams): Author {
  const userId = params.From;
  const displayName = params.ProfileName?.trim() || userId;
  return {
    userId,
    userName: displayName,
    fullName: displayName,
    isBot: false,
    isMe: false,
  };
}

function buildAttachments(params: TwilioInboundParams): Attachment[] {
  const numMedia = Number.parseInt(params.NumMedia ?? "0", 10);
  if (!Number.isFinite(numMedia) || numMedia <= 0) {
    return [];
  }
  const attachments: Attachment[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    const mimeType = params[`MediaContentType${i}`];
    if (!url) continue;
    attachments.push({
      type: classifyMedia(mimeType),
      mimeType,
      url,
    });
  }
  return attachments;
}

function classifyMedia(mimeType: string | undefined): Attachment["type"] {
  if (!mimeType) return "file";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}
