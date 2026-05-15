"use client";

import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#f7fafc] px-5 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col">
        <Link href="/" aria-label="StepWise home">
          <BrandLogo className="text-2xl" />
        </Link>

        <section className="my-auto rounded-[2rem] bg-white p-8 text-center shadow-sm ring-1 ring-slate-200 sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">
            Let’s get you back on track
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
            StepWise hit a temporary issue.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">
            Your session is still yours. Try refreshing this view, or return to
            the demo and resend the problem when you’re ready.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-cyan-100 hover:bg-cyan-600"
            >
              Try Again
            </button>
            <Link
              href="/demo"
              className="rounded-full bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              Open Demo
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
