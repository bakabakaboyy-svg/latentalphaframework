"use client";

const TABS = ["LINES", "MOVEMENT", "STEAM", "CLV", "ARB"] as const;
export type Tab = (typeof TABS)[number];

export function NavTabs({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            className={`px-4 py-3 text-sm font-medium tracking-wide transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        );
      })}
    </nav>
  );
}
