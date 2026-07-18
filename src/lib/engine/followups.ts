import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { generateEmail } from "@/lib/ai/email-generator";
import { scheduleEmail } from "@/lib/email/scheduler";

/**
 * Follow-up Engine — runs daily per user.
 *
 * For every SENT application with no reply after `followUpAfterDays`
 * (then `secondFollowUpDays` after the first follow-up, up to `maxFollowUps`):
 *   → generate a follow-up DRAFT + notify the user.
 *   → auto-queue ONLY when the user explicitly enabled autoSendFollowUps.
 *
 * Applications past the final follow-up window with silence are marked GHOSTED.
 */

export interface FollowUpResult {
  draftsCreated: number;
  autoQueued: number;
  markedGhosted: number;
}

export async function runFollowUps(userId: string): Promise<FollowUpResult> {
  const settings = await prisma.setting.findUnique({ where: { userId } });
  const afterDays = settings?.followUpAfterDays ?? 5;
  const secondDays = settings?.secondFollowUpDays ?? 7;
  const maxFollowUps = Math.min(settings?.maxFollowUps ?? 2, 3);
  const autoSend = settings?.autoSendFollowUps ?? false;

  const result: FollowUpResult = {
    draftsCreated: 0,
    autoQueued: 0,
    markedGhosted: 0,
  };

  // Applications that were sent and never got a reply.
  const candidates = await prisma.application.findMany({
    where: {
      userId,
      status: "SENT",
      appliedAt: { not: null },
    },
    include: {
      job: true,
      company: true,
      emails: {
        where: { direction: "OUTBOUND", status: "SENT" },
        orderBy: { sentAt: "asc" },
      },
    },
  });

  const now = new Date();

  for (const app of candidates) {
    const lastContact = app.lastContactAt ?? app.appliedAt!;
    const dueAt =
      app.followUpCount === 0
        ? addDays(lastContact, afterDays)
        : addDays(lastContact, secondDays);

    if (app.followUpCount >= maxFollowUps) {
      // Final follow-up long silent → ghosted after one more window.
      if (now > addDays(lastContact, secondDays * 2)) {
        await prisma.application.update({
          where: { id: app.id },
          data: { status: "GHOSTED", nextFollowUpDue: null },
        });
        result.markedGhosted++;
      }
      continue;
    }

    if (now < dueAt) {
      if (!app.nextFollowUpDue || app.nextFollowUpDue.getTime() !== dueAt.getTime()) {
        await prisma.application.update({
          where: { id: app.id },
          data: { nextFollowUpDue: dueAt },
        });
      }
      continue;
    }

    // Skip if an unsent follow-up draft already exists for this application.
    const pendingDraft = await prisma.email.findFirst({
      where: {
        applicationId: app.id,
        type: "FOLLOW_UP",
        status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] },
      },
    });
    if (pendingDraft) continue;

    const original = app.emails[0];
    if (!original || !app.resumeId) continue;

    const daysSinceSent = Math.floor(
      (now.getTime() - (original.sentAt?.getTime() ?? now.getTime())) / 86_400_000
    );

    try {
      const generated = await generateEmail({
        userId,
        type: "FOLLOW_UP",
        jobId: app.jobId,
        resumeId: app.resumeId,
        recruiterName: original.toName,
        companyName: app.company?.name,
        followUpContext: {
          originalSubject: original.subject,
          daysSinceSent,
          followUpNumber: app.followUpCount + 1,
        },
      });

      const email = await prisma.email.create({
        data: {
          userId,
          applicationId: app.id,
          recruiterId: app.recruiterId,
          type: "FOLLOW_UP",
          status: "PENDING_APPROVAL",
          toEmail: original.toEmail,
          toName: original.toName,
          subject: generated.subject.startsWith("Re:")
            ? generated.subject
            : `Re: ${original.subject}`,
          bodyText: generated.body,
          attachResume: false,
          contentHash: generated.contentHash,
          gmailThreadId: original.gmailThreadId,
        },
      });
      result.draftsCreated++;

      const followUpNumber = app.followUpCount + 1;
      await prisma.application.update({
        where: { id: app.id },
        data: {
          followUpCount: followUpNumber,
          firstFollowUpAt: followUpNumber === 1 ? now : app.firstFollowUpAt,
          secondFollowUpAt: followUpNumber === 2 ? now : app.secondFollowUpAt,
          nextFollowUpDue: null,
        },
      });

      if (autoSend) {
        await prisma.email.update({
          where: { id: email.id },
          data: { status: "APPROVED" },
        });
        await scheduleEmail(userId, email.id);
        result.autoQueued++;
      } else {
        await prisma.notification.create({
          data: {
            userId,
            type: "FOLLOW_UP_DUE",
            title: `Follow-up drafted for ${app.company?.name ?? app.job.title}`,
            body: `${daysSinceSent} days without a reply — review and approve the draft.`,
            link: `/emails?status=PENDING_APPROVAL`,
          },
        });
      }
    } catch (error) {
      await prisma.activityLog.create({
        data: {
          userId,
          level: "WARN",
          event: "followup.generation_failed",
          message: `Follow-up generation failed for application ${app.id}`,
          metadata: { error: String(error).slice(0, 500) },
        },
      });
    }
  }

  return result;
}
