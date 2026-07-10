import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail, e.g. NFL > 2025 > 49ers. Last item is the current page. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="yb-crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`}>
          {i > 0 && (
            <span className="sep" aria-hidden="true">
              ›
            </span>
          )}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
