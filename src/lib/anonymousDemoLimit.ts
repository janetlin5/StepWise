import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const anonymousDemoLimit = 5;
export const anonymousDemoUsageCookie = "stepwise_demo_usage";

type AnonymousDemoUsage = {
  used: number;
};

export type AnonymousDemoUsageResult = {
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
};

const cookieMaxAgeSeconds = 60 * 60 * 24 * 30;

export function checkAnonymousDemoUsage(request: Request): AnonymousDemoUsageResult {
  const used = getAnonymousDemoUsageFromCookie(request.headers.get("cookie"));
  const allowed = used < anonymousDemoLimit;

  return {
    allowed,
    used,
    limit: anonymousDemoLimit,
    message: allowed
      ? undefined
      : "You've used the free demo sessions. Create a free account to continue learning.",
  };
}

export function addAnonymousDemoUsageCookie<T>(
  response: NextResponse<T>,
  used: number
) {
  response.cookies.set({
    name: anonymousDemoUsageCookie,
    value: encodeAnonymousDemoUsage(Math.min(used, anonymousDemoLimit)),
    path: "/",
    sameSite: "lax",
    // The app is HTTPS-only in production; never send the quota cookie over HTTP there.
    secure: process.env.NODE_ENV === "production",
    maxAge: cookieMaxAgeSeconds,
  });

  return response;
}

export function getAnonymousDemoUsageFromCookie(cookieHeader: string | null) {
  if (!cookieHeader) return 0;

  const rawCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${anonymousDemoUsageCookie}=`));

  if (!rawCookie) return 0;

  return decodeAnonymousDemoUsage(
    rawCookie.slice(anonymousDemoUsageCookie.length + 1)
  );
}

// ---------------------------------------------------------------------------
// Signing detects edits to an existing cookie; deleting it still resets
// anonymous identity. This is not server-side abuse prevention.
// Set ANONYMOUS_DEMO_COOKIE_SECRET in the
// deployment environment (any random string >= 16 chars). Without it, the
// cookie falls back to the legacy unsigned format: fine for local dev, but
// NOT protected in production.
// ---------------------------------------------------------------------------

function getCookieHmacSecret(): string | null {
  const secret = process.env.ANONYMOUS_DEMO_COOKIE_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

let warnedMissingSecret = false;
function warnMissingSecretOnce() {
  if (warnedMissingSecret) return;
  warnedMissingSecret = true;
  console.warn(
    "[anonymousDemoLimit] ANONYMOUS_DEMO_COOKIE_SECRET is not set: demo quota " +
      "cookies are unsigned and can be forged. Set the secret in production."
  );
}

function signCookiePayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function verifyCookieSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = signCookiePayload(payload, secret);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encodeAnonymousDemoUsage(used: number) {
  // NOTE: Next.js `response.cookies.set()` percent-encodes the cookie value
  // itself, so pre-encoding here would double-encode it. A double-encoded
  // value fails JSON.parse on read, silently resetting usage to 0 every
  // request (counter stuck at 1/5, demo limit never enforced).
  // Signed format is "<json>.<base64url-signature>"; the JSON stays readable
  // so the client can still parse the counter for display.
  const payload = JSON.stringify({ used, v: 1 });
  const secret = getCookieHmacSecret();
  if (!secret) {
    warnMissingSecretOnce();
    return JSON.stringify({ used });
  }
  return `${payload}.${signCookiePayload(payload, secret)}`;
}

export function decodeAnonymousDemoUsage(value: string) {
  const secret = getCookieHmacSecret();
  const invalidUsage = secret ? anonymousDemoLimit : 0;
  try {
    const raw = decodeURIComponent(value);
    const dot = raw.lastIndexOf(".");
    let payloadJson: string;
    if (secret && dot > 0) {
      const payload = raw.slice(0, dot);
      const signature = raw.slice(dot + 1);
      if (!verifyCookieSignature(payload, signature, secret)) return invalidUsage;
      payloadJson = payload;
    } else if (!secret) {
      // Legacy unsigned format; only accepted when no secret is configured.
      warnMissingSecretOnce();
      payloadJson = raw;
    } else {
      // Unsigned (or unparseable) cookie while a secret is configured:
      // fail closed. Enabling signing also retires existing unsigned cookies.
      return invalidUsage;
    }
    const parsed = JSON.parse(payloadJson) as Partial<AnonymousDemoUsage>;
    const used = Number(parsed.used);

    if (!Number.isFinite(used) || used < 0) return invalidUsage;

    return Math.min(Math.floor(used), anonymousDemoLimit);
  } catch {
    return invalidUsage;
  }
}
