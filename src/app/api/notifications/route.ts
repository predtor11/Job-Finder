import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";

/** GET /api/notifications */
export const GET = withAuth(async ({ request, userId }) => {
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return NextResponse.json({ notifications, unreadCount });
});

const patchSchema = z.object({
  ids: z.array(z.string()).optional(),
  markAllRead: z.boolean().optional(),
});

/** PATCH /api/notifications — mark read. */
export const PATCH = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, patchSchema);
  await prisma.notification.updateMany({
    where: {
      userId,
      ...(body.markAllRead ? {} : { id: { in: body.ids ?? [] } }),
    },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
});
