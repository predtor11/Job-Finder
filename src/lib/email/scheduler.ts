import { prisma } from "@/lib/prisma";
import { sendGmail } from "@/lib/gmail/sender";
import { withSignature } from "@/lib/ai/email-generator";

/**
 * Email Scheduler — natural pacing + hard daily cap.
 *
 * Scheduling: each approved email gets a slot inside the user's working hours,
 * at least `minSendGapMinutes` after the previous scheduled send, plus random
 * jitter (0..sendJitterMinutes). Overflow rolls to the next working day.
 *
 * Cap: EmailQuota (unique per user/day) is incremented ATOMICALLY right before
 * each send; if the increment would exceed the limit, the email is re-slotted
 * for the next day instead of sent. Bursts are impossible by construction.
 */

interface SchedulingSettings {
  timezone: string;
  workingHoursStart: number;
  workingHoursEnd: number;
  workingDays: number[];
  minSendGapMinutes: number;
  sendJitterMinutes: number;
  dailyEmailLimit: number;
  emailSignature: string | null;
}

const DEFAULTS: SchedulingSettings = {
  timezone: "Asia/Kolkata",
  workingHoursStart: 9,
  workingHoursEnd: 19,
  workingDays: [1, 2, 3, 4, 5],
  minSendGapMinutes: 8,
  sendJitterMinutes: 7,
  dailyEmailLimit: 50,
  emailSignature: null,
};

async function getSchedulingSettings(userId: string): Promise<SchedulingSettings> {
  const s = await prisma.setting.findUnique({ where: { userId } });
  if (!s) return DEFAULTS;
  return {
    timezone: s.timezone,
    workingHoursStart: s.workingHoursStart,
    workingHoursEnd: s.workingHoursEnd,
    workingDays: s.workingDays.length ? s.workingDays : DEFAULTS.workingDays,
    minSendGapMinutes: Math.max(1, s.minSendGapMinutes),
    sendJitterMinutes: Math.max(0, s.sendJitterMinutes),
    dailyEmailLimit: Math.min(Math.max(1, s.dailyEmailLimit), 50),
    emailSignature: s.emailSignature,
  };
}

/** Wall-clock parts of `date` in the user's timezone. */
function zoned(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 1,
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/**
 * Next timestamp ≥ `from` that falls inside working hours on a working day.
 * Walks forward in 30-minute steps — simple and DST-proof.
 */
function nextWorkingSlot(from: Date, s: SchedulingSettings): Date {
  const candidate = new Date(from);
  for (let i = 0; i < 2 * 48 * 14; i++) {
    const z = zoned(candidate, s.timezone);
    const inHours = z.hour >= s.workingHoursStart && z.hour < s.workingHoursEnd;
    const onDay = s.workingDays.includes(z.weekday);
    if (inHours && onDay) return candidate;
    candidate.setTime(candidate.getTime() + 30 * 60_000);
    candidate.setSeconds(0, 0);
  }
  return candidate; // pathological settings — send anyway
}

/**
 * Assign a scheduledAt to an approved email: after the latest queued send,
 * respecting min gap + jitter, inside working hours.
 */
export async function scheduleEmail(userId: string, emailId: string): Promise<Date> {
  const s = await getSchedulingSettings(userId);

  const lastQueued = await prisma.email.findFirst({
    where: {
      userId,
      status: { in: ["QUEUED", "SENDING"] },
      scheduledAt: { not: null },
    },
    orderBy: { scheduledAt: "desc" },
    select: { scheduledAt: true },
  });

  const gapMs =
    (s.minSendGapMinutes + Math.random() * s.sendJitterMinutes) * 60_000;
  const earliest = new Date(
    Math.max(
      Date.now() + 60_000, // never "immediately" — at least a minute out
      (lastQueued?.scheduledAt?.getTime() ?? 0) + gapMs
    )
  );

  const slot = nextWorkingSlot(earliest, s);

  await prisma.email.update({
    where: { id: emailId },
    data: { status: "QUEUED", scheduledAt: slot },
  });
  return slot;
}

export interface DispatchResult {
  sent: number;
  deferred: number;
  failed: number;
}

/**
 * Dispatch due emails for one user. Called by cron (every ~5 min) or worker.
 * Concurrency-safe: the status flip to SENDING is an atomic compare-and-set,
 * and the quota increment is transactional.
 */
export async function dispatchDueEmails(userId: string): Promise<DispatchResult> {
  const s = await getSchedulingSettings(userId);
  const result: DispatchResult = { sent: 0, deferred: 0, failed: 0 };

  const due = await prisma.email.findMany({
    where: {
      userId,
      status: "QUEUED",
      scheduledAt: { lte: new Date() },
      direction: "OUTBOUND",
    },
    orderBy: { scheduledAt: "asc" },
    take: 5, // per tick — natural pacing even if cron stalls then catches up
    include: { application: true },
  });

  for (const email of due) {
    // Atomic claim — a competing worker/cron tick loses this race safely.
    const claimed = await prisma.email.updateMany({
      where: { id: email.id, status: "QUEUED" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) continue;

    // Hard daily cap — atomic increment inside a transaction.
    const allowed = await tryConsumeQuota(userId, s.dailyEmailLimit);
    if (!allowed) {
      const tomorrow = nextWorkingSlot(
        new Date(Date.now() + 12 * 3600_000),
        s
      );
      await prisma.email.update({
        where: { id: email.id },
        data: { status: "QUEUED", scheduledAt: tomorrow },
      });
      result.deferred++;
      continue;
    }

    try {
      const sendResult = await sendGmail({
        userId,
        to: email.toEmail,
        toName: email.toName,
        subject: email.subject,
        bodyText: withSignature(email.bodyText, s.emailSignature),
        attachResumeId: email.attachResume
          ? (email.application?.resumeId ?? null)
          : null,
        gmailThreadId: email.gmailThreadId,
        inReplyToMessageId:
          email.type === "FOLLOW_UP" ? await originalMessageId(email.applicationId) : null,
      });

      await prisma.$transaction(async (tx) => {
        await tx.email.update({
          where: { id: email.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            gmailMessageId: sendResult.gmailMessageId,
            gmailThreadId: sendResult.gmailThreadId,
          },
        });

        // Track the Gmail thread for EVERY outbound email (application or
        // standalone outreach) so inbox monitoring catches all replies.
        await tx.emailThread.upsert({
          where: {
            userId_gmailThreadId: {
              userId,
              gmailThreadId: sendResult.gmailThreadId,
            },
          },
          create: {
            userId,
            applicationId: email.applicationId,
            gmailThreadId: sendResult.gmailThreadId,
            subject: email.subject,
            lastMessageAt: new Date(),
          },
          update: { lastMessageAt: new Date() },
        });

        if (email.applicationId) {
          const isFollowUp = email.type === "FOLLOW_UP";
          await tx.application.update({
            where: { id: email.applicationId },
            data: {
              status: isFollowUp ? undefined : "SENT",
              appliedAt: isFollowUp ? undefined : new Date(),
              lastContactAt: new Date(),
            },
          });
          await tx.applicationEvent.create({
            data: {
              applicationId: email.applicationId,
              type: isFollowUp ? "FOLLOW_UP_SENT" : "EMAIL_SENT",
              title: isFollowUp
                ? `Follow-up sent to ${email.toEmail}`
                : `Application email sent to ${email.toEmail}`,
              payload: { emailId: email.id, subject: email.subject },
            },
          });
        }

        await tx.activityLog.create({
          data: {
            userId,
            event: "email.sent",
            message: `Sent "${email.subject}" to ${email.toEmail}`,
            metadata: { emailId: email.id, type: email.type },
          },
        });
      });
      result.sent++;
    } catch (error) {
      await prisma.email.update({
        where: { id: email.id },
        data: { status: "FAILED", error: String(error).slice(0, 2000) },
      });
      await prisma.activityLog.create({
        data: {
          userId,
          level: "ERROR",
          event: "email.send_failed",
          message: `Failed to send "${email.subject}" to ${email.toEmail}`,
          metadata: { emailId: email.id, error: String(error).slice(0, 500) },
        },
      });
      result.failed++;
    }
  }

  return result;
}

/** Atomically consume one send from today's quota. False = cap reached. */
async function tryConsumeQuota(userId: string, limit: number): Promise<boolean> {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  return prisma.$transaction(async (tx) => {
    const quota = await tx.emailQuota.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, sentCount: 0 },
      update: {},
    });
    if (quota.sentCount >= limit) return false;
    // Guarded increment — no-ops if a concurrent send already hit the cap.
    const updated = await tx.emailQuota.updateMany({
      where: { id: quota.id, sentCount: { lt: limit } },
      data: { sentCount: { increment: 1 } },
    });
    return updated.count === 1;
  });
}

/** Gmail id of the first sent email of an application (for reply threading). */
async function originalMessageId(applicationId: string | null): Promise<string | null> {
  if (!applicationId) return null;
  const first = await prisma.email.findFirst({
    where: { applicationId, status: "SENT", gmailMessageId: { not: null } },
    orderBy: { sentAt: "asc" },
    select: { gmailMessageId: true },
  });
  return first?.gmailMessageId ?? null;
}

/** Today's quota usage for the dashboard. */
export async function getQuotaStatus(userId: string) {
  const s = await getSchedulingSettings(userId);
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const quota = await prisma.emailQuota.findUnique({
    where: { userId_date: { userId, date } },
  });
  return {
    used: quota?.sentCount ?? 0,
    limit: s.dailyEmailLimit,
    remaining: Math.max(0, s.dailyEmailLimit - (quota?.sentCount ?? 0)),
  };
}
