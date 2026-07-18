import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { runDiscovery } from "@/lib/engine/discovery";

/** POST /api/jobs/discover — run discovery now for the current user. */
export const POST = withAuth(async ({ userId }) => {
  const result = await runDiscovery(userId);
  return NextResponse.json(result);
});
