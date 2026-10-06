export function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    !isRemoteDevelopment(),
  );
}
export function isRemoteDevelopment() {
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      Boolean(url.username || url.password)
    );
  } catch {
    return true;
  }
}
export function config() {
  if (isRemoteDevelopment())
    throw new Error(
      "Tryb lokalny wymaga lokalnej bazy. Połączenie z chmurą jest wyłączone.",
    );
  if (!isConfigured())
    throw new Error("Supabase nie jest jeszcze skonfigurowany.");
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  };
}
