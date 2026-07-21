import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import {
  parseWorkbookBuffer,
  parseContactText,
  importContacts,
} from "@/lib/recruiters/import";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 10 * 1024 * 1024;

const textSchema = z.object({ text: z.string().min(1) });

/**
 * POST /api/recruiters/import — bring the user's own contact list into the
 * Recruiters CRM. Accepts either:
 *  - multipart/form-data with a `file` (.xlsx, .xls, .csv), or
 *  - application/json { text } for pasted tabular text.
 *
 * This only creates CRM rows. It does not draft or send anything — cold
 * outreach to any imported contact still goes through the normal per-email
 * approval flow, and bulk-approve never includes cold outreach.
 */
export const POST = withAuth(async ({ request, userId }) => {
  const contentType = request.headers.get("content-type") ?? "";

  let rows;
  try {
    if (contentType.includes("application/json")) {
      const body = textSchema.parse(await request.json());
      rows = parseContactText(body.text);
    } else {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      }
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: "File exceeds 10 MB." }, { status: 400 });
      }
      // File type isn't strictly validated here — browsers send inconsistent
      // MIME types for .xlsx/.csv; parseWorkbookBuffer rejects unreadable
      // content with a clear error instead.
      const buffer = Buffer.from(await file.arrayBuffer());
      rows = parseWorkbookBuffer(buffer);
    }
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error).message) },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No valid contacts found. Make sure the first row has headers including Name and Email.",
      },
      { status: 400 }
    );
  }

  const result = await importContacts(userId, rows);
  return NextResponse.json(result, { status: 201 });
});
