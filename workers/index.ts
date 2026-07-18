/**
 * Job Finder — background worker process.
 *
 * Run with:  npm run worker   (requires REDIS_URL + the same .env as the app)
 *
 * Registers repeatable ticks on BullMQ and processes them with the same engine
 * functions the Vercel cron routes use. Deploy this alongside Redis (Docker,
 * Railway, a VPS…) when you want processing independent of Vercel cron.
 */

import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { Worker, type Job } from "bullmq";
import { QUEUE_NAMES, getQueue, getRedis } from "../src/lib/queue";
import { prisma } from "../src/lib/prisma";
import { runDiscovery } from "../src/lib/engine/discovery";
import { syncInbox } from "../src/lib/engine/inbox";
import { dispatchDueEmails } from "../src/lib/email/scheduler";
import { runFollowUps } from "../src/lib/engine/followups";
import { rollupDailySnapshot } from "../src/lib/engine/analytics";

async function forEachUser(
  task: string,
  fn: (userId: string) => Promise<unknown>
) {
  const users = await prisma.profile.findMany({ select: { id: true } });
  for (const user of users) {
    const started = Date.now();
    try {
      const result = await fn(user.id);
      console.log(
        `[${task}] user=${user.id} ok in ${Date.now() - started}ms`,
        JSON.stringify(result)?.slice(0, 200)
      );
    } catch (error) {
      console.error(`[${task}] user=${user.id} FAILED:`, error);
    }
  }
}

const processors: Record<string, (job: Job) => Promise<void>> = {
  [QUEUE_NAMES.discovery]: async () => {
    await forEachUser("discovery", (userId) => runDiscovery(userId));
  },
  [QUEUE_NAMES.inbox]: async () => {
    const accounts = await prisma.gmailAccount.findMany({
      where: { status: "CONNECTED" },
      select: { userId: true },
      distinct: ["userId"],
    });
    for (const { userId } of accounts) {
      try {
        const result = await syncInbox(userId);
        console.log(`[inbox] user=${userId}`, JSON.stringify(result).slice(0, 200));
      } catch (error) {
        console.error(`[inbox] user=${userId} FAILED:`, error);
      }
    }
  },
  [QUEUE_NAMES.dispatch]: async () => {
    const due = await prisma.email.groupBy({
      by: ["userId"],
      where: { status: "QUEUED", scheduledAt: { lte: new Date() } },
    });
    for (const { userId } of due) {
      try {
        const result = await dispatchDueEmails(userId);
        console.log(`[dispatch] user=${userId}`, JSON.stringify(result));
      } catch (error) {
        console.error(`[dispatch] user=${userId} FAILED:`, error);
      }
    }
  },
  [QUEUE_NAMES.daily]: async () => {
    await forEachUser("daily", async (userId) => {
      const followUps = await runFollowUps(userId);
      await rollupDailySnapshot(userId);
      return followUps;
    });
  },
};

async function main() {
  console.log("Job Finder worker starting…");
  getRedis(); // fail fast if Redis is unreachable

  // Repeatable ticks (deduped by jobId, so restarts don't double-register).
  const schedules: Array<{ queue: string; every: number }> = [
    { queue: QUEUE_NAMES.discovery, every: 4 * 60 * 60_000 }, // 4h
    { queue: QUEUE_NAMES.inbox, every: 10 * 60_000 },          // 10m
    { queue: QUEUE_NAMES.dispatch, every: 5 * 60_000 },        // 5m
    { queue: QUEUE_NAMES.daily, every: 24 * 60 * 60_000 },     // 24h
  ];

  for (const { queue, every } of schedules) {
    await getQueue(queue).upsertJobScheduler(
      `${queue}-tick`,
      { every },
      { name: `${queue}-tick` }
    );
  }

  const workers = Object.entries(processors).map(
    ([queueName, processor]) =>
      new Worker(queueName, processor, {
        connection: getRedis(),
        concurrency: 1, // engines already fan out internally per user
      })
  );

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      console.error(`[${worker.name}] job ${job?.id} failed:`, error.message);
    });
  }

  console.log(
    `Worker online — queues: ${workers.map((w) => w.name).join(", ")}`
  );

  const shutdown = async () => {
    console.log("Shutting down…");
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Worker crashed on startup:", error);
  process.exit(1);
});
