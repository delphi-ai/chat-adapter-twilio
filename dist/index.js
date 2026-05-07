// src/adapter.ts
import {
  extractCard,
  extractFiles,
  ValidationError as ValidationError2,
  AuthenticationError,
  AdapterRateLimitError,
  NetworkError,
  PermissionError
} from "@chat-adapter/shared";
import {
  ConsoleLogger,
  NotImplementedError
} from "chat";
import twilio from "twilio";

// src/format-converter.ts
import {
  BaseFormatConverter,
  parseMarkdown
} from "chat";
function nodeToWhatsApp(node) {
  switch (node.type) {
    case "text":
      return node.value;
    case "strong":
      return `*${node.children.map(nodeToWhatsApp).join("")}*`;
    case "emphasis":
      return `_${node.children.map(nodeToWhatsApp).join("")}_`;
    case "delete":
      return `~${node.children.map(nodeToWhatsApp).join("")}~`;
    case "inlineCode":
      return `\`${node.value}\``;
    case "code":
      return `\`\`\`
${node.value}
\`\`\``;
    case "link":
      return node.url;
    case "paragraph":
      return node.children.map(nodeToWhatsApp).join("");
    case "heading":
      return `*${node.children.map(nodeToWhatsApp).join("")}*`;
    case "list":
      return node.children.map((item, i) => {
        const prefix = node.ordered ? `${i + 1}.` : "\u2022";
        const itemText = item.children.map((child) => nodeToWhatsApp(child)).join("\n");
        return `${prefix} ${itemText}`;
      }).join("\n");
    case "blockquote":
      return node.children.map(nodeToWhatsApp).join("\n").split("\n").map((line) => `> ${line}`).join("\n");
    case "thematicBreak":
      return "---";
    case "break":
      return "\n";
    case "image":
      return node.url;
    default: {
      const maybeChildren = node.children;
      if (Array.isArray(maybeChildren)) {
        return maybeChildren.map(nodeToWhatsApp).join("");
      }
      const maybeValue = node.value;
      return typeof maybeValue === "string" ? maybeValue : "";
    }
  }
}
function nodeToPlain(node) {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
      return node.value;
    case "link":
      return node.url;
    case "paragraph":
    case "strong":
    case "emphasis":
    case "delete":
    case "heading":
      return node.children.map(nodeToPlain).join("");
    case "list":
      return node.children.map((item, i) => {
        const prefix = node.ordered ? `${i + 1}.` : "-";
        const text = item.children.map((child) => nodeToPlain(child)).join("\n");
        return `${prefix} ${text}`;
      }).join("\n");
    case "blockquote":
      return node.children.map(nodeToPlain).join("\n");
    case "thematicBreak":
      return "---";
    case "break":
      return "\n";
    case "image":
      return node.url;
    default: {
      const maybeChildren = node.children;
      if (Array.isArray(maybeChildren)) {
        return maybeChildren.map(nodeToPlain).join("");
      }
      const maybeValue = node.value;
      return typeof maybeValue === "string" ? maybeValue : "";
    }
  }
}
var TwilioFormatConverter = class extends BaseFormatConverter {
  constructor(channel = "sms") {
    super();
    this.channel = channel;
  }
  channel;
  fromAst(ast) {
    if (this.channel === "whatsapp") {
      return this.fromAstWithNodeConverter(ast, nodeToWhatsApp);
    }
    return this.fromAstWithNodeConverter(ast, nodeToPlain);
  }
  toAst(platformText) {
    return parseMarkdown(platformText);
  }
};

// src/parse-inbound.ts
import { Message } from "chat";

// src/thread-id.ts
import { ValidationError } from "@chat-adapter/shared";
var ADAPTER_NAME = "twilio";
function encodeTwilioThreadId(data) {
  const bot = Buffer.from(data.botAddress).toString("base64url");
  const user = Buffer.from(data.userAddress).toString("base64url");
  return `${ADAPTER_NAME}:${data.channel}:${bot}:${user}`;
}
function decodeTwilioThreadId(threadId) {
  const parts = threadId.split(":");
  if (parts.length !== 4 || parts[0] !== ADAPTER_NAME) {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid Twilio thread ID: ${threadId}`
    );
  }
  const channel = parts[1];
  if (channel !== "sms" && channel !== "whatsapp") {
    throw new ValidationError(
      ADAPTER_NAME,
      `Invalid Twilio channel "${parts[1]}" in thread ID ${threadId}`
    );
  }
  const botAddress = Buffer.from(parts[2], "base64url").toString("utf8");
  const userAddress = Buffer.from(parts[3], "base64url").toString("utf8");
  return { channel, botAddress, userAddress };
}
function inferChannel(address) {
  return address.startsWith("whatsapp:") ? "whatsapp" : "sms";
}

// src/parse-inbound.ts
function parseTwilioInbound(params) {
  const channel = inferChannel(params.From);
  const threadId = encodeTwilioThreadId({
    channel,
    botAddress: params.To,
    userAddress: params.From
  });
  const text = extractText(params);
  const author = buildAuthor(params);
  const attachments = buildAttachments(params);
  const formatted = new TwilioFormatConverter(channel).toAst(text);
  const raw = { params, channel };
  const message = new Message({
    id: params.MessageSid,
    threadId,
    text,
    formatted,
    raw,
    author,
    attachments,
    metadata: {
      dateSent: /* @__PURE__ */ new Date(),
      edited: false
    }
  });
  return { threadId, channel, message };
}
function extractText(params) {
  if (params.Body && params.Body.trim().length > 0) {
    return params.Body;
  }
  if (params.ButtonText) {
    return params.ButtonText;
  }
  if (params.Latitude && params.Longitude) {
    const parts = [`Location: ${params.Latitude}, ${params.Longitude}`];
    if (params.Label) {
      parts[0] = `Location (${params.Label}): ${params.Latitude}, ${params.Longitude}`;
    }
    if (params.Address) {
      parts.push(params.Address);
    }
    return parts.join(" \u2014 ");
  }
  return "";
}
function buildAuthor(params) {
  const userId = params.From;
  const displayName = params.ProfileName?.trim() || userId;
  return {
    userId,
    userName: displayName,
    fullName: displayName,
    isBot: false,
    isMe: false
  };
}
function buildAttachments(params) {
  const numMedia = Number.parseInt(params.NumMedia ?? "0", 10);
  if (!Number.isFinite(numMedia) || numMedia <= 0) {
    return [];
  }
  const attachments = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    const mimeType = params[`MediaContentType${i}`];
    if (!url) continue;
    attachments.push({
      type: classifyMedia(mimeType),
      mimeType,
      url
    });
  }
  return attachments;
}
function classifyMedia(mimeType) {
  if (!mimeType) return "file";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

// src/signature.ts
import { validateRequest } from "twilio";
function verifyTwilioSignature({
  authToken,
  signature,
  url,
  body
}) {
  if (!signature) {
    return false;
  }
  const params = {};
  const search = new URLSearchParams(body);
  for (const [key, value] of search) {
    params[key] = value;
  }
  return validateRequest(authToken, signature, url, params);
}

// src/adapter.ts
var ADAPTER_NAME2 = "twilio";
var TwilioAdapter = class {
  name = ADAPTER_NAME2;
  lockScope = "channel";
  persistMessageHistory = true;
  userName;
  authToken;
  fromNumber;
  whatsappFromNumber;
  webhookUrl;
  skipValidation;
  logger;
  client;
  chat = null;
  constructor(config) {
    this.authToken = config.authToken;
    this.fromNumber = config.fromNumber;
    this.whatsappFromNumber = config.whatsappFromNumber;
    this.webhookUrl = config.webhookUrl;
    this.skipValidation = config.skipValidation === true;
    this.userName = config.userName ?? "twilio-bot";
    this.logger = config.logger ?? new ConsoleLogger("info").child(ADAPTER_NAME2);
    if (config.twilioClient) {
      this.client = config.twilioClient;
    } else {
      const sid = config.apiKeySid ?? config.accountSid;
      const secret = config.apiKeySecret ?? config.authToken;
      this.client = twilio(sid, secret, {
        accountSid: config.accountSid
      });
    }
  }
  async initialize(chat) {
    this.chat = chat;
    this.logger.info("Twilio adapter initialized");
  }
  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------
  async handleWebhook(request, options) {
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
        body
      });
      if (!ok) {
        this.logger.warn("Twilio webhook signature invalid", { url });
        return new Response("Invalid signature", { status: 401 });
      }
    }
    const params = parseFormBody(body);
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
      const { threadId, message } = parseTwilioInbound(params);
      this.chat.processMessage(this, threadId, message, options);
    } catch (error) {
      this.logger.error("Failed to process Twilio webhook", { error });
    }
    return new Response("ok", { status: 200 });
  }
  // ---------------------------------------------------------------------------
  // Posting
  // ---------------------------------------------------------------------------
  async postMessage(threadId, message) {
    const { channel, botAddress, userAddress } = decodeTwilioThreadId(threadId);
    const card = extractCard(message);
    const converter = new TwilioFormatConverter(channel);
    const body = card ? converter.renderPostable({ card }) : converter.renderPostable(message);
    const from = this.resolveFrom(channel, botAddress);
    const files = extractFiles(message);
    const mediaUrls = files.filter((f) => "url" in f && typeof f.url === "string").map((f) => f.url);
    let response;
    try {
      response = await this.client.messages.create({
        from,
        to: userAddress,
        body,
        ...mediaUrls.length > 0 ? { mediaUrl: mediaUrls } : {}
      });
    } catch (err) {
      const originalError = err instanceof Error ? err : void 0;
      const status = isTwilioLikeError(err) ? err.status : void 0;
      if (status === 401) {
        throw new AuthenticationError(ADAPTER_NAME2, originalError?.message);
      }
      if (status === 403) {
        throw new PermissionError(ADAPTER_NAME2, "send message");
      }
      if (status === 429) {
        throw new AdapterRateLimitError(ADAPTER_NAME2);
      }
      throw new NetworkError(
        ADAPTER_NAME2,
        originalError?.message ?? String(err),
        originalError
      );
    }
    const synthParams = {
      MessageSid: response.sid,
      AccountSid: "",
      From: botAddress,
      To: userAddress,
      Body: body
    };
    return {
      id: response.sid,
      threadId,
      raw: { params: synthParams, channel }
    };
  }
  /**
   * Twilio doesn't support editing SMS/MMS/WhatsApp messages.
   */
  async editMessage(_threadId, _messageId, _message) {
    throw new NotImplementedError(
      "Twilio does not support editing messages. Send a new message instead.",
      "editMessage"
    );
  }
  /**
   * Twilio doesn't support deleting SMS/MMS/WhatsApp messages once sent.
   */
  async deleteMessage(_threadId, _messageId) {
    throw new NotImplementedError(
      "Twilio does not support deleting messages.",
      "deleteMessage"
    );
  }
  /**
   * Buffer all chunks then post once. SMS/WhatsApp via Twilio have no
   * incremental-edit API, so streaming is reduced to a single send.
   */
  async stream(threadId, textStream, _options) {
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
  async startTyping(_threadId, _status) {
  }
  async addReaction(threadId, _messageId, _emoji) {
    const { channel } = decodeTwilioThreadId(threadId);
    if (channel === "sms") {
      throw new NotImplementedError(
        "Reactions are not supported on SMS via Twilio.",
        "addReaction"
      );
    }
    throw new NotImplementedError(
      "Reactions are not supported by the Twilio Programmable Messaging API.",
      "addReaction"
    );
  }
  async removeReaction(threadId, messageId, emoji) {
    return this.addReaction(threadId, messageId, emoji);
  }
  // ---------------------------------------------------------------------------
  // Identity, threads, channels
  // ---------------------------------------------------------------------------
  encodeThreadId(data) {
    return encodeTwilioThreadId(data);
  }
  decodeThreadId(threadId) {
    return decodeTwilioThreadId(threadId);
  }
  channelIdFromThreadId(threadId) {
    return threadId;
  }
  isDM(_threadId) {
    return true;
  }
  async openDM(userId) {
    const channel = userId.startsWith("whatsapp:") ? "whatsapp" : "sms";
    const botAddress = this.resolveFrom(channel, void 0);
    if (!botAddress) {
      throw new ValidationError2(
        ADAPTER_NAME2,
        `No sender configured for channel ${channel}. Set ${channel === "whatsapp" ? "whatsappFromNumber" : "fromNumber"}.`
      );
    }
    return encodeTwilioThreadId({
      channel,
      botAddress,
      userAddress: userId
    });
  }
  async fetchMessages(_threadId, _options) {
    return { messages: [] };
  }
  async fetchThread(threadId) {
    const { channel, userAddress } = decodeTwilioThreadId(threadId);
    return {
      id: threadId,
      channelId: threadId,
      channelName: `${channel === "whatsapp" ? "WhatsApp" : "SMS"}: ${userAddress}`,
      isDM: true,
      metadata: { channel }
    };
  }
  parseMessage(raw) {
    return parseTwilioInbound(raw.params).message;
  }
  renderFormatted(content) {
    return new TwilioFormatConverter("sms").fromAst(content);
  }
  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  resolveFrom(channel, botAddress) {
    if (botAddress) return botAddress;
    if (channel === "whatsapp") {
      if (!this.whatsappFromNumber) {
        throw new ValidationError2(
          ADAPTER_NAME2,
          "whatsappFromNumber is not configured but a WhatsApp message was sent."
        );
      }
      return this.whatsappFromNumber;
    }
    if (!this.fromNumber) {
      throw new ValidationError2(
        ADAPTER_NAME2,
        "fromNumber is not configured but an SMS message was sent."
      );
    }
    return this.fromNumber;
  }
};
function isTwilioLikeError(err) {
  return typeof err === "object" && err !== null && "status" in err && typeof err.status === "number";
}
function parseFormBody(body) {
  const search = new URLSearchParams(body);
  const out = {};
  for (const [k, v] of search) out[k] = v;
  return out;
}

// src/factory.ts
import { ConsoleLogger as ConsoleLogger2 } from "chat";
import { ValidationError as ValidationError3 } from "@chat-adapter/shared";
function createTwilioAdapter(config) {
  const logger = config?.logger ?? new ConsoleLogger2("info").child("twilio");
  const accountSid = config?.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) {
    throw new ValidationError3(
      "twilio",
      "accountSid is required. Set TWILIO_ACCOUNT_SID or pass it in config."
    );
  }
  const authToken = config?.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    throw new ValidationError3(
      "twilio",
      "authToken is required. Set TWILIO_AUTH_TOKEN or pass it in config."
    );
  }
  const fromNumber = config?.fromNumber ?? process.env.TWILIO_FROM_NUMBER;
  const whatsappFromNumber = config?.whatsappFromNumber ?? process.env.TWILIO_WHATSAPP_FROM;
  const ctorConfig = {
    accountSid,
    authToken,
    apiKeySid: config?.apiKeySid ?? process.env.TWILIO_API_KEY_SID,
    apiKeySecret: config?.apiKeySecret ?? process.env.TWILIO_API_KEY_SECRET,
    fromNumber,
    whatsappFromNumber,
    webhookUrl: config?.webhookUrl ?? process.env.TWILIO_WEBHOOK_URL,
    skipValidation: config?.skipValidation ?? process.env.TWILIO_SKIP_VALIDATION === "1",
    userName: config?.userName ?? process.env.TWILIO_BOT_USERNAME ?? "twilio-bot",
    logger
  };
  return new TwilioAdapter(ctorConfig);
}
export {
  TwilioAdapter,
  TwilioFormatConverter,
  createTwilioAdapter,
  decodeTwilioThreadId,
  encodeTwilioThreadId,
  inferChannel,
  parseTwilioInbound,
  verifyTwilioSignature
};
//# sourceMappingURL=index.js.map