import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api";

type Params = { id: string };

export const DELETE = withAuth<Params>(async ({ userId, params }) => {
  const deleted = await prisma.jobSearch.deleteMany({
    where: { id: params.id, userId },
  });
  if (deleted.count === 0)
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
