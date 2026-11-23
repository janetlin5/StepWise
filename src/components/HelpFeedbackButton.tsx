"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeResponseReport } from "@/lib/responseFeedback";
import type { ResponseReport } from "@/lib/responseFeedback";
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

  const [selectedReport, setSelectedReport] = useState<ResponseReport | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const sending = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const reportKey = useRef("");
  function openFeedback(report: ResponseReport | null = null) {
    if (sending.current) return;
    opener.current = document.activeElement as HTMLElement;
    const key = report ? `${report.sessionId}:${report.messageId}` : "";
    if (key !== reportKey.current) setMessage("");
    reportKey.current = key;
    setSelectedReport(report);
    setCategory("Tutor response issue");
    setStatus("idle");
    setIsOpen(true);
  }
  function closeFeedback() {
    if (sending.current) return;
    setIsOpen(false);
    opener.current?.focus();
  }

  useEffect(() => {
    function handleOpenFeedback(event: Event) {
      openFeedback(sanitizeResponseReport((event as CustomEvent).detail));
    }

    window.addEventListener("stepwise:open-feedback", handleOpenFeedback);

    return () => {
      window.removeEventListener("stepwise:open-feedback", handleOpenFeedback);
    };
  }, []);

  async function handleSubmit() {
    if (sending.current || status === "sent") return;
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setErrorMessage("Add a quick note about what happened.");
      setStatus("error");
      return;
    }

    sending.current = true;
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
          pageUrl: window.location.origin + window.location.pathname,
          context: selectedReport ?? context,
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
      setErrorMessage("Your feedback wasn’t sent. Your note is saved here; please try again.");
      setStatus("error");
    } finally {
      sending.current = false;
    }
  }

  return (
    <>
      {showLauncher && (
        <div className={`fixed z-40 flex flex-col items-end gap-2 ${className}`}>
          {showNudge && !isOpen && (
            <button
              type="button"
              onClick={() => openFeedback()}
              className="max-w-[15rem] rounded-2xl bg-white px-3.5 py-2 text-left text-xs leading-5 text-slate-600 shadow-lg shadow-slate-200/80 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:text-slate-900"
            >
              Still having trouble? Send feedback.
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              openFeedback();
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
          onClick={closeFeedback}
        >
          <div
            role="dialog" aria-modal="true" aria-label="Send feedback"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeFeedback();
              if (event.key === "Tab") {
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select, textarea"));
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}
            className="max-h-[90dvh] overflow-y-auto w-full max-w-md rounded-[1.75rem] bg-white p-5 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-slate-950">
                  Found something confusing?
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Tell us what felt off. Nothing is sent until you select Send Feedback.
                </p>
              </div>

              <button
                type="button"
                onClick={closeFeedback}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            {selectedReport && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
              <p className="font-semibold">Selected tutor response</p>
              <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap">{selectedReport.response}</p>
              <p className="mt-2 text-slate-500">{selectedReport.problem ? "Includes this response’s problem and preceding student message." : "Includes the preceding student message. The original problem was not saved for this response."}</p>
            </div>}
            <div className="mt-5">
              <label className="text-xs font-semibold uppercase text-slate-400">
                What is this about?
              </label>
              <select aria-label="Feedback category" disabled={status === "sending"}
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
              <textarea autoFocus disabled={status === "sending"}
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
              {selectedReport ? "Only the selected exchange, problem when available, and basic browser information are included. Attachments and unrelated chat history are excluded." : "Includes recent session context and basic browser information when available."}
            </div>

            {status === "sent" && (
              <p className="mt-3 rounded-2xl bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-800">
                Thanks. This helps make StepWise better.
              </p>
            )}

            {status === "error" && (
              <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                {errorMessage}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={status === "sending" || status === "sent"}
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
