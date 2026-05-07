import { validateRequest } from "twilio";

export interface VerifySignatureInput {
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
export function verifyTwilioSignature({
  authToken,
  signature,
  url,
  body,
}: VerifySignatureInput): boolean {
  if (!signature) {
    return false;
  }
  // Form bodies use percent-encoding for plus signs, spaces, etc. Decode the
  // params so they round-trip through Twilio's signing algorithm correctly.
  const params: Record<string, string> = {};
  const search = new URLSearchParams(body);
  for (const [key, value] of search) {
    params[key] = value;
  }
  return validateRequest(authToken, signature, url, params);
}
