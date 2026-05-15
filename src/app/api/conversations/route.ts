import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  getAuthenticatedUser,
  getBearerToken,
} from "@/lib/usageLimits";

type UpdateConversationRequest = {
  sessionId?: string;
  status?: "active" | "completed" | "abandoned";
};

type ConversationSessionRow = {
  id: string;
  topic: string | null;
  subtopic: string | null;
  status: string | null;
  current_problem: string | null;
  pinned_problem?: string | null;
  uploaded_assets?: unknown;
  tutor_thread?: unknown;
  summary: string | null;
  metadata?: unknown;
  started_at: string;
  last_message_at?: string | null;
  updated_at: string;
  completed_at?: string | null;
};

type ConversationMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: unknown;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const accessToken = getBearerToken(request);
    const user = await getAuthenticatedUser(accessToken);

    if (!user) {
      return NextResponse.json(
        {
          message:
            "Sign in to save and revisit tutoring conversations.",
        },
        { status: 401 }
      );
    }

    const supabase = createSupabaseServerClient(accessToken);
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      const { data: session, error: sessionError } = await loadSession(
        supabase,
        user.id,
        sessionId
      );
      const { data: messages, error: messagesError } = await supabase
        .from("conversation_messages")
        .select("id, role, content, metadata, created_at")
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (sessionError) {
        console.error("Conversation load error:", sessionError);

        return NextResponse.json(
          {
            message:
              "I couldn’t load that conversation right now. Try again in a moment.",
          },
          { status: 500 }
        );
      }

      if (messagesError) {
        console.warn(
          "Conversation messages unavailable; loading session without saved turns:",
          messagesError
        );
      }

      if (!session) {
        return NextResponse.json(
          {
            message: "I couldn’t find that tutoring session.",
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        session,
        messages:
          messagesError || !(messages ?? []).length
            ? getFallbackMessages(session)
            : messages ?? [],
      });
    }

    const { data, error } = await loadSessionList(supabase, user.id);

    if (error) {
      console.error("Conversation list error:", error);

      return NextResponse.json(
        {
          message:
            "I couldn’t load conversation history right now. Try again in a moment.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversations: (data ?? []).map(normalizeSessionRow),
    });
  } catch (error) {
    console.error("Conversations API error:", error);

    return NextResponse.json(
      {
        message:
          "I couldn’t load conversation history right now. Try again in a moment.",
      },
      { status: 500 }
    );
  }
}

async function loadSession(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
  sessionId: string
) {
  const fullQuery = await supabase
    .from("learning_sessions")
    .select(
      "id, topic, subtopic, status, current_problem, pinned_problem, uploaded_assets, tutor_thread, summary, metadata, started_at, last_message_at, updated_at, completed_at"
    )
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!fullQuery.error) return fullQuery;

  console.warn("Conversation session full select failed, using fallback:", fullQuery.error);

  const fallbackQuery = await supabase
    .from("learning_sessions")
    .select(
      "id, topic, subtopic, status, current_problem, summary, metadata, started_at, updated_at"
    )
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    ...fallbackQuery,
    data: fallbackQuery.data
      ? normalizeSessionRow(fallbackQuery.data as ConversationSessionRow)
      : null,
  };
}

async function loadSessionList(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string
) {
  const fullQuery = await supabase
    .from("learning_sessions")
    .select(
      "id, topic, subtopic, status, current_problem, pinned_problem, summary, started_at, last_message_at, updated_at, completed_at"
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (!fullQuery.error) return fullQuery;

  console.warn("Conversation list full select failed, using fallback:", fullQuery.error);

  const fallbackQuery = await supabase
    .from("learning_sessions")
    .select("id, topic, subtopic, status, current_problem, summary, started_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  return {
    ...fallbackQuery,
    data: fallbackQuery.data
      ? fallbackQuery.data.map((row) => normalizeSessionRow(row as ConversationSessionRow))
      : null,
  };
}

function normalizeSessionRow(row: ConversationSessionRow): ConversationSessionRow {
  return {
    ...row,
    status: row.status ?? "active",
    pinned_problem: row.pinned_problem ?? row.current_problem ?? null,
    uploaded_assets: row.uploaded_assets ?? [],
    tutor_thread: row.tutor_thread ?? {},
    last_message_at: row.last_message_at ?? row.updated_at,
    completed_at: row.completed_at ?? null,
  };
}

function getFallbackMessages(session: ConversationSessionRow) {
  const tutorThread = toPlainObject(session.tutor_thread);
  const metadata = toPlainObject(session.metadata);
  const rawMessages =
    getMessageArray(tutorThread.messages) ||
    getMessageArray(metadata.recentMessages) ||
    [];
  const startedAt = Date.parse(session.started_at || session.updated_at || "");
  const baseTimestamp = Number.isFinite(startedAt) ? startedAt : Date.now();

  return rawMessages.map((message, index) => ({
    id: `fallback-${session.id}-${index}`,
    role: message.role,
    content: message.content,
    metadata: {
      source: "learning_sessions_fallback",
    },
    created_at: new Date(baseTimestamp + index).toISOString(),
  })) satisfies ConversationMessageRow[];
}

function getMessageArray(value: unknown) {
  if (!Array.isArray(value)) return null;

  const messages = value
    .filter(
      (message): message is { role: "user" | "assistant"; content: string } =>
        Boolean(message) &&
        typeof message === "object" &&
        ((message as { role?: unknown }).role === "user" ||
          (message as { role?: unknown }).role === "assistant") &&
        typeof (message as { content?: unknown }).content === "string" &&
        Boolean((message as { content: string }).content.trim())
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

  return messages.length ? messages : null;
}

function toPlainObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function PATCH(request: Request) {
  try {
    const accessToken = getBearerToken(request);
    const user = await getAuthenticatedUser(accessToken);

    if (!user) {
      return NextResponse.json(
        {
          message: "Sign in to update tutoring sessions.",
        },
        { status: 401 }
      );
    }

    const body = (await request.json()) as UpdateConversationRequest;
    const sessionId = body.sessionId?.trim();
    const status = body.status;

    if (!sessionId || !status) {
      return NextResponse.json(
        {
          message: "Choose a tutoring session to update.",
        },
        { status: 400 }
      );
    }

    if (!["active", "completed", "abandoned"].includes(status)) {
      return NextResponse.json(
        {
          message: "That session status is not supported.",
        },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient(accessToken);
    const now = new Date().toISOString();
    const [{ error: learningSessionError }, { error: sessionError }] =
      await Promise.all([
        supabase
          .from("learning_sessions")
          .update({
            status,
            ended_at: status === "active" ? null : now,
            completed_at: status === "completed" ? now : null,
            updated_at: now,
          })
          .eq("id", sessionId)
          .eq("user_id", user.id),
        supabase
          .from("sessions")
          .update({
            completion_status: status,
            updated_at: now,
          })
          .eq("id", sessionId)
          .eq("user_id", user.id),
      ]);

    if (learningSessionError || sessionError) {
      console.error(
        "Conversation status update error:",
        learningSessionError || sessionError
      );

      return NextResponse.json(
        {
          message:
            "I couldn’t update that session right now. Try again in a moment.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message:
        status === "completed"
          ? "Session marked complete."
          : "Session updated.",
    });
  } catch (error) {
    console.error("Conversation update API error:", error);

    return NextResponse.json(
      {
        message:
          "I couldn’t update that session right now. Try again in a moment.",
      },
      { status: 500 }
    );
  }
}
