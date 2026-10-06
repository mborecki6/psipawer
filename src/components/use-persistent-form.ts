"use client";

import { useEffect, useRef } from "react";

// Editors keep their values after saving. React's action reset runs while
// synthetic events are suppressed; use a native listener so a select cannot
// visually revert to its first option while React state holds another value.
export function usePersistentForm() {
  const element = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = element.current;
    const preserve = (event: Event) => event.preventDefault();
    form?.addEventListener("reset", preserve);
    return () => form?.removeEventListener("reset", preserve);
  }, []);
  return element;
}
