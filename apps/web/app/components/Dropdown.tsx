"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
}

/** In-house select — replaces native <select> so menus match the app instead
 * of the OS. Button + listbox popover with full keyboard support (arrows,
 * Home/End, Enter/Escape, type-ahead by first letter). */
export function Dropdown({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [hi, setHi] = useState(selectedIdx);

  useEffect(() => {
    if (!open) return;
    setHi(selectedIdx);
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, selectedIdx]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-idx="${hi}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, hi]);

  function pick(idx: number) {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setHi((h) => (h + d + options.length) % options.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHi(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHi(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(hi);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    } else if (/^[a-z0-9]$/i.test(e.key)) {
      const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (idx >= 0) setHi(idx);
    }
  }

  const selected = options[selectedIdx];

  return (
    <div className="yb-dd" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="yb-dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{selected?.label ?? "-"}</span>
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="yb-dd-pop" id={listId} role="listbox" aria-label={ariaLabel} ref={listRef}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              data-idx={i}
              aria-selected={o.value === value}
              className={`yb-dd-item${i === hi ? " hi" : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
