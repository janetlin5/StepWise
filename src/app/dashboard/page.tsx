"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import BrandLogo from "@/components/BrandLogo";
import HelpFeedbackButton from "@/components/HelpFeedbackButton";
import { supabase } from "@/lib/supabaseClient";
import {
  createDefaultLearningProfile,
  loadLearningProfile,
} from "@/lib/learningProfile";
import type { LearningProfile } from "@/lib/learningProfile";

type ActiveLearningSession = {
  id: string;
  topic: string | null;
  subtopic: string | null;
  status: string;
  current_problem: string | null;
  pinned_problem: string | null;
  summary: string | null;
  started_at: string;
  last_message_at: string | null;
  updated_at: string;
};

export default function DashboardPage() {
  const [learningProfile, setLearningProfile] = useState<LearningProfile>(
    createDefaultLearningProfile
  );
  const [activeSession, setActiveSession] =
    useState<ActiveLearningSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    setLearningProfile(loadLearningProfile());

    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      const userId = sessionData.session?.user.id;

      if (!userId) {
        setSessionLoaded(true);
        return;
      }

      const [{ data: profileRow }, { data: activeSessionRow }] = await Promise.all([
        supabase
          .from("learning_profiles")
          .select("profile")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("learning_sessions")
          .select(
            "id, topic, subtopic, status, current_problem, pinned_problem, summary, started_at, last_message_at, updated_at"
          )
          .eq("user_id", userId)
          .eq("status", "active")
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (profileRow?.profile) {
        setLearningProfile({
          ...createDefaultLearningProfile(),
          ...(profileRow.profile as Partial<LearningProfile>),
        });
      }

      setActiveSession((activeSessionRow as ActiveLearningSession | null) ?? null);
      setSessionLoaded(true);
    });
  }, []);

  const recentProblem = learningProfile.problemHistory[0];
  const usageCount =
    learningProfile.problemHistory.length +
    learningProfile.completedProblems +
    learningProfile.tutoringStateHistory.length;
  const personalizationPhase =
    usageCount >= 5 || learningProfile.completedProblems >= 2
      ? "established"
      : usageCount >= 1
        ? "early"
        : "new";
  const activeProblemText =
    activeSession?.pinned_problem || activeSession?.current_problem || "";
  const primaryTopic =
    activeSession?.subtopic ||
    activeSession?.topic ||
    recentProblem?.subtopic ||
    learningProfile.recentConcepts[0] ||
    learningProfile.currentSubject;
  const hasActiveSession = Boolean(activeSession);
  const hasLearningMemory = personalizationPhase !== "new";
  const headline = !sessionLoaded
    ? "Welcome back."
    : hasActiveSession
    ? `Ready to continue ${primaryTopic.toLowerCase()}?`
    : hasLearningMemory
    ? `Ready to continue ${primaryTopic.toLowerCase()}?`
    : "What would you like to practice today?";
  const primaryCtaLabel = !sessionLoaded
    ? "Loading..."
    : hasActiveSession
    ? "Continue Learning"
    : "Start Learning";
  const primaryCtaHref = activeSession
    ? `/tutor/session/${activeSession.id}`
    : "/demo";
  const supportingCopy = hasActiveSession
    ? "Pick up the tutoring thread where you left off."
    : hasLearningMemory
    ? "Start a fresh problem or review a recent topic."
    : "Upload a worksheet, paste a problem, or choose a practice topic.";
  const recommendedNext = buildRecommendation(
    learningProfile,
    personalizationPhase
  );
  const strengths = buildStrengths(learningProfile, personalizationPhase);
  const visibleStrengths = strengths.slice(0, 2);
  const recentLearningItems = learningProfile.problemHistory.slice(0, 2);
  const lastActiveLabel = activeSession
    ? formatRelativeTime(activeSession.last_message_at || activeSession.updated_at)
    : recentProblem
    ? formatRelativeTime(recentProblem.lastPracticedAt)
    : "Ready when you are";

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-950">
      <nav className="bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <Link href="/" aria-label="StepWise home">
            <BrandLogo className="text-xl" />
          </Link>

          <AccountMenu />
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-5 py-7 sm:px-8 lg:py-10">
        <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-[2rem] bg-white p-6 shadow-sm shadow-slate-200/70 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-normal text-slate-950 sm:text-5xl">
                  {headline}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                  {supportingCopy}
                </p>
              </div>

              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                <Link
                  href={primaryCtaHref}
                  className="rounded-full bg-cyan-500 px-6 py-3 text-center text-sm font-semibold text-white shadow-sm shadow-cyan-100 transition hover:-translate-y-0.5 hover:bg-cyan-600"
                >
                  {primaryCtaLabel}
                </Link>
                {hasActiveSession && (
                  <Link
                    href="/demo"
                    className="rounded-full bg-slate-50 px-6 py-3 text-center text-sm font-semibold text-slate-600 transition hover:-translate-y-0.5 hover:bg-slate-100"
                  >
                    New Problem
                  </Link>
                )}
              </div>
            </div>

            <div className="mt-7 rounded-[1.5rem] bg-slate-50/80 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    {hasActiveSession ? "Resume session" : "Ready to begin"}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {hasActiveSession
                      ? [activeSession?.topic, activeSession?.subtopic]
                          .filter(Boolean)
                          .join(" • ") || "Active tutoring session"
                      : recentProblem
                      ? `${recentProblem.topic} • ${recentProblem.subtopic}`
                      : "Your tutor is ready whenever you are"}
                  </p>
                </div>
                <span className="w-fit rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
                  {lastActiveLabel}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">
                {activeProblemText ||
                  recentProblem?.extractedText ||
                  "Your first session will start building learning history."}
              </p>
            </div>
          </section>

          <Link
            href="/demo"
            className="group flex flex-col rounded-[2rem] bg-white/75 p-5 shadow-sm shadow-slate-200/60 transition hover:-translate-y-1 hover:bg-white hover:shadow-lg hover:shadow-slate-200/80 sm:p-6"
          >
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">
              Upload homework.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Drop in a worksheet or screenshot and start with the exact problem
              in front of you.
            </p>
            <div className="mt-5 flex flex-1 items-end">
              <div className="w-full rounded-[1.35rem] border border-dashed border-cyan-200 bg-cyan-50/50 p-4 transition group-hover:border-cyan-300 group-hover:bg-cyan-50">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-lg shadow-sm">
                    +
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-cyan-900">
                      Add a worksheet
                    </p>
                    <p className="mt-0.5 text-xs text-cyan-700">
                      Screenshot, photo, or PDF
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.72fr]">
          <Link
            href="/demo"
            className="group rounded-[2rem] bg-white/85 p-5 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:shadow-slate-200/70 sm:p-6"
          >
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">
              {recommendedNext.title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {recommendedNext.description}
            </p>
          </Link>

          <section className="rounded-[2rem] bg-white/60 p-5 sm:p-6">
            <h2 className="text-base font-bold text-slate-950">
              {personalizationPhase === "established"
                ? "Progress notes"
                : personalizationPhase === "early"
                  ? "Recent topics"
                  : "Your tutor will learn with you"}
            </h2>
            {personalizationPhase !== "new" && (
              <div className="mt-4 flex flex-wrap gap-2">
                {visibleStrengths.map((strength) => (
                  <span
                    key={strength}
                    className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                  >
                    {strength}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-4 text-sm leading-6 text-slate-500">
              {personalizationPhase === "new"
                ? "As you practice, StepWise will begin noticing what support helps."
                : personalizationPhase === "early"
                  ? "Keep going. Patterns will become clearer after a few sessions."
                  : learningProfile.lastReflection ||
                    "As you work, StepWise will surface small progress notes here."}
            </p>
          </section>
        </div>

        <div
          className={`mt-5 grid gap-5 ${
            hasLearningMemory ? "lg:grid-cols-[0.72fr_1fr]" : ""
          }`}
        >
          {hasLearningMemory && (
            <section className="rounded-[2rem] bg-white/55 p-5 sm:p-6">
              <h2 className="text-base font-bold text-slate-950">
                Learning rhythm
              </h2>
              <div className="mt-4 grid gap-3">
                <LearningMetric
                  label="Pacing"
                  value={learningProfile.pacingPreference}
                />
                <LearningMetric
                  label="Independence"
                  value={learningProfile.independenceLevel.replace("_", " ")}
                />
              </div>
            </section>
          )}

          <section className="rounded-[2rem] bg-white/55 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-950">
                  {recentProblem
                    ? "Recent work"
                    : "Start whenever you’re ready"}
                </h2>
              </div>
              <Link
                href="/assignments"
                className="rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                Saved work
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {recentLearningItems.length ? (
                recentLearningItems.map((problem) => (
                  <div
                    key={problem.id}
                    className="rounded-[1.35rem] bg-slate-50 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {problem.problemType}
                      </p>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        {problem.completionStatus.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {problem.topic} to {problem.subtopic}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[1.35rem] bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Start with a worksheet whenever you’re ready.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Your next tutoring session will appear here.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
      <HelpFeedbackButton
        showLauncher={false}
        context={{
          page: "dashboard",
          phase: personalizationPhase,
          recentProblem: recentProblem?.extractedText,
          currentSubject: learningProfile.currentSubject,
        }}
      />
    </main>
  );
}

function LearningMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] bg-white/70 px-4 py-3 shadow-sm shadow-slate-200/50">
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize text-slate-900">
        {value}
      </p>
    </div>
  );
}

function buildRecommendation(
  profile: LearningProfile,
  phase: "new" | "early" | "established"
) {
  const reviewSkill =
    profile.spacedReviewQueue[0] ||
    profile.conceptsNeedingReinforcement[0] ||
    profile.formulaConfusions[0];
  const recentProblem = profile.problemHistory[0];

  if (phase === "new") {
    return {
      title: "Start with a real homework problem",
      description: "Upload a worksheet or paste a question to begin.",
    };
  }

  if (phase === "established" && reviewSkill) {
    return {
      title: `Review ${reviewSkill.toLowerCase()} in one guided problem`,
      description: "A focused warm-up based on recent work.",
    };
  }

  if (recentProblem) {
    return {
      title: `Continue ${recentProblem.subtopic.toLowerCase()}`,
      description:
        phase === "early"
          ? "Keep going from your recent session."
          : "Pick up with a guided next step.",
    };
  }

  return {
    title: "Start with a real homework problem",
    description: "Upload a worksheet or paste a question to begin.",
  };
}

function buildStrengths(
  profile: LearningProfile,
  phase: "new" | "early" | "established"
) {
  if (phase === "new") {
    return [
      "Insights will appear here",
      "Progress builds as you practice",
      "Your tutor learns what support helps",
    ];
  }

  if (phase === "early") {
    return profile.recentConcepts.length
      ? profile.recentConcepts.slice(0, 2)
      : ["Recent topics will appear here"];
  }

  const strengths = [
    ...profile.strongSkills,
    ...profile.skillMastery
      .filter((skill) => skill.level === "steady" || skill.level === "strong")
      .map((skill) => skill.skill),
    ...profile.recentConcepts.slice(0, 2),
  ];
  const uniqueStrengths = Array.from(new Set(strengths.filter(Boolean))).slice(
    0,
    4
  );

  return uniqueStrengths.length
    ? uniqueStrengths
    : ["Problem setup", "Step-by-step reasoning", "Asking for help early"];
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();

  if (Number.isNaN(diffMs)) return "Recently active";

  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.round(diffHours / 24);

  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}
