"use client";

const TABS = [
  { key: "LINES", label: "LINES", icon: "📊" },
  { key: "MOVEMENT", label: "MOVEMENT", icon: "📈" },
  { key: "STEAM", label: "STEAM", icon: "🔥" },
  { key: "CLV", label: "CLV", icon: "💰" },
  { key: "ARB", label: "ARB", icon: "⚡" },
] as const;

export type Tab = (typeof TABS)[number]["key"];

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`w-3.5 h-3.5 transition-transform duration-100 ${collapsed ? "rotate-180" : ""}`}>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Left sidebar navigator — replaces the old top NavTabs bar. Fixed-width rail
// that collapses to icon-only (60px) from expanded (220px), same list of
// tabs as before just laid out vertically. Active tab gets a left border in
// the accent color, matching the old top bar's active underline.
export function Sidebar({
  active,
  onChange,
  steamActive,
  collapsed,
  onToggleCollapsed,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  steamActive?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <nav
      className={`flex flex-col shrink-0 min-w-0 h-full bg-[#0f0f0f] border-r border-border transition-[width] duration-100 ${
        collapsed ? "w-[60px]" : "w-[220px]"
      }`}
    >
      <div className={`flex items-center h-14 border-b border-border shrink-0 ${collapsed ? "justify-center" : "px-4"}`}>
        {collapsed ? (
          <span className="text-accent font-bold text-sm font-mono">L</span>
        ) : (
          <span className="text-sm font-semibold tracking-tight truncate">
            LAF <span className="text-muted font-normal">— Latent Alpha</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 py-3 flex-1 overflow-y-auto">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              title={collapsed ? t.label : undefined}
              className={`relative flex items-center gap-3 mx-2 px-2.5 py-2 rounded-md text-sm font-medium tracking-wide border-l-2 transition-colors ${
                isActive
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-transparent text-muted hover:text-foreground hover:bg-[#161616]"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <span className="text-base leading-none shrink-0">{t.icon}</span>
              {!collapsed && <span className="flex-1 text-left">{t.label}</span>}
              {t.key === "STEAM" && steamActive && (
                <span
                  className={`text-danger ${collapsed ? "absolute top-1 right-1 text-[8px]" : "text-xs"}`}
                  title="Steam detected in the last 30 minutes"
                >
                  ●
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        onClick={onToggleCollapsed}
        className="flex items-center justify-center h-10 border-t border-border text-muted hover:text-foreground transition-colors shrink-0"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <CollapseIcon collapsed={collapsed} />
      </button>
    </nav>
  );
}
