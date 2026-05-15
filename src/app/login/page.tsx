"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import BrandLogo from "@/components/BrandLogo";
import { loadLearningProfile } from "@/lib/learningProfile";
import { supabase } from "@/lib/supabaseClient";

type AuthMode = "signup" | "login";
type SocialProvider = "google" | "discord";

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(
    null
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("error") || params.get("error_description");

    if (authError) {
      setMessage("Your sign-in session expired. Try logging in again.");
      return;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;

      if (user && shouldContinueToDashboard()) {
        try {
          await initializeAccountMemory(user);
          window.location.href = "/dashboard";
        } catch {
          setMessage(
            "You’re signed in, but I couldn’t sync your learning memory right now. Try opening the dashboard again in a moment."
          );
        }
      }
    });
  }, []);

  async function handleSocialSignIn(provider: SocialProvider) {
    setMessage("");
    setLoadingProvider(provider);

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/login?next=/dashboard`
        : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });

    if (error) {
      setMessage(getFriendlyAuthMessage("oauth"));
      setLoadingProvider(null);
      return;
    }

    setMessage(`Opening ${provider === "google" ? "Google" : "Discord"}...`);
    window.setTimeout(() => setLoadingProvider(null), 4000);
  }

  async function handleSubmit() {
    setMessage("");

    if (!email || !password) {
      setMessage("Please enter your email and password.");
      return;
    }

    setIsLoading(true);

    if (mode === "signup") {
      let memoryWarning = "";
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setMessage(getFriendlyAuthMessage("signup"));
        setIsLoading(false);
        return;
      }

      if (data.user) {
        try {
          await initializeAccountMemory(data.user);
        } catch {
          memoryWarning =
            "Your account was created, but I couldn’t save the learning memory yet. You can still continue and StepWise will try again later.";
        }
      }

      setMessage(
        memoryWarning ||
          (data.session
            ? "Account created. Taking you to your workspace..."
            : "Account created. Check your email to confirm your account.")
      );

      if (data.session) {
        window.location.href = "/dashboard";
      }

      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(getFriendlyAuthMessage("login"));
      setIsLoading(false);
      return;
    }

    if (data.user) {
      try {
        await initializeAccountMemory(data.user);
      } catch {
        setMessage(
          "You’re signed in, but I couldn’t sync your learning memory right now. Please try opening the dashboard again in a moment."
        );
        setIsLoading(false);
        return;
      }
    }

    window.location.href = "/dashboard";
  }

  return (
    <main className="min-h-screen bg-[#f7fafc] text-slate-900">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label="StepWise home">
          <BrandLogo className="text-2xl" />
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/demo"
            className="hidden text-sm font-medium text-slate-500 hover:text-slate-900 sm:inline"
          >
            Try demo first
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            Back home
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-14 pt-8 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:pb-20 lg:pt-14">
        <div className="max-w-xl">
          <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase text-cyan-700 ring-1 ring-cyan-100">
            Personalized learning memory
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
            Keep your tutor learning with you.
          </h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Create a free account to save tutoring progress, preserve your
            learning memory, and continue where you left off.
          </p>

          <div className="mt-7 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
            {[
              "Save your tutoring progress",
              "Keep personalized learning memory",
              "Track concepts improving over time",
              "Continue sessions across devices",
            ].map((benefit) => (
              <div
                key={benefit}
                className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
              >
                {benefit}
              </div>
            ))}
          </div>

          <div className="mt-7 rounded-3xl bg-white/80 p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-900">
              Not ready to create an account?
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              You can explore the tutoring demo first. StepWise only asks you to
              sign up when saving progress becomes useful.
            </p>
            <Link
              href="/demo"
              className="mt-3 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Try Free Demo
            </Link>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md rounded-[2rem] bg-white p-5 shadow-xl shadow-slate-200/70 ring-1 ring-slate-200 sm:p-7">
          <div>
            <p className="text-sm font-semibold text-cyan-700">
              {mode === "signup" ? "Create your free account" : "Welcome back"}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
              {mode === "signup" ? "Start saving progress" : "Sign in"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {mode === "signup"
                ? "Use Google, Discord, or email to keep your tutor memory synced."
                : "Continue your tutoring sessions and learning memory."}
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => handleSocialSignIn("google")}
              disabled={isLoading || loadingProvider !== null}
              className="flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-950">
                G
              </span>
              {loadingProvider === "google"
                ? "Opening Google..."
                : "Continue with Google"}
            </button>

            <button
              type="button"
              onClick={() => handleSocialSignIn("discord")}
              disabled={isLoading || loadingProvider !== null}
              className="flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5865F2] text-xs font-bold text-white">
                D
              </span>
              {loadingProvider === "discord"
                ? "Opening Discord..."
                : "Continue with Discord"}
            </button>
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase text-slate-400">
              or
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Email address
              </span>
              <input
                className="mt-1.5 min-h-12 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-50"
                placeholder="you@example.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Password
              </span>
              <input
                className="mt-1.5 min-h-12 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-50"
                placeholder="Create a secure password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="min-h-12 w-full rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-cyan-100 transition hover:-translate-y-0.5 hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {isLoading
                ? "One moment..."
                : mode === "signup"
                  ? "Create Free Account"
                  : "Sign In"}
            </button>
          </div>

          {message && (
            <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              {message}
            </p>
          )}

          <div className="mt-6 text-center text-sm text-slate-600">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => {
                    setMode("login");
                    setMessage("");
                  }}
                  className="font-semibold text-cyan-700 hover:text-cyan-800"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to StepWise?{" "}
                <button
                  onClick={() => {
                    setMode("signup");
                    setMessage("");
                  }}
                  className="font-semibold text-cyan-700 hover:text-cyan-800"
                >
                  Create a free account
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function getFriendlyAuthMessage(context: "oauth" | "signup" | "login") {
  if (context === "oauth") {
    return "I couldn’t complete the sign-in. Try again or use a different login method.";
  }

  if (context === "signup") {
    return "I couldn’t create the account right now. Please try again in a moment.";
  }

  return "I couldn’t sign you in. Check your email and password, or try a different login method.";
}

function shouldContinueToDashboard() {
  if (typeof window === "undefined") return false;

  return new URLSearchParams(window.location.search).has("next");
}

async function initializeAccountMemory(user: User) {
  const localProfile = loadLearningProfile();
  const timestamp = new Date().toISOString();

  await Promise.all([
    supabase.from("profiles").upsert(
      {
        id: user.id,
        updated_at: timestamp,
      },
      { onConflict: "id" }
    ),
    supabase.from("learning_profiles").upsert(
      {
        user_id: user.id,
        profile: localProfile,
        preferred_tutoring_style: localProfile.preferredTutoringStyle,
        pacing_preference: localProfile.pacingPreference,
        independence_level: localProfile.independenceLevel,
        hint_detail_preference:
          localProfile.hintUsageFrequency === "high"
            ? "more scaffolded"
            : localProfile.independenceLevel === "mostly_independent"
              ? "concise"
              : "balanced",
        confidence_by_topic: localProfile.confidenceByTopic,
        recently_practiced_topics: localProfile.recentConcepts.slice(0, 8),
        evidence_count:
          localProfile.problemHistory.length +
          localProfile.tutoringStateHistory.length +
          localProfile.completedProblems,
        updated_at: timestamp,
      },
      { onConflict: "user_id" }
    ),
  ]);
}
