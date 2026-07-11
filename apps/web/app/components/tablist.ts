"use client";

/** ARIA tabs keyboard pattern for a role="tablist" container: Left/Right
 * arrows move between tabs (wrapping), Home/End jump to the edges, and
 * activation follows focus. Attach as onKeyDown on the tablist element. */
export function tablistKeys(e: React.KeyboardEvent<HTMLElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i === -1) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}
