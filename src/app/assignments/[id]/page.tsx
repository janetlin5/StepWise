"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { supabase } from "@/lib/supabaseClient";

type Assignment = {
  id: string;
  title: string;
  course: string | null;
  due_date: string | null;
};

type Problem = {
  id: string;
  user_id: string;
  assignment_id: string;
  question: string;
  attempt: string | null;
  created_at: string;
};

export default function AssignmentDetailPage() {
  const params = useParams<{ id: string }>();
  const assignmentId = params.id;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [question, setQuestion] = useState("");
  const [attempt, setAttempt] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    async function loadAssignmentWorkspace() {
      setIsLoading(true);
      setMessage("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setMessage("You must be logged in to view this assignment.");
        setIsLoading(false);
        return;
      }

      const { data: assignmentData, error: assignmentError } = await supabase
        .from("assignments")
        .select("id, title, course, due_date")
        .eq("id", assignmentId)
        .eq("user_id", user.id)
        .single();

      if (assignmentError || !assignmentData) {
        setMessage("Assignment not found.");
        setIsLoading(false);
        return;
      }

      const { data: problemData, error: problemError } = await supabase
        .from("assignment_problems")
        .select("id, user_id, assignment_id, question, attempt, created_at")
        .eq("assignment_id", assignmentId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (problemError) {
        setMessage(problemError.message);
      }

      setAssignment(assignmentData);
      setProblems(problemData ?? []);
      setIsLoading(false);
    }

    loadAssignmentWorkspace();
  }, [assignmentId]);

  async function addProblem() {
    setMessage("");

    const trimmedQuestion = question.trim();
    const trimmedAttempt = attempt.trim();
    const normalizedQuestion = normalizeProblemText(trimmedQuestion);

    if (!trimmedQuestion) {
      setMessage("Please enter a homework problem.");
      return;
    }

    if (
      problems.some(
        (problem) => normalizeProblemText(problem.question) === normalizedQuestion
      )
    ) {
      setMessage("That problem is already saved for this assignment.");
      return;
    }

    setIsAdding(true);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage("You must be logged in to add a problem.");
      setIsAdding(false);
      return;
    }

    const { data, error } = await supabase
      .from("assignment_problems")
      .insert({
        user_id: user.id,
        assignment_id: assignmentId,
        question: trimmedQuestion,
        attempt: trimmedAttempt || null,
      })
      .select("id, user_id, assignment_id, question, attempt, created_at")
      .single();

    if (error) {
      setMessage(
        error.code === "23505"
          ? "That problem is already saved. StepWise keeps assignment problems unique."
          : error.message
      );
      setIsAdding(false);
      return;
    }

    setProblems((currentProblems) => [...currentProblems, data]);
    setQuestion("");
    setAttempt("");
    setMessage("Problem added.");
    setIsAdding(false);
  }

  function normalizeProblemText(text: string) {
    return text.toLowerCase().trim().replace(/\s+/g, " ");
  }

  function formatDate(date: string | null) {
    if (!date) return "No due date";

    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00`));
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-8 py-6">
        <Link href="/dashboard" aria-label="StepWise dashboard">
          <BrandLogo className="text-2xl" />
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/assignments"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Assignments
          </Link>
          <Link
            href="/assignments/new"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            New Assignment
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-8 pb-12 pt-6">
        {isLoading ? (
          <div className="rounded-3xl border bg-white p-8 shadow-sm">
            <p className="text-slate-600">Loading assignment...</p>
          </div>
        ) : assignment ? (
          <>
            <div className="rounded-3xl bg-slate-900 p-8 text-white shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-200">
                    {assignment.course || "Study session"}
                  </p>
                  <h1 className="mt-2 text-4xl font-bold">
                    {assignment.title}
                  </h1>
                  <p className="mt-3 text-slate-300">
                    Add each homework problem here, save your first attempt, and
                    come back later for guided AI tutoring.
                  </p>
                </div>

                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-slate-100">
                  Due: {formatDate(assignment.due_date)}
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6">
                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <h2 className="text-2xl font-semibold text-slate-900">
                    Add a problem
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Paste the exact problem and optionally write what you have
                    tried so far.
                  </p>

                  <label className="mt-6 block text-sm font-medium text-slate-700">
                    Homework problem
                  </label>
                  <textarea
                    className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 p-4 text-slate-900 outline-none focus:border-slate-900"
                    placeholder="Example: Solve 3x + 5 = 17"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                  />

                  <label className="mt-5 block text-sm font-medium text-slate-700">
                    Your first attempt
                  </label>
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 p-4 text-slate-900 outline-none focus:border-slate-900"
                    placeholder="Type your first step, notes, or where you got stuck..."
                    value={attempt}
                    onChange={(event) => setAttempt(event.target.value)}
                  />

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      onClick={addProblem}
                      disabled={isAdding}
                      className="rounded-full bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {isAdding ? "Adding..." : "Add Problem"}
                    </button>

                    {message && (
                      <p className="text-sm text-slate-600">{message}</p>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-semibold text-slate-900">
                      Problems
                    </h2>
                    <p className="text-sm text-slate-500">
                      {problems.length} saved
                    </p>
                  </div>

                  {problems.length === 0 ? (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-6 text-center">
                      <p className="font-medium text-slate-900">
                        No problems added yet.
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Add the first problem above to start building this
                        assignment workspace.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-6 space-y-4">
                      {problems.map((problem, index) => (
                        <article
                          key={problem.id}
                          className="rounded-2xl border border-slate-200 p-5"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-blue-600">
                                Problem {index + 1}
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-slate-900">
                                {problem.question}
                              </p>
                            </div>
                          </div>

                          {problem.attempt && (
                            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                              <p className="text-sm font-medium text-slate-700">
                                Your attempt
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                                {problem.attempt}
                              </p>
                            </div>
                          )}

                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              disabled
                              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-400"
                            >
                              Get Hint Soon
                            </button>
                            <button
                              disabled
                              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-400"
                            >
                              Check Work Soon
                            </button>
                            <button
                              disabled
                              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-400"
                            >
                              Practice Similar Soon
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <aside className="space-y-6">
                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-semibold text-slate-900">
                    Tutor actions
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    These buttons are ready for the future AI layer. For now,
                    problems and attempts are saved so students can return to
                    their work.
                  </p>

                  <div className="mt-5 space-y-3">
                    <div className="rounded-2xl bg-blue-50 p-4 text-blue-900">
                      <p className="font-medium">Guided hints</p>
                      <p className="mt-1 text-sm">
                        Help students make the next move without giving away the
                        full answer.
                      </p>
                    </div>

                    <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">
                      <p className="font-medium">Step checking</p>
                      <p className="mt-1 text-sm">
                        Review attempts and explain the first place to improve.
                      </p>
                    </div>

                    <div className="rounded-2xl bg-violet-50 p-4 text-violet-900">
                      <p className="font-medium">Similar practice</p>
                      <p className="mt-1 text-sm">
                        Generate extra problems from the same skill area.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-semibold text-slate-900">
                    Progress
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {problems.length === 0
                      ? "Add problems to start tracking progress."
                      : `${problems.length} problem${
                          problems.length === 1 ? "" : "s"
                        } ready for tutoring.`}
                  </p>
                </div>
              </aside>
            </div>
          </>
        ) : (
          <div className="rounded-3xl border bg-white p-8 shadow-sm">
            <p className="text-slate-600">{message}</p>
            <Link
              href="/assignments"
              className="mt-5 inline-block rounded-full bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700"
            >
              Back to Assignments
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
