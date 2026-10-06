"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Controlled inputs need their event handlers before accepting edits. Otherwise
// an input typed into the server-rendered preview can disappear on hydration.
// Client navigations are ready immediately; only the initial hydration waits.
export function useHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
