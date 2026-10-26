import { handleBusinessEmail } from "@/modules/email/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleBusinessEmail(request);
}
