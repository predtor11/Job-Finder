import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { handleOAuthCallback } from "@/lib/gmail/oauth";
import { env } from "@/lib/env";

/**
 * GET /api/gmail/callback — Google redirects here after consent.
 * `state` carries the initiating userId; it must match the session user.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const settingsUrl = `${env.appUrl}/settings?tab=email`;

  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(`${env.appUrl}/login`);
  }
  if (!code || state !== user.id) {
    return NextResponse.redirect(`${settingsUrl}&gmail=error`);
  }

  try {
    const { email } = await handleOAuthCallback(user.id, code);
    return NextResponse.redirect(
      `${settingsUrl}&gmail=connected&email=${encodeURIComponent(email)}`
    );
  } catch (error) {
    console.error("Gmail OAuth callback failed:", error);
    return NextResponse.redirect(`${settingsUrl}&gmail=error`);
  }
}
