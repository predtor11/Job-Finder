import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getAuthUrl } from "@/lib/gmail/oauth";

/** GET /api/gmail/connect — begin the Gmail OAuth flow. */
export const GET = withAuth(async ({ userId }) => {
  return NextResponse.redirect(getAuthUrl(userId));
});
