import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getAuthorizedClient } from "@/lib/gmail/oauth";
import { classifyInboundEmail } from "@/lib/ai/email-classifier";
import type { ApplicationStatus, MessageClassification } from "@prisma/client";

/**
 * Inbox Monitor — runs every ~10 minutes per user.
 *
 * For every tracked Gmail thread (created when we send an application/outreach
 * email), fetch new messages. Inbound ones are classified with the fast model
 * and drive the application state machine + notifications.
 */

const CLASSIFICATION_TO_STATUS: Partial<
  Record<MessageClassification, ApplicationStatus>
> = {
  INTERVIEW_REQUEST: "INTERVIEW",
  ASSESSMENT: "ASSESSMENT",
  OFFER: "OFFER",
  REJECTION: "REJECTED",
  REPLY: "REPLIED",
  QUESTION: "REPLIED",
  FOLLOW_UP_REQUEST: "REPLIED",
};

/** Statuses an inbound reply may overwrite (never downgrade OFFER etc.). */
const UPGRADEABLE: ApplicationStatus[] = [
  "SENT",
  "SCHEDULED",
  "REPLIED",
  "GHOSTED",
  "ASSESSMENT",
  "INTERVIEW",
];

export interface InboxSyncResult {
  threadsChecked: number;
  newMessages: number;
  classified: number;
  errors: string[];
}

export async function syncInbox(userId: string): Promise<InboxSyncResult> {
  const result: InboxSyncResult = {
    threadsChecked: 0,
    newMessages: 0,
    classified: 0,
    errors: [],
  };

  const account = await prisma.gmailAccount.findFirst({
    where: { userId, status: "CONNECTED" },
  });
  if (!account) return result; // Gmail not connected — nothing to sync

  const { client, accountEmail } = await getAuthorizedClient(userId);
  const gmail = google.gmail({ version: "v1", auth: client });

  const threads = await prisma.emailThread.findMany({
    where: { userId },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  for (const thread of threads) {
    result.threadsChecked++;
    try {
      const { data } = await gmail.users.threads.get({
        userId: "me",
        id: thread.gmailThreadId,
        format: "full",
      });

      for (const message of data.messages ?? []) {
        if (!message.id) continue;

        const known = await prisma.emailMessage.findUnique({
          where: { userId_gmailMessageId: { userId, gmailMessageId: message.id } },
        });
        if (known) continue;

        const headers = message.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
            ?.value ?? "";

        const fromRaw = header("From");
        const fromEmail = extractAddress(fromRaw);
        const direction =
          fromEmail.toLowerCase() === accountEmail.toLowerCase()
            ? ("OUTBOUND" as const)
            : ("INBOUND" as const);
        const bodyText = extractBody(message.payload) || message.snippet || "";
        const receivedAt = message.internalDate
          ? new Date(Number(message.internalDate))
          : new Date();

        const stored = await prisma.emailMessage.create({
          data: {
            userId,
            threadId: thread.id,
            gmailMessageId: message.id,
            direction,
            fromEmail,
            fromName: extractName(fromRaw),
            toEmail: extractAddress(header("To")),
            subject: header("Subject"),
            snippet: message.snippet,
            bodyText: bodyText.slice(0, 20_000),
            receivedAt,
          },
        });
        result.newMessages++;

        await prisma.emailThread.update({
          where: { id: thread.id },
          data: {
            lastMessageAt: receivedAt,
            ...(direction === "INBOUND" ? { unreadCount: { increment: 1 } } : {}),
          },
        });

        if (direction === "INBOUND") {
          await processInboundMessage(userId, thread.applicationId, stored.id, {
            from: fromRaw,
            subject: header("Subject"),
            body: bodyText,
          });
          result.classified++;
        }
      }
    } catch (error) {
      result.errors.push(`thread ${thread.gmailThreadId}: ${String(error).slice(0, 200)}`);
    }
  }

  await prisma.gmailAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date() },
  });

  return result;
}

async function processInboundMessage(
  userId: string,
  applicationId: string | null,
  messageId: string,
  email: { from: string; subject: string; body: string }
) {
  let classification: MessageClassification = "OTHER";
  let confidence = 0;
  let summary = "";

  try {
    const result = await classifyInboundEmail(userId, email);
    classification = result.classification;
    confidence = result.confidence;
    summary = result.summary;
  } catch {
    // Classification failure shouldn't lose the message; it stays OTHER.
  }

  await prisma.emailMessage.update({
    where: { id: messageId },
    data: {
      classification,
      classificationConfidence: confidence,
      processed: true,
    },
  });

  if (!applicationId || classification === "AUTO_REPLY" || classification === "OTHER") {
    return;
  }

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { company: true, job: true },
  });
  if (!application) return;

  const nextStatus = CLASSIFICATION_TO_STATUS[classification];
  const shouldUpdate =
    nextStatus &&
    (UPGRADEABLE.includes(application.status) ||
      nextStatus === "OFFER"); // an offer always wins

  if (shouldUpdate) {
    await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: nextStatus,
        lastContactAt: new Date(),
        nextFollowUpDue: null, // a reply cancels pending follow-up
      },
    });
  } else {
    await prisma.application.update({
      where: { id: applicationId },
      data: { lastContactAt: new Date(), nextFollowUpDue: null },
    });
  }

  const eventType =
    classification === "INTERVIEW_REQUEST"
      ? "INTERVIEW"
      : classification === "ASSESSMENT"
        ? "ASSESSMENT"
        : classification === "OFFER"
          ? "OFFER"
          : classification === "REJECTION"
            ? "REJECTED"
            : "REPLY_RECEIVED";

  await prisma.applicationEvent.create({
    data: {
      applicationId,
      type: eventType,
      title: summary || `${classification} received`,
      payload: { messageId, classification, confidence },
    },
  });

  const companyName = application.company?.name ?? application.job.title;
  const notificationType =
    classification === "INTERVIEW_REQUEST" ? "INTERVIEW" : "REPLY_RECEIVED";
  await prisma.notification.create({
    data: {
      userId,
      type: notificationType,
      title:
        classification === "INTERVIEW_REQUEST"
          ? `Interview request from ${companyName}!`
          : classification === "OFFER"
            ? `Offer from ${companyName}! 🎉`
            : classification === "REJECTION"
              ? `Update from ${companyName}`
              : `Reply from ${companyName}`,
      body: summary,
      link: `/applications/${applicationId}`,
    },
  });
}

// ─── Gmail payload helpers ───────────────────────────────────────────────────

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

function extractBody(payload: GmailPart | null | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeB64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const text = extractBody(part);
    if (text) return text;
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeB64Url(payload.body.data)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8"
  );
}

function extractAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function extractName(raw: string): string | null {
  const match = raw.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : null;
}
