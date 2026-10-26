import { handlePaymentChecks } from "@/lib/payment-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handlePaymentChecks(request);
}
