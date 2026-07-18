import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth, parseBody } from "@/lib/api";
import { encrypt, maskSecret, decrypt } from "@/lib/crypto";

/** GET /api/settings — settings + connected Gmail (secrets masked). */
export const GET = withAuth(async ({ userId }) => {
  const [settings, gmailAccounts, profile] = await Promise.all([
    prisma.setting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    }),
    prisma.gmailAccount.findMany({
      where: { userId },
      select: {
        id: true, email: true, status: true, lastSyncAt: true, createdAt: true,
      },
    }),
    prisma.profile.findUnique({ where: { id: userId } }),
  ]);

  return NextResponse.json({
    settings: {
      ...settings,
      geminiApiKeyEnc: undefined,
      geminiApiKeyMasked: settings.geminiApiKeyEnc
        ? maskSecret(decrypt(settings.geminiApiKeyEnc))
        : null,
    },
    gmailAccounts,
    profile,
  });
});

const patchSchema = z.object({
  geminiApiKey: z.string().min(10).nullish(),
  aiFastModel: z.string().optional(),
  aiSmartModel: z.string().optional(),
  aiDailyBudget: z.number().int().min(1).max(2000).optional(),
  sendMode: z.enum(["DRAFT", "MANUAL", "AUTO", "SCHEDULED"]).optional(),
  dailyEmailLimit: z.number().int().min(1).max(50).optional(),
  minSendGapMinutes: z.number().int().min(1).max(240).optional(),
  sendJitterMinutes: z.number().int().min(0).max(120).optional(),
  autoApproveThreshold: z.number().int().min(0).max(100).optional(),
  emailSignature: z.string().max(2000).nullish(),
  followUpAfterDays: z.number().int().min(1).max(60).optional(),
  secondFollowUpDays: z.number().int().min(1).max(60).optional(),
  maxFollowUps: z.number().int().min(0).max(3).optional(),
  autoSendFollowUps: z.boolean().optional(),
  preferredRoles: z.array(z.string()).max(20).optional(),
  preferredLocations: z.array(z.string()).max(20).optional(),
  preferredTech: z.array(z.string()).max(30).optional(),
  timezone: z.string().optional(),
  workingHoursStart: z.number().int().min(0).max(23).optional(),
  workingHoursEnd: z.number().int().min(1).max(24).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).optional(),
  jobSources: z.record(z.string(), z.unknown()).optional(),
  discoveryInterval: z.number().int().min(1).max(24).optional(),
});

/** PATCH /api/settings */
export const PATCH = withAuth(async ({ request, userId }) => {
  const body = await parseBody(request, patchSchema);
  const { geminiApiKey, jobSources, ...rest } = body;

  if (
    rest.workingHoursStart !== undefined &&
    rest.workingHoursEnd !== undefined &&
    rest.workingHoursEnd <= rest.workingHoursStart
  ) {
    return NextResponse.json(
      { error: "Working hours end must be after start." },
      { status: 400 }
    );
  }

  const settings = await prisma.setting.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  await prisma.setting.update({
    where: { id: settings.id },
    data: {
      ...rest,
      ...(jobSources !== undefined
        ? { jobSources: jobSources as object }
        : {}),
      ...(geminiApiKey === null
        ? { geminiApiKeyEnc: null }
        : geminiApiKey
          ? { geminiApiKeyEnc: encrypt(geminiApiKey) }
          : {}),
    },
  });

  return NextResponse.json({ ok: true });
});
