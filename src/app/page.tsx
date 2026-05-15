import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

const subjects = [
  "Algebra",
  "Geometry",
  "Precalculus",
  "Calculus",
  "Statistics",
  "SAT Math",
];

const heroMessages = [
  {
    role: "student",
    content: "Solve 3x + 5 = 17",
  },
  {
    role: "tutor",
    content: "What should we do first to isolate x?",
  },
  {
    role: "student",
    content: "Subtract 5?",
  },
  {
    role: "tutor",
    content: "Exactly. What does that give us?",
  },
];

const comparisons = [
  ["Gives final answers immediately", "Guides step-by-step"],
  ["Encourages copying", "Encourages reasoning"],
  ["One-shot responses", "Interactive coaching"],
  ["Passive learning", "Active understanding"],
];

const workflowSteps = [
  {
    number: "01",
    title: "Upload or paste homework",
    description:
      "Start with the real problem: a screenshot, typed equation, worksheet photo, or pasted prompt.",
  },
  {
    number: "02",
    title: "Break it into steps",
    description:
      "StepWise identifies what the question is asking and turns the work into a guided path.",
  },
  {
    number: "03",
    title: "Answer incrementally",
    description:
      "Students try the next move, explain their thinking, and get help without losing ownership.",
  },
  {
    number: "04",
    title: "Adapt after mistakes",
    description:
      "If a step is shaky, the tutor slows down, gives a smaller hint, and checks the reasoning.",
  },
  {
    number: "05",
    title: "Practice what matters",
    description:
      "After a checkpoint, StepWise suggests related practice that reinforces the same skill.",
  },
];

const featureCards = [
  {
    label: "Upload",
    title: "Homework screenshots",
    description:
      "Turn a photo or screenshot into a tutoring session focused on the student's actual work.",
  },
  {
    label: "Coach",
    title: "Guided reasoning",
    description:
      "Hints, checks, and next-step questions keep students active instead of passive.",
  },
  {
    label: "Adapt",
    title: "Practice after progress",
    description:
      "Recommendations appear after meaningful checkpoints, not while students are still solving.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7fafc] text-slate-950">
      <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" aria-label="StepWise home">
            <BrandLogo className="text-xl" />
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/demo"
              className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-cyan-200 transition hover:-translate-y-0.5 hover:bg-cyan-600"
            >
              Try Free Demo
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Create Free Account
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-5 pb-14 pt-12 text-center sm:px-8 sm:pb-16 sm:pt-18">
        <div className="mx-auto max-w-3xl stepwise-fade-in">
          <div className="mx-auto inline-flex rounded-full bg-white px-4 py-2 text-sm font-medium text-cyan-700 shadow-sm shadow-slate-200 ring-1 ring-slate-200/70">
            Get unstuck without copying answers
          </div>

          <h1 className="mt-6 text-5xl font-bold leading-tight tracking-normal text-slate-950 sm:text-6xl">
            Homework help that teaches students how to think.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            StepWise coaches students through problems one step at a time, so
            they build confidence instead of just copying a final answer.
          </p>

          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/demo"
              className="rounded-full bg-slate-950 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-slate-300 transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Try Free Demo
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-white px-7 py-3.5 text-base font-semibold text-slate-700 shadow-sm shadow-slate-200 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:text-slate-950"
            >
              Create Free Account
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-9 max-w-5xl stepwise-fade-in stepwise-delay-1">
          <div className="rounded-[2rem] bg-white p-3 text-left shadow-2xl shadow-slate-200/80 ring-1 ring-slate-200/80">
            <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-[1.5rem] bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-400">
                  Start here
                </p>
                <div className="mt-3 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="min-h-20 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                    <span className="stepwise-type">
                      Paste a math problem or upload a screenshot...
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700">
                      Attach homework
                    </span>
                    <span className="text-xs text-slate-400">
                      screenshot, photo, or PDF
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {subjects.map((subject) => (
                    <span
                      key={subject}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm"
                    >
                      {subject}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] bg-[#f6f9fc] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      Live tutoring preview
                    </p>
                    <p className="text-xs text-slate-500">
                      Guided reasoning, not answer dumping
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 shadow-sm">
                    Step-by-step
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {heroMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${message.content}`}
                      className={`stepwise-message flex ${
                        message.role === "student"
                          ? "justify-end"
                          : "items-start gap-3"
                      }`}
                      style={{ animationDelay: `${0.35 + index * 0.7}s` }}
                    >
                      {message.role === "tutor" && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700">
                          AI
                        </div>
                      )}
                      <div
                        className={`max-w-[76%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${
                          message.role === "student"
                            ? "rounded-tr-md bg-slate-950 text-white"
                            : "rounded-tl-md bg-white text-slate-700"
                        }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-[1.35rem] bg-white p-2 shadow-sm ring-1 ring-cyan-100">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-400">
                    Type your next step...
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 px-1 pb-1">
                    {["Hint", "Check reasoning", "Practice"].map((action) => (
                      <span
                        key={action}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-100"
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8 stepwise-reveal">
        <div className="grid gap-4 md:grid-cols-3">
          {featureCards.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-3xl bg-white p-5 shadow-sm shadow-slate-200 ring-1 ring-slate-200/70 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-200/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-50 text-xs font-bold text-cyan-700 transition group-hover:bg-cyan-100">
                {feature.label}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-950">
                {feature.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8 stepwise-reveal">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold text-cyan-700">
            Why StepWise feels different
          </p>
          <h2 className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">
            Built for learning, not answer copying.
          </h2>
        </div>

        <div className="grid gap-4 rounded-[2rem] bg-white p-3 shadow-sm shadow-slate-200 ring-1 ring-slate-200 md:grid-cols-2">
          <div className="rounded-[1.5rem] bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-500">
              Typical AI Homework Tools
            </p>
            <div className="mt-4 space-y-3">
              {comparisons.map(([typical]) => (
                <div
                  key={typical}
                  className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"
                >
                  {typical}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] bg-cyan-50 p-5 ring-1 ring-cyan-100">
            <p className="text-sm font-semibold text-cyan-800">StepWise</p>
            <div className="mt-4 space-y-3">
              {comparisons.map(([, stepwise]) => (
                <div
                  key={stepwise}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm"
                >
                  {stepwise}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8 stepwise-reveal">
        <div className="rounded-[2rem] bg-white p-5 shadow-xl shadow-slate-200/70 ring-1 ring-slate-200/80 sm:p-7">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold text-cyan-700">
                How StepWise Works
              </p>
              <h2 className="mt-3 text-3xl font-bold leading-tight text-slate-950 sm:text-4xl">
                A real tutoring loop, not a single answer box.
              </h2>
              <p className="mt-4 leading-7 text-slate-600">
                StepWise keeps students involved. It reads the problem, asks
                for reasoning, checks the next step, adapts when mistakes
                happen, and suggests practice only after progress.
              </p>
              <Link
                href="/demo"
                className="mt-6 inline-block rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-cyan-200 transition hover:-translate-y-0.5 hover:bg-cyan-600"
              >
                Try Free Demo
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {workflowSteps.map((step) => (
                <div
                  key={step.number}
                  className="rounded-3xl bg-slate-50 p-4 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-1 hover:bg-white"
                >
                  <span className="text-xs font-bold text-cyan-700">
                    {step.number}
                  </span>
                  <h3 className="mt-2 font-semibold text-slate-950">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-14 text-center sm:px-8 stepwise-reveal">
        <div className="rounded-[2rem] bg-white p-7 shadow-sm shadow-slate-200 ring-1 ring-slate-200/70">
          <p className="text-xs font-semibold uppercase text-cyan-600">
            This is not an answer bot.
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-bold text-slate-950">
            Learn how to solve it, not just what to write down.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-600">
            StepWise helps overwhelmed students slow down, reason clearly, and
            build confidence one step at a time.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16 text-center sm:px-8 stepwise-reveal">
        <div className="rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-xl shadow-slate-300">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Build confidence one step at a time.
          </h2>
          <p className="mx-auto mt-3 max-w-xl leading-7 text-slate-300">
            Try a guided tutoring session and see how StepWise helps students
            think through homework without answer dumping.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/demo"
              className="rounded-full bg-cyan-500 px-7 py-3.5 font-semibold text-white shadow-sm shadow-cyan-900/30 transition hover:-translate-y-0.5 hover:bg-cyan-400"
            >
              Try Free Demo
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-white/10 px-7 py-3.5 font-semibold text-white ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:bg-white/15"
            >
              Create Free Account
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
