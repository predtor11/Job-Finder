import { prisma } from "@/lib/prisma";
import { analyzeJobFit, persistPostingContacts } from "@/lib/ai/job-analyzer";
import { generateCoverLetter } from "@/lib/ai/cover-letter";
import { generateEmail } from "@/lib/ai/email-generator";
import { scheduleEmail } from "@/lib/email/scheduler";
import { discoverRecruitersForJob } from "@/lib/recruiters/discovery";
import { extractEmails } from "@/lib/utils";

/**
 * Application Pipeline
 *
 *   Job ─▶ analyze ─▶ create application (best resume) ─▶ cover letter
 *       ─▶ application email draft ─▶ approval queue ─▶ schedule ─▶ send
 *
 * Approval rules (Settings.sendMode):
 *   DRAFT     — everything stays DRAFT; nothing can be queued
 *   MANUAL    — user approves each email (approveEmail)
 *   AUTO      — application emails auto-approved when matchScore ≥ threshold
 *   SCHEDULED — user approves; send happens at their chosen time
 *
 * Cold outreach (COLD_OUTREACH type) ALWAYS requires manual approval,
 * regardless of mode — enforced here, not in the UI.
 */

export async function createApplication(params: {
  userId: string;
  jobId: string;
  resumeId?: string;       // manual override; defaults to analyzer's best pick
  recruiterId?: string;    // optional targeted contact
  toEmailOverride?: string;
  /** Crawl the company's public pages for contacts when the posting has none.
   *  On for interactive applies; off for the bulk auto-draft pipeline. */
  deepContactSearch?: boolean;
}): Promise<{ applicationId: string; emailId: string | null }> {
  const { userId, jobId } = params;

  const existing = await prisma.application.findUnique({
    where: { userId_jobId: { userId, jobId } },
  });
  if (existing) {
    throw new Error("An application for this job already exists.");
  }

  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { company: true, analysis: true },
  });

  // Ensure analysis exists (needed for resume pick + match score).
  let analysis = job.analysis;
  if (!analysis) {
    analysis = await analyzeJobFit(userId, jobId);
  }

  const resumeId =
    params.resumeId ??
    analysis?.bestResumeId ??
    (
      await prisma.resume.findFirst({
        where: { userId, parseStatus: "PARSED" },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    )?.id;
  if (!resumeId) {
    throw new Error("Upload and parse at least one resume before applying.");
  }

  const recruiter = params.recruiterId
    ? await prisma.recruiter.findFirst({
        where: { id: params.recruiterId, userId },
      })
    : null;

  const application = await prisma.application.create({
    data: {
      userId,
      jobId,
      companyId: job.companyId,
      recruiterId: recruiter?.id,
      resumeId,
      status: "DRAFT",
      matchScore: analysis?.matchScore,
    },
  });

  await prisma.applicationEvent.createMany({
    data: [
      {
        applicationId: application.id,
        type: "JOB_FOUND",
        title: `Job found via ${job.source}`,
        payload: { jobId },
      },
      {
        applicationId: application.id,
        type: "DRAFT_CREATED",
        title: "Application draft created",
      },
    ],
  });

  // Generate content. Failures leave a valid DRAFT the user can retry.
  let emailId: string | null = null;
  try {
    const coverLetter = await generateCoverLetter({
      userId,
      jobId,
      resumeId,
      applicationId: application.id,
    });

    // Recipient resolution, most-specific first: explicit override → chosen
    // recruiter → any contact tied to this job → contact named in the
    // analysis → an email printed in the posting text itself.
    await persistPostingContacts(userId, jobId);
    let jobRecruiter = await prisma.recruiter.findFirst({
      where: { userId, jobId, email: { not: null } },
      orderBy: { confidence: "desc" },
    });

    // Last resort on interactive applies: scan the company's public pages.
    if (
      !jobRecruiter &&
      !params.toEmailOverride &&
      !recruiter?.email &&
      params.deepContactSearch
    ) {
      try {
        await discoverRecruitersForJob(userId, jobId);
        jobRecruiter = await prisma.recruiter.findFirst({
          where: { userId, jobId, email: { not: null } },
          orderBy: { confidence: "desc" },
        });
      } catch {
        // Contact search is best-effort — the draft still gets created.
      }
    }

    const toEmail =
      params.toEmailOverride ??
      recruiter?.email ??
      jobRecruiter?.email ??
      (job.analysis?.hiringContact as { email?: string } | null)?.email ??
      extractEmails(job.description ?? "")[0];

    if (toEmail) {
      const generated = await generateEmail({
        userId,
        type: "APPLICATION",
        jobId,
        resumeId,
        recruiterName: recruiter?.name,
        recruiterRole: recruiter?.role,
        companyName: job.company?.name,
        coverLetterExcerpt: coverLetter.content,
      });

      const email = await prisma.email.create({
        data: {
          userId,
          applicationId: application.id,
          recruiterId: recruiter?.id,
          templateId: generated.templateId,
          type: "APPLICATION",
          status: "PENDING_APPROVAL",
          toEmail,
          toName: recruiter?.name,
          subject: generated.subject,
          bodyText: generated.body,
          abVariant: generated.abVariant,
          contentHash: generated.contentHash,
        },
      });
      emailId = email.id;

      await prisma.application.update({
        where: { id: application.id },
        data: { status: "PENDING_APPROVAL" },
      });

      // AUTO mode: auto-approve high-match application emails (never cold outreach).
      const settings = await prisma.setting.findUnique({ where: { userId } });
      if (
        settings?.sendMode === "AUTO" &&
        (analysis?.matchScore ?? 0) >= (settings.autoApproveThreshold ?? 80)
      ) {
        await approveEmail(userId, email.id);
      }
    }
  } catch (error) {
    await prisma.activityLog.create({
      data: {
        userId,
        level: "WARN",
        event: "pipeline.generation_failed",
        message: `Draft content generation failed for application ${application.id}`,
        metadata: { error: String(error).slice(0, 500) },
      },
    });
  }

  return { applicationId: application.id, emailId };
}

/** Draft a cold outreach email to a recruiter. ALWAYS lands in the approval queue. */
export async function createColdOutreach(params: {
  userId: string;
  recruiterId: string;
  jobId?: string;
  resumeId?: string;
}): Promise<{ emailId: string }> {
  const { userId } = params;
  const recruiter = await prisma.recruiter.findFirstOrThrow({
    where: { id: params.recruiterId, userId },
    include: { company: true },
  });
  if (!recruiter.email) {
    throw new Error(
      "This contact has no publicly listed email address. Cold outreach requires one."
    );
  }

  const resumeId =
    params.resumeId ??
    (
      await prisma.resume.findFirst({
        where: { userId, parseStatus: "PARSED" },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    )?.id;
  if (!resumeId) throw new Error("Upload and parse a resume first.");

  const generated = await generateEmail({
    userId,
    type: "COLD_OUTREACH",
    jobId: params.jobId,
    resumeId,
    recruiterName: recruiter.name,
    recruiterRole: recruiter.role,
    companyName: recruiter.company?.name,
  });

  const email = await prisma.email.create({
    data: {
      userId,
      recruiterId: recruiter.id,
      templateId: generated.templateId,
      type: "COLD_OUTREACH",
      status: "PENDING_APPROVAL", // always — no mode bypasses this
      toEmail: recruiter.email,
      toName: recruiter.name,
      subject: generated.subject,
      bodyText: generated.body,
      abVariant: generated.abVariant,
      contentHash: generated.contentHash,
    },
  });

  return { emailId: email.id };
}

/**
 * Approve an email → schedule it. Server-side enforcement of send rules:
 *  • DRAFT mode never queues anything.
 *  • scheduledFor (SCHEDULED mode / manual pick) is honored if in the future.
 */
export async function approveEmail(
  userId: string,
  emailId: string,
  scheduledFor?: Date
): Promise<{ scheduledAt: Date }> {
  const email = await prisma.email.findFirstOrThrow({
    where: { id: emailId, userId },
  });
  if (!["DRAFT", "PENDING_APPROVAL"].includes(email.status)) {
    throw new Error(`Email is ${email.status} — only drafts can be approved.`);
  }

  const settings = await prisma.setting.findUnique({ where: { userId } });
  if (settings?.sendMode === "DRAFT") {
    throw new Error(
      "Send mode is set to Draft-only. Change it in Settings to enable sending."
    );
  }

  await prisma.email.update({
    where: { id: email.id },
    data: { status: "APPROVED" },
  });

  let scheduledAt: Date;
  if (scheduledFor && scheduledFor.getTime() > Date.now()) {
    scheduledAt = scheduledFor;
    await prisma.email.update({
      where: { id: email.id },
      data: { status: "QUEUED", scheduledAt },
    });
  } else {
    scheduledAt = await scheduleEmail(userId, email.id);
  }

  if (email.applicationId) {
    await prisma.application.update({
      where: { id: email.applicationId },
      data: { status: "SCHEDULED" },
    });
    await prisma.applicationEvent.create({
      data: {
        applicationId: email.applicationId,
        type: "APPROVED",
        title: `Email approved — sending ~${scheduledAt.toLocaleString()}`,
        payload: { emailId: email.id },
      },
    });
  }

  return { scheduledAt };
}

/** Cancel a queued/pending email back to DRAFT. */
export async function cancelEmail(userId: string, emailId: string) {
  const email = await prisma.email.findFirstOrThrow({
    where: { id: emailId, userId },
  });
  if (!["PENDING_APPROVAL", "APPROVED", "QUEUED"].includes(email.status)) {
    throw new Error(`Cannot cancel an email in ${email.status} state.`);
  }
  await prisma.email.update({
    where: { id: email.id },
    data: { status: "DRAFT", scheduledAt: null },
  });
  if (email.applicationId) {
    await prisma.application.update({
      where: { id: email.applicationId },
      data: { status: "PENDING_APPROVAL" },
    });
  }
}
