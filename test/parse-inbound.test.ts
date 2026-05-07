import { describe, it, expect } from "vitest";
import { parseTwilioInbound } from "../src/parse-inbound";
import { decodeTwilioThreadId } from "../src/thread-id";

describe("parseTwilioInbound", () => {
  it("parses a plain SMS into a Message", () => {
    const params = {
      MessageSid: "SM_TEST_MESSAGE_SID_1",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "+15557654321",
      To: "+15551234567",
      Body: "Hello, bot!",
      NumMedia: "0",
    };

    const result = parseTwilioInbound(params);

    expect(result.message.id).toBe("SM_TEST_MESSAGE_SID_1");
    expect(result.message.text).toBe("Hello, bot!");
    expect(result.message.author.userId).toBe("+15557654321");
    expect(result.message.author.userName).toBe("+15557654321");
    expect(result.message.author.isBot).toBe(false);
    expect(result.message.author.isMe).toBe(false);
    expect(result.message.attachments).toEqual([]);
    expect(result.channel).toBe("sms");

    const threadData = decodeTwilioThreadId(result.threadId);
    expect(threadData.channel).toBe("sms");
    expect(threadData.botAddress).toBe("+15551234567");
    expect(threadData.userAddress).toBe("+15557654321");
  });

  it("attaches MMS media as image attachments", () => {
    const params = {
      MessageSid: "MM_TEST_MESSAGE_SID_1",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "+15557654321",
      To: "+15551234567",
      Body: "Look at this!",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/Media/ME000001",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/Media/ME000002",
      MediaContentType1: "video/mp4",
    };

    const result = parseTwilioInbound(params);

    expect(result.message.attachments).toHaveLength(2);
    expect(result.message.attachments[0]).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
      url: "https://api.twilio.com/Media/ME000001",
    });
    expect(result.message.attachments[1]).toMatchObject({
      type: "video",
      mimeType: "video/mp4",
      url: "https://api.twilio.com/Media/ME000002",
    });
  });

  it("uses ProfileName for WhatsApp messages and infers the whatsapp channel", () => {
    const params = {
      MessageSid: "SM_TEST_MESSAGE_SID_2",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "whatsapp:+15557654321",
      To: "whatsapp:+14155238886",
      Body: "Hi from WhatsApp",
      NumMedia: "0",
      ProfileName: "Alice",
      WaId: "15557654321",
    };

    const result = parseTwilioInbound(params);

    expect(result.channel).toBe("whatsapp");
    expect(result.message.author.userId).toBe("whatsapp:+15557654321");
    expect(result.message.author.userName).toBe("Alice");
    expect(result.message.author.fullName).toBe("Alice");

    const threadData = decodeTwilioThreadId(result.threadId);
    expect(threadData.channel).toBe("whatsapp");
    expect(threadData.botAddress).toBe("whatsapp:+14155238886");
    expect(threadData.userAddress).toBe("whatsapp:+15557654321");
  });

  it("renders a WhatsApp button press as the button text in the body", () => {
    const params = {
      MessageSid: "SM_TEST_MESSAGE_SID_3",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "whatsapp:+15557654321",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "0",
      ButtonText: "Yes, please",
      ButtonPayload: "approve",
      ButtonType: "REPLY",
    };

    const result = parseTwilioInbound(params);

    // Body is empty for button presses; surface the button label as text
    // so handlers can read message.text without special-casing.
    expect(result.message.text).toBe("Yes, please");
  });

  it("renders a shared location as a synthetic body with lat/lng", () => {
    const params = {
      MessageSid: "SM_TEST_MESSAGE_SID_4",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "whatsapp:+15557654321",
      To: "whatsapp:+14155238886",
      Body: "",
      NumMedia: "0",
      Latitude: "37.7749",
      Longitude: "-122.4194",
      Address: "1 Market St, San Francisco, CA",
      Label: "Office",
    };

    const result = parseTwilioInbound(params);

    expect(result.message.text).toContain("37.7749");
    expect(result.message.text).toContain("-122.4194");
  });

  it("preserves the raw payload on Message.raw for escape-hatch access", () => {
    const params = {
      MessageSid: "SM_TEST_MESSAGE_SID_5",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "+15557654321",
      To: "+15551234567",
      Body: "Plain",
      NumMedia: "0",
    };
    const result = parseTwilioInbound(params);
    expect(result.message.raw.params).toEqual(params);
    expect(result.message.raw.channel).toBe("sms");
  });
});
