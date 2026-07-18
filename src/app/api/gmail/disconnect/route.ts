import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, parseBody } from "@/lib/api";
import { disconnectGmail } from "@/lib/gmail/oauth";

const schema = z.object({ accountId: z.string().min(1) });

/** POST /api/gmail/disconnect — revoke + delete a connected account. */
export const POST = withAuth(async ({ request, userId }) => {
  const { accountId } = await parseBody(request, schema);
  await disconnectGmail(userId, accountId);
  return NextResponse.json({ ok: true });
});
