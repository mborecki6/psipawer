import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  if (code && isConfigured()) {
    const db = await createClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await db.auth.getUser();
      if (user) {
        const { data } = await db
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();
        return NextResponse.redirect(
          new URL(data?.role === "admin" ? "/admin" : "/app", origin),
        );
      }
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
