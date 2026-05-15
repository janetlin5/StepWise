import { redirect } from "next/navigation";

export default async function TutorSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  redirect(`/demo?sessionId=${encodeURIComponent(sessionId)}`);
}

