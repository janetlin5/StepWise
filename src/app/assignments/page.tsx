"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Assignment = {
  id: string;
  title: string;
  course: string | null;
};

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    async function loadAssignments() {
      const { data } = await supabase
        .from("assignments")
        .select("id, title, course");

      if (data) {
        setAssignments(data);
      }
    }

    loadAssignments();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Back to dashboard
            </Link>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">
              Assignments
            </h1>
          </div>

          <Link
            href="/assignments/new"
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            New Assignment
          </Link>
        </div>

        {assignments.length === 0 ? (
          <div className="rounded-3xl border bg-white p-8 text-center shadow-sm">
            <p className="font-medium text-slate-900">No assignments yet.</p>
            <p className="mt-2 text-sm text-slate-600">
              Create your first assignment to start adding homework problems.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {assignments.map((assignment) => (
              <Link
                key={assignment.id}
                href={`/assignments/${assignment.id}`}
                className="rounded-3xl border bg-white p-6 shadow-sm hover:shadow-md"
              >
                <h2 className="text-xl font-semibold text-slate-900">
                  {assignment.title}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {assignment.course || "Study session"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
