import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyTwilioSignature } from "../src/signature";

const AUTH_TOKEN = "test-auth-token-1234567890abcdef";

/**
 * Build the X-Twilio-Signature header for a given URL and form body, using
 * the same algorithm Twilio uses (HMAC-SHA1 over URL + alphabetically-sorted
 * concatenated key+value pairs).
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function signTwilio(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sorted = Object.keys(params).sort();
  const data = sorted.reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

describe("verifyTwilioSignature", () => {
  const url = "https://example.com/webhook/twilio";
  const params = {
    MessageSid: "SM_TEST_MESSAGE_SID",
    AccountSid: "AC_TEST_ACCOUNT_SID",
    From: "+15557654321",
    To: "+15551234567",
    Body: "Hello, bot!",
  };

  it("accepts a correctly-signed request", () => {
    const signature = signTwilio(AUTH_TOKEN, url, params);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url,
        body: formBody(params),
      }),
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        signature: "definitely-not-the-right-signature",
        url,
        body: formBody(params),
      }),
    ).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        signature: null,
        url,
        body: formBody(params),
      }),
    ).toBe(false);
  });

  it("rejects when the auth token is wrong", () => {
    const signature = signTwilio(AUTH_TOKEN, url, params);
    expect(
      verifyTwilioSignature({
        authToken: "different-token",
        signature,
        url,
        body: formBody(params),
      }),
    ).toBe(false);
  });

  it("rejects when the body has been tampered with", () => {
    const signature = signTwilio(AUTH_TOKEN, url, params);
    const tampered = formBody({ ...params, Body: "evil payload" });
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url,
        body: tampered,
      }),
    ).toBe(false);
  });

  it("verifies SMS parameters with extra metadata", () => {
    const smsParams = {
      MessageSid: "SM_TEST_MESSAGE_SID",
      AccountSid: "AC_TEST_ACCOUNT_SID",
      From: "+15557654321",
      To: "+15551234567",
      Body: "Hi from SMS",
      NumMedia: "0",
    };
    const signature = signTwilio(AUTH_TOKEN, url, smsParams);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        signature,
        url,
        body: formBody(smsParams),
      }),
    ).toBe(true);
  });
});
