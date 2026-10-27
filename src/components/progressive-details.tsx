"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Reveal preserved forms before their result receives focus. */
export function revealFormFeedback(element: Element | null) {
  for (let current = element; current; current = current.parentElement) {
    if (current instanceof HTMLDetailsElement) current.open = true;
  }
}

export function ProgressiveDetails({
  label,
  children,
  initiallyOpen = false,
  id,
  name,
  className,
  bodyClassName,
  primary = false,
}: {
  label: ReactNode;
  children: ReactNode;
  initiallyOpen?: boolean;
  id?: string;
  name?: string;
  className?: string;
  bodyClassName?: string;
  primary?: boolean;
}) {
  // Keep the initial choice across action refreshes. The browser owns toggling;
  // refreshing server props must not collapse a pending form or its feedback.
  const [initialOpen] = useState(initiallyOpen);
  return (
    <details
      id={id}
      name={name}
      className={className}
      open={initialOpen}
      data-detail-primary={primary || undefined}
      onInvalidCapture={(event) => revealFormFeedback(event.target as Element)}
    >
      <summary>{label}</summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}

/** Keep existing fragment links useful when their destination is collapsed. */
export function DetailsNavigation({
  children,
  navigationKey,
  className,
}: {
  children: ReactNode;
  navigationKey: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const revealTarget = () => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target || !root.current?.contains(target)) return;
      // A compact row can expose more than one stable anchor (UUID / ordinal).
      const item = target.closest("[data-detail-item]");
      const primary = item?.querySelector<HTMLDetailsElement>(
        "details[data-detail-primary]",
      );
      if (primary) primary.open = true;
      revealFormFeedback(target);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => target.scrollIntoView());
    };
    const revealSameTarget = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      // Next Link prevents native navigation; an unchanged hash emits no event.
      // Dirty-form guards stop cancelled clicks before this document listener.
      if (anchor.hash && anchor.href === window.location.href) revealTarget();
    };
    revealTarget();
    window.addEventListener("hashchange", revealTarget);
    window.addEventListener("popstate", revealTarget);
    document.addEventListener("click", revealSameTarget);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", revealTarget);
      window.removeEventListener("popstate", revealTarget);
      document.removeEventListener("click", revealSameTarget);
    };
  }, [navigationKey]);
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
