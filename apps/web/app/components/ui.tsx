import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { Crumbs, type Crumb } from "./Crumbs";

export type InfoItem = {
  label: string;
  value: ReactNode;
};

export type StatSummaryItem = InfoItem & {
  meta?: ReactNode;
};

export function Surface({
  as: Tag = "section",
  interactive = false,
  className = "",
  children,
  ...props
}: {
  as?: "article" | "aside" | "div" | "section";
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const classes = [
    "yb-surface",
    interactive ? "is-interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...props}>
      {children}
    </Tag>
  );
}

export function PageHeader({
  crumbs,
  title,
  controls,
  action,
  filters,
}: {
  crumbs?: Crumb[];
  title: string;
  controls?: ReactNode;
  action?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <header className="yb-page-header">
      {crumbs && <Crumbs items={crumbs} />}
      <div className="yb-page-head">
        <div className="yb-page-copy">
          <h1 className="yb-page-title">{title}</h1>
        </div>
        {(controls || action) && (
          <div className="yb-page-actions">
            {controls}
            {action}
          </div>
        )}
      </div>
      {filters && <div className="yb-page-filters">{filters}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="yb-section-head">
      <div>
        <h2>{title}</h2>
      </div>
      {action && <div className="yb-section-action">{action}</div>}
    </div>
  );
}

/** Shared identity surface for data-backed entity pages. The route owns all
 * data and controls; this component owns only hierarchy and layout. */
export function EntityHero({
  className = "",
  label,
  media,
  title,
  eyebrow,
  meta,
  utilities,
  details,
  style,
}: {
  className?: string;
  label: string;
  media: ReactNode;
  title: string;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  utilities?: ReactNode;
  details?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      className={["yb-entity-hero", className].filter(Boolean).join(" ")}
      role="region"
      aria-label={label}
      style={style}
    >
      <div className="yb-entity-hero-main">
        <div className="yb-entity-hero-media">{media}</div>
        <div className="yb-entity-hero-copy">
          {eyebrow && <div className="yb-entity-eyebrow">{eyebrow}</div>}
          <h1 className="yb-entity-title">{title}</h1>
          {meta && <div className="yb-entity-meta">{meta}</div>}
        </div>
        {utilities && <div className="yb-entity-utilities">{utilities}</div>}
      </div>
      {details}
    </section>
  );
}

/** Compact definition grid for biography and entity metadata. */
export function InfoGrid({
  items,
  className = "",
}: {
  items: InfoItem[];
  className?: string;
}) {
  return (
    <dl className={["yb-info-grid", className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Position-aware headline metrics presented as one coherent stat group. */
export function StatSummary({
  title,
  items,
  className = "",
}: {
  title: string;
  items: StatSummaryItem[];
  className?: string;
}) {
  return (
    <section
      className={["yb-stat-summary", className].filter(Boolean).join(" ")}
      role="region"
      aria-label={title}
    >
      <h2>{title}</h2>
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd className="yb-stat-summary-value">{item.value}</dd>
            {item.meta && <dd className="yb-stat-summary-meta">{item.meta}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "neutral" | "success";
}) {
  return <span className={`yb-badge ${tone}`}>{children}</span>;
}
