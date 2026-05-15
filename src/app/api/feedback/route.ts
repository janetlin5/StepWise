import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBearerToken,
} from "@/lib/usageLimits";

type FeedbackRequest = {
  category?: string;
  message?: string;
  pageUrl?: string;
  context?: Record<string, unknown>;
  browser?: Record<string, unknown>;
};

const allowedCategories = new Set([
  "Tutor response issue",
  "Screenshot problem",
  "Bug",
  "Suggestion",
  "Question",
  "Other",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackRequest;
    const message = body.message?.trim() ?? "";
    const category = allowedCategories.has(body.category ?? "")
      ? body.category
      : "Other";

    if (!message) {
      return NextResponse.json(
        {
          message:
            "Add a quick note about what happened, then try sending feedback again.",
        },
        { status: 400 }
      );
    }

    const accessToken = getBearerToken(request);
    const user = await getAuthenticatedUser(accessToken);
    const supabase = createFeedbackClient(accessToken);
    const { error } = await supabase.from("feedback_events").insert({
      user_id: user?.id ?? null,
      category,
      message,
      page_url: body.pageUrl?.slice(0, 500) ?? "",
      context: body.context ?? {},
      browser: body.browser ?? {},
    });

    if (error) {
      console.error("Feedback insert error:", error);

      return NextResponse.json(
        {
          message:
            "I couldn’t send that feedback right now. Please try again in a moment.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Thanks. This helps make StepWise better.",
    });
  } catch (error) {
    console.error("Feedback API error:", error);

    return NextResponse.json(
      {
        message:
          "I couldn’t send that feedback right now. Please try again in a moment.",
      },
      { status: 500 }
    );
  }
}

function createFeedbackClient(accessToken: string | null) {
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
