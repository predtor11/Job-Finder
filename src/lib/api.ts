import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUser, UnauthorizedError } from "@/lib/supabase/server";
import { AiBudgetExceededError } from "@/lib/ai/gemini";

/**
 * API route helpers — consistent auth, validation, and error envelopes.
 * Success: 2xx with JSON payload.  Error: { error: string } with status.
 */

type Handler<TParams> = (ctx: {
  request: NextRequest;
  userId: string;
  params: TParams;
}) => Promise<NextResponse | Response>;

/** Wrap a route handler with authentication + uniform error handling. */
export function withAuth<TParams = Record<string, never>>(
  handler: Handler<TParams>
) {
  return async (
    request: NextRequest,
    context: { params: Promise<TParams> }
  ): Promise<Response> => {
    try {
      const user = await getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const params = await context.params;
      return await handler({ request, userId: user.id, params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Validation failed", details: error.flatten() },
      { status: 400 }
    );
  }
  if (error instanceof AiBudgetExceededError) {
    return NextResponse.json({ error: error.message }, { status: 429 });
  }
  if (error instanceof Error) {
    // Domain errors thrown by engines are user-safe by convention.
    const status = /not found/i.test(error.message) ? 404 : 400;
    if (process.env.NODE_ENV !== "production") console.error(error);
    return NextResponse.json({ error: error.message }, { status });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Parse + validate a JSON body against a Zod schema (throws ZodError). */
export async function parseBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>
): Promise<T> {
  const body = await request.json().catch(() => {
    throw new z.ZodError([
      { code: "custom", message: "Invalid JSON body", path: [] },
    ]);
  });
  return schema.parse(body);
}

/** Guard for cron/scheduler routes — Vercel Cron or Bearer CRON_SECRET. */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
