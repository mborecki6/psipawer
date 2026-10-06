import { handleMaintenance } from "@/lib/maintenance";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleMaintenance(request);
}
