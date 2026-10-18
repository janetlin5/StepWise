import { ApiInputError, readJsonObject } from "@/lib/apiSecurity";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getBearerToken,
} from "@/lib/usageLimits";
import {
  isAllowedRequestOrigin,
  MAX_FEEDBACK_MESSAGE_CHARS,
  truncateJsonValue,
} from "@/lib/apiSecurity";

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
    // Feedback is anonymous and writes to the database, so it gets the same
    // same-origin check as the other state-changing routes, plus a size cap:
    // an uncapped message/context could otherwise bloat the table per request.
    if (!isAllowedRequestOrigin(request)) {
      return NextResponse.json(
        {
          message:
            "This request did not come from StepWise. Open StepWise and try again.",
        },
        { status: 403 }
      );
    }

    const body = (await readJsonObject(request, 32000, ["message", "category", "pageUrl"])) as FeedbackRequest;
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

    if (message.length > MAX_FEEDBACK_MESSAGE_CHARS) {
      return NextResponse.json(
        {
          message:
            "That feedback is too long — a couple of sentences is plenty.",
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
      // Diagnostic blobs are client-controlled: deep-truncate them so one
      // request cannot store an unbounded JSON payload.
      context: truncateJsonValue(body.context ?? {}),
      browser: truncateJsonValue(body.browser ?? {}),
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
    if (error instanceof ApiInputError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
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
