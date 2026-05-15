"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AccountMenuProps = {
  align?: "left" | "right";
};

type UserSummary = {
  name: string;
  email: string;
  avatarUrl: string;
  initials: string;
};

export default function AccountMenu({ align = "right" }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [userSummary, setUserSummary] = useState<UserSummary | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;

      setIsSignedIn(Boolean(data.session));
      setUserSummary(data.session ? getUserSummary(data.session.user) : null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session));
      setUserSummary(session ? getUserSummary(session.user) : null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleSignOut() {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  function openFeedback() {
    window.dispatchEvent(new Event("stepwise:open-feedback"));
    setIsOpen(false);
  }

  const menuAlignment = align === "right" ? "right-0" : "left-0";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200/80 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:text-slate-950 hover:ring-slate-300 focus:outline-none focus:ring-4 focus:ring-cyan-100"
      >
        <Avatar summary={userSummary} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute ${menuAlignment} z-50 mt-3 w-60 origin-top-right animate-[menuIn_140ms_ease-out] rounded-3xl bg-white p-2 shadow-2xl shadow-slate-900/10 ring-1 ring-slate-200/80`}
        >
          {userSummary && (
            <div className="mb-1 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
              <Avatar summary={userSummary} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {userSummary.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {userSummary.email}
                </p>
              </div>
            </div>
          )}

          <MenuLink href="/dashboard" label="Account" />
          <MenuButton label="Preferences" supportingText="Coming soon" />
          <MenuButton label="Settings" supportingText="Coming soon" />
          <button
            type="button"
            role="menuitem"
            onClick={openFeedback}
            className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
          >
            Help / Feedback
          </button>

          <div className="my-1 h-px bg-slate-100" />

          {isSignedIn ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          ) : (
            <MenuLink href="/login" label="Sign in" strong />
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ summary }: { summary: UserSummary | null }) {
  if (summary?.avatarUrl) {
    return (
      <img
        src={summary.avatarUrl}
        alt=""
        className="h-8 w-8 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
      {summary?.initials || "SW"}
    </span>
  );
}

function getUserSummary(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): UserSummary {
  const metadata = user.user_metadata ?? {};
  const fullName = getStringValue(metadata.full_name) || getStringValue(metadata.name);
  const email = user.email ?? "";
  const name = fullName || email.split("@")[0] || "StepWise student";
  const avatarUrl =
    getStringValue(metadata.avatar_url) ||
    getStringValue(metadata.picture) ||
    getStringValue(metadata.photo_url);

  return {
    name,
    email,
    avatarUrl,
    initials: getInitials(name),
  };
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getInitials(name: string) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "SW";
}

function MenuLink({
  href,
  label,
  strong = false,
}: {
  href: string;
  label: string;
  strong?: boolean;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={`block rounded-2xl px-3 py-2.5 text-sm transition hover:bg-slate-50 hover:text-slate-950 ${
        strong ? "font-semibold text-slate-800" : "font-medium text-slate-700"
      }`}
    >
      {label}
    </Link>
  );
}

function MenuButton({
  label,
  supportingText,
}: {
  label: string;
  supportingText: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50"
    >
      <span>{label}</span>
      <span className="text-[11px] font-semibold text-slate-400">
        {supportingText}
      </span>
    </button>
  );
}
