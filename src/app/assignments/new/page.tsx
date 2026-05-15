"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function NewAssignmentPage() {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");

  async function createAssignment() {
    setMessage("");

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setMessage("Please enter an assignment title.");
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage("You must be logged in.");
      return;
    }

    const { error } = await supabase.from("assignments").insert({
      user_id: user.id,
      title: trimmedTitle,
      course: "Algebra 1",
      due_date: dueDate || null,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Assignment created successfully.");
    setTitle("");
    setDueDate("");
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">New Assignment</h1>

        <Link href="/assignments" className="rounded border px-4 py-2">
          Back to Assignments
        </Link>
      </div>

      <div className="max-w-md space-y-4">
        <input
          className="w-full rounded border p-3"
          placeholder="Assignment title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <input
          className="w-full rounded border p-3"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />

        <button
          onClick={createAssignment}
          className="rounded bg-black px-4 py-3 text-white"
        >
          Create Assignment
        </button>

        {message && <p>{message}</p>}
      </div>
    </main>
  );
}