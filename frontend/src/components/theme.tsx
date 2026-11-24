"use client";

import { useEffect, useState } from "react";

/**
 * Light, dark or follow the device (PRD 6.1: the interface adapts to the user, not the
 * other way round).
 *
 * Two values are kept apart on purpose. The stored preference is what the user chose,
 * including "system". The resolved theme is what is actually painted, and lives in
 * `data-theme` on the document element, which is what the stylesheet reads. Choosing
 * "system" therefore keeps following the device afterwards, rather than freezing
 * whatever the device happened to be at the moment of the click.
 */

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "ps-theme";

/**
 * Runs before the first paint, from the document head.
 *
 * Without this the server sends light markup, the client reads the preference after
 * hydration, and a user who chose dark gets a white flash on every navigation. It is
 * deliberately small, dependency-free and wrapped in try/catch: storage can throw in a
 * private window, and a theme is never worth failing a page load over.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var preference = stored === "light" || stored === "dark" ? stored : "system";
    var resolved =
      preference === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : preference;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-preference", preference);
  } catch (error) {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("data-theme-preference", "system");
  }
})();
`.trim();

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(preference: ThemePreference): void {
  const resolved = preference === "system" ? systemTheme() : preference;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-preference", preference);
}

const OPTIONS: { value: ThemePreference; label: string; title: string; icon: JSX.Element }[] = [
  {
    value: "light",
    label: "Light",
    title: "Use the light theme",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <circle cx="12" cy="12" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 2.75v2.1M12 19.15v2.1M21.25 12h-2.1M4.85 12h-2.1M18.54 5.46l-1.48 1.48M6.94 17.06l-1.48 1.48M18.54 18.54l-1.48-1.48M6.94 6.94L5.46 5.46"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    title: "Use the dark theme",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M20.1 14.6A8.4 8.4 0 0 1 9.4 3.9a8.4 8.4 0 1 0 10.7 10.7z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    title: "Follow the device setting",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <rect
          x="3"
          y="4.5"
          width="18"
          height="12"
          rx="1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M9 20h6M12 16.5V20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  // The server has no way to know the preference, so the control renders unselected and
  // settles on mount. Rendering the same markup on both sides avoids a hydration warning.
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    const attribute = document.documentElement.getAttribute("data-theme-preference");
    const current: ThemePreference =
      attribute === "light" || attribute === "dark" ? attribute : "system";
    setPreference(current);
  }, []);

  // While following the device, a change to the device setting must take effect at once.
  useEffect(() => {
    if (preference !== "system") return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  function choose(value: ThemePreference) {
    setPreference(value);
    applyTheme(value);
    try {
      if (value === "system") {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, value);
      }
    } catch {
      // A blocked storage API costs the user persistence, not the theme itself.
    }
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-line bg-paper-sunk p-0.5"
      role="group"
      aria-label="Colour theme"
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={preference === null ? undefined : selected}
            onClick={() => choose(option.value)}
            className={
              "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors " +
              (selected
                ? "bg-paper text-brand shadow-card"
                : "text-ink-muted hover:text-ink")
            }
          >
            {option.icon}
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
