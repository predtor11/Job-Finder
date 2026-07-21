import { google } from "googleapis";
import { getAuthorizedClient } from "@/lib/gmail/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/prisma";

/**
 * Gmail sender — builds RFC 2822 MIME messages (with resume attachment) and
 * sends via the Gmail API. Returns Gmail message + thread ids for tracking.
 */

interface SendParams {
  userId: string;
  to: string;
  toName?: string | null;
  subject: string;
  bodyText: string;
  /** Resume to attach (downloaded from Supabase Storage). */
  attachResumeId?: string | null;
  /** Reply threading (follow-ups). */
  inReplyToMessageId?: string | null;
  gmailThreadId?: string | null;
}

export interface SendResult {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
}

export async function sendGmail(params: SendParams): Promise<SendResult> {
  const { client, accountEmail } = await getAuthorizedClient(params.userId);
  const gmail = google.gmail({ version: "v1", auth: client });

  let attachment: { filename: string; mimeType: string; data: Buffer } | null =
    null;

  if (params.attachResumeId) {
    const resume = await prisma.resume.findFirst({
      where: { id: params.attachResumeId, userId: params.userId },
    });
    // Fail loud rather than silently sending without a CV — a missing resume
    // here means the record was deleted after the draft was created, which
    // the user needs to know about, not have quietly swallowed.
    if (!resume) {
      throw new Error(
        `Resume ${params.attachResumeId} could not be found — it may have been deleted. Re-attach a resume on this application before sending.`
      );
    }
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from("resumes")
      .download(resume.storagePath);
    if (error) throw new Error(`Could not download resume: ${error.message}`);
    attachment = {
      filename: resume.fileName,
      mimeType: resume.mimeType,
      data: Buffer.from(await data.arrayBuffer()),
    };
  }

  // Fetch RFC Message-ID header for proper reply threading.
  let inReplyToHeader: string | null = null;
  if (params.inReplyToMessageId) {
    try {
      const original = await gmail.users.messages.get({
        userId: "me",
        id: params.inReplyToMessageId,
        format: "metadata",
        metadataHeaders: ["Message-ID"],
      });
      inReplyToHeader =
        original.data.payload?.headers?.find(
          (h) => h.name?.toLowerCase() === "message-id"
        )?.value ?? null;
    } catch {
      // Thread anyway via threadId below.
    }
  }

  const raw = buildMime({
    from: accountEmail,
    to: params.toName ? `${sanitizeName(params.toName)} <${params.to}>` : params.to,
    subject: params.subject,
    bodyText: params.bodyText,
    attachment,
    inReplyTo: inReplyToHeader,
  });

  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(params.gmailThreadId ? { threadId: params.gmailThreadId } : {}),
    },
  });

  if (!data.id || !data.threadId) {
    throw new Error("Gmail send returned no message id.");
  }

  return {
    gmailMessageId: data.id,
    gmailThreadId: data.threadId,
    fromEmail: accountEmail,
  };
}

function sanitizeName(name: string): string {
  return name.replace(/[<>"\r\n]/g, "").trim();
}

/** RFC 2047 encode a header value when it contains non-ASCII characters. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildMime(msg: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  attachment: { filename: string; mimeType: string; data: Buffer } | null;
  inReplyTo: string | null;
}): string {
  const boundary = `mime_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    "MIME-Version: 1.0",
    ...(msg.inReplyTo
      ? [`In-Reply-To: ${msg.inReplyTo}`, `References: ${msg.inReplyTo}`]
      : []),
  ];

  let mime: string;
  if (msg.attachment) {
    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(msg.bodyText, "utf8").toString("base64"),
      "",
      `--${boundary}`,
      `Content-Type: ${msg.attachment.mimeType}; name="${msg.attachment.filename}"`,
      `Content-Disposition: attachment; filename="${msg.attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      msg.attachment.data.toString("base64"),
      "",
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    mime = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(msg.bodyText, "utf8").toString("base64"),
    ].join("\r\n");
  }

  // Gmail expects base64url of the full RFC 2822 message.
  return Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
