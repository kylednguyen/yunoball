"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Search,
  Shield,
  Sparkles,
  Star,
  Trophy,
  Tv,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { SearchSuggest } from "./SearchSuggest";

const LINKS = [
  { href: "/", label: "Search", icon: Search },
  { href: "/scores", label: "Scores", icon: Tv },
  { href: "/teams", label: "Teams", icon: Shield },
  { href: "/standings", label: "Standings", icon: BarChart3 },
  { href: "/leaders", label: "Leaders", icon: Trophy },
  { href: "/fantasy", label: "Fantasy", icon: Star },
  { href: "/assistant", label: "Assistant", badge: "Pro", icon: Sparkles },
  { href: "/glossary", label: "Glossary", icon: BookOpen },
];

/** Compact search on every page: teams/players jump to their pages,
 *  questions land on the home search. */
function QuickSearch() {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut: "/" or ⌘K / Ctrl-K focuses the search from anywhere,
  // matching the home-page search (search.tsx) on the pages where it mounts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <SearchSuggest
      value={q}
      onValueChange={setQ}
      inputRef={inputRef}
      onSearch={(question) => {
        setOpenMobile(false);
        router.push(`/?q=${encodeURIComponent(question)}`);
      }}
      placeholder="Search…"
      ariaLabel="Search NFL teams, players, and stats"
    />
  );
}

export function Nav() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  // Non-alarming offline notice; recovers automatically when back online.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    setOffline(!navigator.onLine);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <Sidebar>
      <SidebarHeader className="gap-3">
        <Link
          href="/"
          onClick={() => setOpenMobile(false)}
          className="px-2 py-1 font-heading text-2xl font-extrabold tracking-tight"
        >
          Yuno<span className="text-primary">Ball</span>
        </Link>
        {pathname !== "/" && <QuickSearch />}
        {offline && (
          <p
            className="rounded-md bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive"
            role="status"
          >
            Offline — data may be stale
          </p>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {LINKS.map(({ href, label, badge, icon: Icon }) => {
                const active =
                  href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(href) ||
                      // Box scores are children of Scores in the IA.
                      (href === "/scores" && pathname.startsWith("/games"));
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Link href={href}>
                        <Icon />
                        <span>{label}</span>
                        {badge && (
                          <Badge variant="secondary" className="ml-auto">
                            {badge}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <p className="px-2 text-xs leading-relaxed text-muted-foreground">
          Every number computed from nflverse data.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
