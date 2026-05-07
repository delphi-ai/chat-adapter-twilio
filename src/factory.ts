import { ConsoleLogger, type Logger } from "chat";
import { ValidationError } from "@chat-adapter/shared";
import { TwilioAdapter, type TwilioAdapterCtorConfig } from "./adapter";
import type { TwilioAdapterConfig } from "./types";

/**
 * Create a Twilio adapter, falling back to environment variables for any
 * config not passed explicitly.
 *
 * Required env vars (or config equivalents):
 * - `TWILIO_ACCOUNT_SID`
 * - `TWILIO_AUTH_TOKEN`
 *
 * At least one sender must be set:
 * - `TWILIO_FROM_NUMBER` for SMS / MMS (E.164 or `MG...` Messaging Service SID)
 * - `TWILIO_WHATSAPP_FROM` for WhatsApp (e.g. `whatsapp:+14155238886`)
 *
 * Optional:
 * - `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` — recommended for production
 * - `TWILIO_WEBHOOK_URL` — pin the URL used for signature verification
 * - `TWILIO_SKIP_VALIDATION=1` — skip signature verification (dev only)
 * - `TWILIO_BOT_USERNAME` — display name (default: `twilio-bot`)
 */
export function createTwilioAdapter(
  config?: Partial<TwilioAdapterConfig>,
): TwilioAdapter {
  const logger: Logger =
    config?.logger ?? new ConsoleLogger("info").child("twilio");

  const accountSid = config?.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) {
    throw new ValidationError(
      "twilio",
      "accountSid is required. Set TWILIO_ACCOUNT_SID or pass it in config.",
    );
  }
  const authToken = config?.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    throw new ValidationError(
      "twilio",
      "authToken is required. Set TWILIO_AUTH_TOKEN or pass it in config.",
    );
  }

  const fromNumber = config?.fromNumber ?? process.env.TWILIO_FROM_NUMBER;
  const whatsappFromNumber =
    config?.whatsappFromNumber ?? process.env.TWILIO_WHATSAPP_FROM;

  const ctorConfig: TwilioAdapterCtorConfig = {
    accountSid,
    authToken,
    apiKeySid: config?.apiKeySid ?? process.env.TWILIO_API_KEY_SID,
    apiKeySecret:
      config?.apiKeySecret ?? process.env.TWILIO_API_KEY_SECRET,
    fromNumber,
    whatsappFromNumber,
    webhookUrl: config?.webhookUrl ?? process.env.TWILIO_WEBHOOK_URL,
    skipValidation:
      config?.skipValidation ?? process.env.TWILIO_SKIP_VALIDATION === "1",
    userName:
      config?.userName ?? process.env.TWILIO_BOT_USERNAME ?? "twilio-bot",
    logger,
  };

  return new TwilioAdapter(ctorConfig);
}
