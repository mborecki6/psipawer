import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, config as supabaseConfig } from "@/lib/supabase/config";
export async function proxy(request: NextRequest) {
  if (!isConfigured())
    return NextResponse.redirect(new URL("/login", request.url));
  let response = NextResponse.next({ request });
  const { url, key } = supabaseConfig();
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    const destination = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((c) => destination.cookies.set(c));
    return destination;
  }
  return response;
}
export const config = {
  matcher: [
    "/admin/:path*",
    "/app/:path*",
    "/account/:path*",
    "/complete-profile",
  ],
};
