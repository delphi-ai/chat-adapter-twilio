import { describe, it, expect } from "vitest";
import { ValidationError } from "@chat-adapter/shared";
import {
  encodeTwilioThreadId,
  decodeTwilioThreadId,
  inferChannel,
} from "../src/thread-id";

describe("encodeTwilioThreadId / decodeTwilioThreadId", () => {
  it("round-trips an SMS thread", () => {
    const data = {
      channel: "sms" as const,
      botAddress: "+15551234567",
      userAddress: "+15557654321",
    };
    const encoded = encodeTwilioThreadId(data);
    expect(encoded.startsWith("twilio:sms:")).toBe(true);
    expect(decodeTwilioThreadId(encoded)).toEqual(data);
  });

  it("round-trips a WhatsApp thread (addresses contain colons)", () => {
    const data = {
      channel: "whatsapp" as const,
      botAddress: "whatsapp:+14155238886",
      userAddress: "whatsapp:+15557654321",
    };
    const encoded = encodeTwilioThreadId(data);
    expect(encoded.startsWith("twilio:whatsapp:")).toBe(true);
    expect(decodeTwilioThreadId(encoded)).toEqual(data);
  });
});

describe("decodeTwilioThreadId errors", () => {
  it("rejects an unknown adapter prefix", () => {
    expect(() => decodeTwilioThreadId("slack:C123:T456")).toThrow(
      ValidationError,
    );
  });

  it("rejects an unknown channel", () => {
    // valid structure (4 segments) but channel is bogus
    const bot = Buffer.from("+15551234567").toString("base64url");
    const user = Buffer.from("+15557654321").toString("base64url");
    expect(() =>
      decodeTwilioThreadId(`twilio:fax:${bot}:${user}`),
    ).toThrow(ValidationError);
  });

  it("rejects a malformed thread id", () => {
    expect(() => decodeTwilioThreadId("twilio:sms:onlyone")).toThrow(
      ValidationError,
    );
  });
});

describe("inferChannel", () => {
  it("returns whatsapp for whatsapp-prefixed addresses", () => {
    expect(inferChannel("whatsapp:+14155238886")).toBe("whatsapp");
  });

  it("returns sms for bare E.164 numbers", () => {
    expect(inferChannel("+15551234567")).toBe("sms");
  });

  it("returns sms for messaging service SIDs", () => {
    expect(inferChannel("MG_TEST_MESSAGING_SERVICE_SID")).toBe("sms");
  });
});
