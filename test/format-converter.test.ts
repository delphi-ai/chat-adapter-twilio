import { describe, it, expect } from "vitest";
import { parseMarkdown } from "chat";
import { TwilioFormatConverter } from "../src/format-converter";

describe("TwilioFormatConverter (sms)", () => {
  const converter = new TwilioFormatConverter("sms");

  it("strips bold formatting to plain text", () => {
    const ast = parseMarkdown("Hello **world**");
    expect(converter.fromAst(ast)).toBe("Hello world");
  });

  it("strips italic and inline code", () => {
    const ast = parseMarkdown("It is _important_ to run `npm test`");
    expect(converter.fromAst(ast)).toBe("It is important to run npm test");
  });

  it("renders a link as its URL only", () => {
    const ast = parseMarkdown("See [docs](https://example.com)");
    expect(converter.fromAst(ast)).toBe("See https://example.com");
  });

  it("renders an unordered list with dashes", () => {
    const ast = parseMarkdown("- one\n- two\n- three");
    expect(converter.fromAst(ast)).toBe("- one\n- two\n- three");
  });
});

describe("TwilioFormatConverter (whatsapp)", () => {
  const converter = new TwilioFormatConverter("whatsapp");

  it("renders bold with single asterisks", () => {
    const ast = parseMarkdown("Hello **world**");
    expect(converter.fromAst(ast)).toBe("Hello *world*");
  });

  it("renders italic with underscores", () => {
    const ast = parseMarkdown("This is _important_");
    expect(converter.fromAst(ast)).toBe("This is _important_");
  });

  it("renders strikethrough with single tildes", () => {
    const ast = parseMarkdown("This is ~~wrong~~");
    expect(converter.fromAst(ast)).toBe("This is ~wrong~");
  });

  it("renders inline code with backticks", () => {
    const ast = parseMarkdown("Run `npm test`");
    expect(converter.fromAst(ast)).toBe("Run `npm test`");
  });

  it("renders a heading as bold (no native heading syntax)", () => {
    const ast = parseMarkdown("# Welcome");
    expect(converter.fromAst(ast)).toBe("*Welcome*");
  });

  it("renders a link as just the URL", () => {
    const ast = parseMarkdown("See [docs](https://example.com)");
    expect(converter.fromAst(ast)).toBe("See https://example.com");
  });
});

describe("TwilioFormatConverter.toAst", () => {
  const converter = new TwilioFormatConverter("sms");

  it("parses inbound bodies as markdown so the AST is usable", () => {
    const ast = converter.toAst("Hello **world**");
    expect(ast.type).toBe("root");
    expect(ast.children.length).toBeGreaterThan(0);
  });
});
