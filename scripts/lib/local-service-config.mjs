// Shared by local workers. No environment reads, CLI side effects or cloud fallback.
export function localServiceConfig(values) {
  const url = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !values.SUPABASE_SECRET_KEY?.trim()
  )
    throw new Error("Local configuration required");
  return { origin: url.origin, key: values.SUPABASE_SECRET_KEY.trim() };
}
