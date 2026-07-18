import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * BullMQ wiring — used only by the worker process (and optionally by API
 * routes to enqueue ad-hoc work). The Vercel deployment works without Redis:
 * cron routes call the same engine functions inline.
 */

export const QUEUE_NAMES = {
  discovery: "discovery",   // job discovery ticks
  inbox: "inbox",           // gmail sync ticks
  dispatch: "dispatch",     // due-email dispatch ticks
  daily: "daily",           // follow-ups + analytics rollup
  parse: "parse",           // ad-hoc: resume parsing, job analysis
} as const;

let connection: IORedis | null = null;

export function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,
    });
  }
  return connection;
}

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
    queues.set(name, queue);
  }
  return queue;
}
