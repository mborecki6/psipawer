"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

function revealAncestors(element: Element) {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLDetailsElement) current.open = true;
    current = current.parentElement;
  }
}

export function revealCourseFormFeedback(form: HTMLFormElement | null) {
  if (form) revealAncestors(form);
}

export function CourseDisclosure({
  children,
  label,
  className,
  bodyClassName,
  initiallyOpen = false,
  name,
  id,
  meeting = false,
  enrollment = false,
}: {
  children: ReactNode;
  label: ReactNode;
  className?: string;
  bodyClassName?: string;
  initiallyOpen?: boolean;
  name?: string;
  id?: string;
  meeting?: boolean;
  enrollment?: boolean;
}) {
  // Server actions refresh props. Keep the initial choice so a successful
  // action cannot collapse its result or select a different meeting.
  const [initialOpen] = useState(initiallyOpen);
  return (
    <details
      id={id}
      className={className}
      name={name}
      open={initialOpen}
      data-course-meeting={meeting || undefined}
      data-course-enrollment-detail={enrollment || undefined}
    >
      <summary>{label}</summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}

export function CourseAdminNavigation({
  children,
  className,
  navigationKey,
  admin = true,
}: {
  children: ReactNode;
  className?: string;
  navigationKey: string;
  admin?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const openAtHash = () => {
      let id: string;
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target || !root.current?.contains(target)) return;
      // Both meeting anchors live on/outside the disclosure so the compact
      // row remains an addressable destination even while it is collapsed.
      const meeting = target.closest("[data-course-session]");
      const disclosure = meeting?.querySelector<HTMLDetailsElement>(
        "details[data-course-meeting]",
      );
      if (disclosure) disclosure.open = true;
      const enrollment = target.closest("[data-course-enrollment]");
      const enrollmentDetails = enrollment?.querySelector<HTMLDetailsElement>(
        "details[data-course-enrollment-detail]",
      );
      if (enrollmentDetails) enrollmentDetails.open = true;
      revealAncestors(target);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => target.scrollIntoView());
    };
    const reopenSameHash = (event: MouseEvent) => {
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
      // Next Link prevents the native click, and an identical URL has no
      // hashchange. Bubble after existing dirty-form guards, which stop a
      // cancelled navigation before it reaches this listener.
      if (anchor.hash && anchor.href === window.location.href) openAtHash();
    };
    openAtHash();
    window.addEventListener("hashchange", openAtHash);
    window.addEventListener("popstate", openAtHash);
    document.addEventListener("click", reopenSameHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", openAtHash);
      window.removeEventListener("popstate", openAtHash);
      document.removeEventListener("click", reopenSameHash);
    };
  }, [navigationKey]);
  return (
    <div
      className={className}
      ref={root}
      data-course-admin={admin || undefined}
      data-course-detail
    >
      {children}
    </div>
  );
}
