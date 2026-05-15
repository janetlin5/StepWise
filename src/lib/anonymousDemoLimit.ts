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

export function encodeAnonymousDemoUsage(used: number) {
  return encodeURIComponent(JSON.stringify({ used }));
}

export function decodeAnonymousDemoUsage(value: string) {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<AnonymousDemoUsage>;
    const used = Number(parsed.used);

    if (!Number.isFinite(used) || used < 0) return 0;

    return Math.min(Math.floor(used), anonymousDemoLimit);
  } catch {
    return 0;
  }
}
