import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, parseBody } from "@/lib/api";
import { approveEmail } from "@/lib/engine/pipeline";

type Params = { id: string };

const schema = z.object({
  /** Optional explicit send time (SCHEDULED mode). ISO string. */
  scheduledFor: z.string().datetime().optional(),
});

/** POST /api/emails/:id/approve — approve + schedule for sending. */
export const POST = withAuth<Params>(async ({ request, userId, params }) => {
  const body = await parseBody(request, schema).catch(() => ({}) as z.infer<typeof schema>);
  const { scheduledAt } = await approveEmail(
    userId,
    params.id,
    body.scheduledFor ? new Date(body.scheduledFor) : undefined
  );
  return NextResponse.json({ scheduledAt });
});
