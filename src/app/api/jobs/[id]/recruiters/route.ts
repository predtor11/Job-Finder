import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { discoverRecruitersForJob } from "@/lib/recruiters/discovery";

type Params = { id: string };

/** POST /api/jobs/:id/recruiters — discover public hiring contacts. */
export const POST = withAuth<Params>(async ({ userId, params }) => {
  const contacts = await discoverRecruitersForJob(userId, params.id);
  return NextResponse.json({ contacts });
});
