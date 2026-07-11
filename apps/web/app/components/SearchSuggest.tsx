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

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Headshot } from "./Headshot";
import { TeamLogo } from "./TeamLogo";
import { fetchSuggest, type SuggestResponse } from "../lib/api";

type Item =
  | { kind: "search"; label: string }
  | { kind: "team"; id: string; label: string; sub: string }
  | { kind: "player"; id: string; label: string; sub: string; headshot: string | null };

/** Search input with entity typeahead: teams and players jump straight to
 *  their pages, anything else runs as a stats question. ARIA combobox. */
/** First case-insensitive match of the query inside a label -> <mark>. */
function Hit({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-primary/15 px-0.5 text-primary">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

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
  inputClass?: string;
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
      // When the suggestion popup is open, consume Escape so an enclosing
      // handler (e.g. the mobile nav drawer's native window listener) doesn't
      // also close on the same keystroke — first Escape dismisses suggestions,
      // a second closes the drawer. React's synthetic stopPropagation can't
      // stop a native window listener, so stop the native event directly.
      if (show) e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full">
      <Input
        ref={inputRef}
        className={cn(inputClass)}
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
        <ul
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 m-0 max-h-[380px] list-none overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-md"
          id={listId}
          role="listbox"
          aria-label="Suggestions"
        >
          {items.map((item, i) => (
            <li
              key={item.kind === "search" ? "search" : `${item.kind}-${item.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {item.kind === "search" && (
                <>
                  <span
                    className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full border text-xs font-bold text-muted-foreground"
                    aria-hidden="true"
                  >
                    ?
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">Ask: &ldquo;{item.label}&rdquo;</span>
                    <span className="text-xs text-muted-foreground">Answer from the stats warehouse</span>
                  </span>
                </>
              )}
              {item.kind === "team" && (
                <>
                  <TeamLogo team={item.id} size={24} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium"><Hit text={item.label} q={value} /></span>
                    <span className="text-xs text-muted-foreground">{item.sub}</span>
                  </span>
                </>
              )}
              {item.kind === "player" && (
                <>
                  <Headshot src={item.headshot} name={item.label} size={24} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium"><Hit text={item.label} q={value} /></span>
                    <span className="text-xs text-muted-foreground">{item.sub}</span>
                  </span>
                </>
              )}
            </li>
          ))}
          {sug === null && (
            <li className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm" aria-hidden="true">
              <span className="text-xs text-muted-foreground">Looking up players and teams…</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
