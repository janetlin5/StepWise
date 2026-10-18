import type { createSupabaseServerClient } from "@/lib/usageLimits";
import { ApiInputError } from "@/lib/apiSecurity";

type Client = ReturnType<typeof createSupabaseServerClient>;
type SessionTable = "learning_sessions" | "sessions";
const tables: SessionTable[] = ["learning_sessions", "sessions"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function owner(client: Client, table: SessionTable, id: string) {
  const { data, error } = await client.from(table).select("user_id").eq("id", id).maybeSingle();
  if (error) throw new ApiInputError("Unable to verify this session. Please try again.", 503);
  return data as { user_id: string } | null;
}

/** Reserve both rows without ever updating an existing owner, including races.
 * A hidden row under RLS is not proof that an ID is available: verify again
 * after INSERT ON CONFLICT DO NOTHING. Any failure stops the request.
 */
export async function authorizeSession(client: Client, provided: string | undefined, userId: string) {
  if (provided && !uuid.test(provided)) throw new ApiInputError("Invalid session ID.");
  const id = provided?.toLowerCase() || crypto.randomUUID();
  const rows = await Promise.all(tables.map((table) => owner(client, table, id)));
  if (rows.some((row) => row && row.user_id !== userId)) {
    throw new ApiInputError("This session is not available to your account. Start a new chat.", 403);
  }
  for (let i = 0; i < tables.length; i++) {
    if (rows[i]) continue;
    const { error } = await client.from(tables[i]).upsert(
      { id, user_id: userId },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (error) throw new ApiInputError("Unable to start this session. Please try again.", 503);
  }
  const reserved = await Promise.all(tables.map((table) => owner(client, table, id)));
  if (reserved.some((row) => !row || row.user_id !== userId)) {
    throw new ApiInputError("This session is not available to your account. Start a new chat.", 403);
  }
  return id;
}

/** Ownership is part of the write predicate, not just a prior lookup. */
export async function updateOwnedSession(
  client: Client, table: SessionTable, id: string, userId: string,
  values: Record<string, unknown>
) {
  if (!uuid.test(id)) throw new ApiInputError("Invalid session ID.");
  const safeValues = { ...values };
  delete safeValues.id;
  delete safeValues.user_id;
  const { data, error } = await client.from(table).update(safeValues)
    .eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw new ApiInputError("Unable to save this session. Please try again.", 503);
  if (!data) throw new ApiInputError("This session is no longer available to your account.", 403);
}
