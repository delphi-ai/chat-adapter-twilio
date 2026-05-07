import {
  BaseFormatConverter,
  parseMarkdown,
  type Content,
  type Root,
} from "chat";
import type { TwilioChannel } from "./types";

/**
 * Convert mdast AST to WhatsApp's flavor of formatting:
 *
 *   *bold*, _italic_, ~strike~, `code`, ```preformatted```
 *
 * @see https://faq.whatsapp.com/539178204879377
 */
function nodeToWhatsApp(node: Content): string {
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
      return `\`\`\`\n${node.value}\n\`\`\``;
    case "link":
      // WhatsApp auto-links URLs and doesn't support hyperlink labels.
      return node.url;
    case "paragraph":
      return node.children.map(nodeToWhatsApp).join("");
    case "heading":
      // WhatsApp has no heading syntax — render as bold.
      return `*${node.children.map(nodeToWhatsApp).join("")}*`;
    case "list":
      return node.children
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "•";
          const itemText = item.children
            .map((child) => nodeToWhatsApp(child as Content))
            .join("\n");
          return `${prefix} ${itemText}`;
        })
        .join("\n");
    case "blockquote":
      return node.children
        .map(nodeToWhatsApp)
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "thematicBreak":
      return "---";
    case "break":
      return "\n";
    case "image":
      return node.url;
    default: {
      const maybeChildren = (node as { children?: Content[] }).children;
      if (Array.isArray(maybeChildren)) {
        return maybeChildren.map(nodeToWhatsApp).join("");
      }
      const maybeValue = (node as { value?: unknown }).value;
      return typeof maybeValue === "string" ? maybeValue : "";
    }
  }
}

/**
 * Convert mdast AST to plain text (formatting stripped). Used for SMS, which
 * has no inline formatting at all.
 */
function nodeToPlain(node: Content): string {
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
      return node.children
        .map((item, i) => {
          const prefix = node.ordered ? `${i + 1}.` : "-";
          const text = item.children
            .map((child) => nodeToPlain(child as Content))
            .join("\n");
          return `${prefix} ${text}`;
        })
        .join("\n");
    case "blockquote":
      return node.children.map(nodeToPlain).join("\n");
    case "thematicBreak":
      return "---";
    case "break":
      return "\n";
    case "image":
      return node.url;
    default: {
      const maybeChildren = (node as { children?: Content[] }).children;
      if (Array.isArray(maybeChildren)) {
        return maybeChildren.map(nodeToPlain).join("");
      }
      const maybeValue = (node as { value?: unknown }).value;
      return typeof maybeValue === "string" ? maybeValue : "";
    }
  }
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
export class TwilioFormatConverter extends BaseFormatConverter {
  constructor(private readonly channel: TwilioChannel = "sms") {
    super();
  }

  fromAst(ast: Root): string {
    if (this.channel === "whatsapp") {
      return this.fromAstWithNodeConverter(ast, nodeToWhatsApp);
    }
    return this.fromAstWithNodeConverter(ast, nodeToPlain);
  }

  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }
}
