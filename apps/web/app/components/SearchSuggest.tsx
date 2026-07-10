"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { Headshot } from "./Headshot";
import { TeamLogo } from "./TeamLogo";
import { fetchSuggest, type SuggestResponse } from "../lib/api";

type Item =
  | { kind: "search"; label: string }
  | { kind: "team"; id: string; label: string; sub: string }
  | { kind: "player"; id: string; label: string; sub: string; headshot: string | null };

/** Search input with entity typeahead: teams and players jump straight to
 *  their pages, anything else runs as a stats question. ARIA combobox. */
export function SearchSuggest({
  value,
  onValueChange,
  onSearch,
  placeholder,
  inputClass,
  ariaLabel,
  autoFocus,
  inputRef: externalRef,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  onSearch: (q: string) => void;
  placeholder: string;
  inputClass: string;
  ariaLabel: string;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  children?: ReactNode;
}) {
  const router = useRouter();
  const listId = useId();
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? localRef;
  const [open, setOpen] = useState(false);
  const [sug, setSug] = useState<SuggestResponse | null>(null);
  const [hi, setHi] = useState(0);

  const q = value.trim();

  useEffect(() => {
    if (q.length < 2) {
      setSug(null);
      return;
    }
    let active = true;
    const t = setTimeout(() => {
      fetchSuggest(q)
        .then((s) => {
          if (active) {
            setSug(s);
            setHi(0);
          }
        })
        .catch(() => active && setSug(null));
    }, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  const items: Item[] = [{ kind: "search", label: q }];
  if (sug && sug.query.trim() === q) {
    for (const t of sug.teams) {
      items.push({
        kind: "team",
        id: t.team_id,
        label: t.name,
        sub: "Team page",
      });
    }
    for (const p of sug.players) {
      items.push({
        kind: "player",
        id: p.player_id,
        label: p.name,
        sub: [p.position, p.team].filter(Boolean).join(" · ") || "Player page",
        headshot: p.headshot_url,
      });
    }
  }
  const show = open && q.length >= 2;

  function pick(item: Item) {
    setOpen(false);
    if (item.kind === "player") router.push(`/players/${encodeURIComponent(item.id)}`);
    else if (item.kind === "team") router.push(`/teams/${item.id}`);
    else if (item.label) onSearch(item.label);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!show) {
        setOpen(true);
        return;
      }
      const d = e.key === "ArrowDown" ? 1 : -1;
      setHi((h) => (h + d + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (show && items[hi]) pick(items[hi]);
      else if (q) onSearch(q);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="yb-suggest">
      <input
        ref={inputRef}
        className={inputClass}
        type="text"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show ? `${listId}-${hi}` : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => q.length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {children}
      {show && (
        <ul className="yb-suggest-pop" id={listId} role="listbox" aria-label="Suggestions">
          {items.map((item, i) => (
            <li
              key={item.kind === "search" ? "search" : `${item.kind}-${item.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              className="yb-suggest-item"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {item.kind === "search" && (
                <>
                  <span className="glyph" aria-hidden="true">
                    ?
                  </span>
                  <span className="who">
                    <span className="nm">Ask: &ldquo;{item.label}&rdquo;</span>
                    <span className="sub">Answer from the stats warehouse</span>
                  </span>
                </>
              )}
              {item.kind === "team" && (
                <>
                  <TeamLogo team={item.id} size={24} />
                  <span className="who">
                    <span className="nm">{item.label}</span>
                    <span className="sub">{item.sub}</span>
                  </span>
                </>
              )}
              {item.kind === "player" && (
                <>
                  <Headshot src={item.headshot} name={item.label} size={24} />
                  <span className="who">
                    <span className="nm">{item.label}</span>
                    <span className="sub">{item.sub}</span>
                  </span>
                </>
              )}
            </li>
          ))}
          {sug === null && (
            <li className="yb-suggest-item muted" aria-hidden="true">
              <span className="sub">Looking up players and teams…</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
