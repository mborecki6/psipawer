"use client";
import { useEffect } from "react";
import { reconcilePushOwner } from "./browser";

export function PushSessionGuard({ userId }: { userId: string }) {
  useEffect(() => {
    void reconcilePushOwner(userId).catch(() => {});
  }, [userId]);
  return null;
}
