import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { cancelEmail } from "@/lib/engine/pipeline";

type Params = { id: string };

/** POST /api/emails/:id/cancel — pull an email back to draft. */
export const POST = withAuth<Params>(async ({ userId, params }) => {
  await cancelEmail(userId, params.id);
  return NextResponse.json({ ok: true });
});
