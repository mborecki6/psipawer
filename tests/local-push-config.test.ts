import { expect, it, vi } from "vitest";
import { localPushValues } from "../scripts/lib/local-push-config.mjs";

const saved = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "local-db-key",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "a".repeat(87),
  VAPID_PRIVATE_KEY: "b".repeat(43),
  VAPID_SUBJECT: "https://app.example",
};
const generated = { publicKey: "c".repeat(87), privateKey: "d".repeat(43) };
it("preserves the local push identity when Supabase env is recreated", () => {
  const generate = vi.fn(() => generated);
  expect(
    localPushValues(saved, saved.NEXT_PUBLIC_SUPABASE_URL, generate),
  ).toEqual({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: saved.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: saved.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: saved.VAPID_SUBJECT,
  });
  expect(generate).not.toHaveBeenCalled();
});
it.each([
  {},
  { ...saved, VAPID_PRIVATE_KEY: "" },
  { ...saved, NEXT_PUBLIC_SUPABASE_URL: "https://cloud.supabase.co" },
  { ...saved, NEXT_PUBLIC_SUPABASE_URL: "http://localhost.evil.example" },
  { ...saved, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55555" },
])(
  "creates a distinct local identity instead of reusing unsafe/missing keys",
  (previous) => {
    const generate = vi.fn(() => generated);
    expect(
      localPushValues(previous, saved.NEXT_PUBLIC_SUPABASE_URL, generate),
    ).toEqual({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: generated.publicKey,
      VAPID_PRIVATE_KEY: generated.privateKey,
      VAPID_SUBJECT: "https://psipawer.vercel.app",
    });
    expect(generate).toHaveBeenCalledOnce();
  },
);
