import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export type UsageEventType =
  | "ai_message"
  | "upload_analysis"
  | "practice_generation";

type UserPlan = "free" | "pro";

type UsageLimit = {
  limit: number | null;
  window: "day" | "month";
};

type UsageCheckResult = {
  allowed: boolean;
  plan: UserPlan;
  used: number;
  limit: number | null;
  resetAt: string;
  message?: string;
};

const freeLimits: Record<UsageEventType, UsageLimit> = {
  ai_message: { limit: 20, window: "day" },
  upload_analysis: { limit: 5, window: "day" },
  practice_generation: { limit: 10, window: "month" },
};

const proLimits: Record<UsageEventType, UsageLimit> = {
  ai_message: { limit: null, window: "day" },
  upload_analysis: { limit: null, window: "day" },
  practice_generation: { limit: null, window: "month" },
};

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization");

  if (!header?.toLowerCase().startsWith("bearer ")) return null;

  return header.slice("bearer ".length).trim();
}

export async function getAuthenticatedUser(accessToken: string | null) {
  if (!accessToken) return null;

  const supabase = createSupabaseServerClient(accessToken);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || !user) return null;

  return user;
}

export async function checkUsageLimit({
  userId,
  eventType,
  accessToken,
}: {
  userId: string;
  eventType: UsageEventType;
  accessToken: string | null;
}): Promise<UsageCheckResult> {
  const supabase = createSupabaseServerClient(accessToken);
  const plan = await getUserPlan(userId, accessToken);
  const limitConfig = plan === "pro" ? proLimits[eventType] : freeLimits[eventType];
  const windowStart = getWindowStart(limitConfig.window);
  const resetAt = getResetAt(limitConfig.window);

  if (limitConfig.limit === null) {
    return {
      allowed: true,
      plan,
      used: 0,
      limit: null,
      resetAt,
    };
  }

  const { count, error } = await supabase
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .gte("created_at", windowStart);

  if (error) {
    console.error("Usage limit check error:", error);

    return {
      allowed: false,
      plan,
      used: 0,
      limit: limitConfig.limit,
      resetAt,
      message:
        "I couldn’t check your free tutoring limit right now. Please try again in a moment.",
    };
  }

  const used = count ?? 0;
  const allowed = used < limitConfig.limit;

  return {
    allowed,
    plan,
    used,
    limit: limitConfig.limit,
    resetAt,
    message: allowed
      ? undefined
      : getLimitMessage(eventType, limitConfig.window),
  };
}

export async function recordUsageEvent({
  userId,
  eventType,
  accessToken,
}: {
  userId: string;
  eventType: UsageEventType;
  accessToken: string | null;
}) {
  const supabase = createSupabaseServerClient(accessToken);
  const { error } = await supabase.from("usage_events").insert({
    user_id: userId,
    event_type: eventType,
  });

  if (error) {
    console.error("Usage event insert error:", error);
  }
}

export function createSupabaseServerClient(accessToken: string | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseKey = serviceRoleKey || anonKey;
  const shouldUseUserTokenForRls = Boolean(accessToken && !serviceRoleKey);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: shouldUseUserTokenForRls
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

async function getUserPlan(userId: string, accessToken: string | null): Promise<UserPlan> {
  const supabase = createSupabaseServerClient(accessToken);
  const profile = await getProfileByColumn(supabase, "id", userId);
  const fallbackProfile = profile ?? (await getProfileByColumn(supabase, "user_id", userId));
  const plan = fallbackProfile?.plan;
  const subscriptionStatus = fallbackProfile?.subscription_status;

  if (plan === "pro" && subscriptionStatus === "active") {
    return "pro";
  }

  return "free";
}

async function getProfileByColumn(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  column: "id" | "user_id",
  userId: User["id"]
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("plan, subscription_status")
    .eq(column, userId)
    .maybeSingle();

  if (error) return null;

  return data as { plan?: string; subscription_status?: string } | null;
}

function getWindowStart(window: UsageLimit["window"]) {
  const now = new Date();

  if (window === "month") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)
    ).toISOString();
  }

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  ).toISOString();
}

function getResetAt(window: UsageLimit["window"]) {
  const now = new Date();

  if (window === "month") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)
    ).toISOString();
  }

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  ).toISOString();
}

function getLimitMessage(eventType: UsageEventType, window: UsageLimit["window"]) {
  const period = window === "month" ? "monthly" : "daily";

  if (eventType === "upload_analysis") {
    return `You've reached your free ${period} homework upload limit. Come back later or create an account to keep learning.`;
  }

  if (eventType === "practice_generation") {
    return `You've reached your free ${period} practice limit. Come back later or create an account to keep learning.`;
  }

  return `You've reached your free ${period} tutoring limit. Come back later or create an account to keep learning.`;
}
