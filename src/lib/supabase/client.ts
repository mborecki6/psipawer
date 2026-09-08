"use client";
import { createBrowserClient } from "@supabase/ssr";
import { config } from "./config";
export function createClient() {
  const { url, key } = config();
  return createBrowserClient(url, key);
}
