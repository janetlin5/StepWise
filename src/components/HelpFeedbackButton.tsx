"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type FeedbackCategory =
  | "Tutor response issue"
  | "Screenshot problem"
  | "Bug"
  | "Suggestion"
  | "Question"
  | "Other";

type HelpFeedbackButtonProps = {
  context?: Record<string, unknown>;
  className?: string;
  showNudge?: boolean;
  showLauncher?: boolean;
};

const feedbackCategories: FeedbackCategory[] = [
  "Tutor response issue",
  "Screenshot problem",
  "Bug",
  "Suggestion",
  "Question",
  "Other",
];

export default function HelpFeedbackButton({
  context = {},
  className = "bottom-5 right-5",
  showNudge = false,
  showLauncher = true,
}: HelpFeedbackButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] =
    useState<FeedbackCategory>("Tutor response issue");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  useEffect(() => {
    function handleOpenFeedback() {
      setIsOpen(true);
      setStatus("idle");
    }

    window.addEventListener("stepwise:open-feedback", handleOpenFeedback);

    return () => {
      window.removeEventListener("stepwise:open-feedback", handleOpenFeedback);
    };
  }, []);

  async function handleSubmit() {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setStatus("error");
      return;
    }

    setStatus("sending");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          category,
          message: trimmedMessage,
          pageUrl: window.location.href,
          context,
          browser: {
            userAgent: window.navigator.userAgent,
            language: window.navigator.language,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Feedback failed");
      }

      setStatus("sent");
      setMessage("");
    } catch {
      setStatus("error");
    }
  }

  return (
    <>
      {showLauncher && (
        <div className={`fixed z-40 flex flex-col items-end gap-2 ${className}`}>
          {showNudge && !isOpen && (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="max-w-[15rem] rounded-2xl bg-white px-3.5 py-2 text-left text-xs leading-5 text-slate-600 shadow-lg shadow-slate-200/80 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:text-slate-900"
            >
              Still having trouble? Send feedback.
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setIsOpen(true);
              setStatus("idle");
            }}
            aria-label="Open help and feedback"
            className="flex h-12 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white shadow-lg shadow-slate-300/80 transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-cyan-100"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-slate-950">
              ?
            </span>
            Help
          </button>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/25 px-4 py-4 backdrop-blur-sm sm:items-center"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[1.75rem] bg-white p-5 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-slate-950">
                  Found something confusing?
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Tell us what felt off. StepWise quietly includes recent
                  session context so the team can understand what happened.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-5">
              <label className="text-xs font-semibold uppercase text-slate-400">
                What is this about?
              </label>
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as FeedbackCategory)
                }
                className="mt-2 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-50"
              >
                {feedbackCategories.map((feedbackCategory) => (
                  <option key={feedbackCategory}>{feedbackCategory}</option>
                ))}
              </select>
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase text-slate-400">
                What happened?
              </span>
              <textarea
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (status === "error") setStatus("idle");
                }}
                rows={5}
                placeholder="The tutor got confused here, the screenshot was read wrong, or I have an idea..."
                className="mt-2 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-50"
              />
            </label>

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              We include recent messages, the current problem, and basic browser
              info when available. No extra setup needed.
            </div>

            {status === "sent" && (
              <p className="mt-3 rounded-2xl bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-800">
                Thanks. This helps make StepWise better.
              </p>
            )}

            {status === "error" && (
              <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                Add a quick note, then try sending again.
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={status === "sending"}
              className="mt-4 min-h-11 w-full rounded-full bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-cyan-100 transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {status === "sending" ? "Sending..." : "Send Feedback"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
