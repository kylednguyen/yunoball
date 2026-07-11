import type { HTMLAttributes, ReactNode } from "react";

import { Crumbs, type Crumb } from "./Crumbs";

type SurfaceVariant = "standard" | "feature" | "dense";

export function Surface({
  as: Tag = "section",
  variant = "standard",
  interactive = false,
  className = "",
  children,
  ...props
}: {
  as?: "article" | "aside" | "div" | "section";
  variant?: SurfaceVariant;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const classes = [
    "yb-surface",
    `yb-surface-${variant}`,
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
  description,
  controls,
  action,
  filters,
}: {
  crumbs?: Crumb[];
  title: string;
  description?: ReactNode;
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
          {description && <p className="yb-page-sub">{description}</p>}
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
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="yb-section-head">
      <div>
        <h2>{title}</h2>
        {meta && <p>{meta}</p>}
      </div>
      {action}
    </div>
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
