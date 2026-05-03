import { Queue, Worker, Job, Processor } from 'bullmq';
import { IS_STB } from './stb-config';

const REDIS_URL = process.env.REDIS_URL || '';

// ─────────────────────────────────────────────────────────────────────
// QUEUE SINGLETON
// ─────────────────────────────────────────────────────────────────────

interface QueueConnection {
  connection?: {
    host?: string;
    port?: number;
    password?: string;
    url?: string;
  };
}

const queueOpts: QueueConnection = REDIS_URL
  ? { connection: typeof REDIS_URL === 'string' && REDIS_URL.startsWith('rediss://')
      ? { url: REDIS_URL }
      : {} }
  : {};

// In-memory fallback job store when Redis is unavailable
interface PendingJob {
  id: string;
  name: string;
  data: any;
  attempts: number;
  maxAttempts: number;
  backoff: number;
  createdAt: number;
  processAt: number;
}

const fallbackQueue = new Map<string, PendingJob>();
const MAX_FALLBACK_JOBS = IS_STB ? 200 : 2000;
const FALLBACK_PROCESS_INTERVAL = 5000;

type JobProcessor = (job: Job) => Promise<any>;
const registeredProcessors = new Map<string, JobProcessor>();

let queueInstance: Queue | null = null;
let workerInstance: Worker | null = null;
let useFallback = !REDIS_URL;

/**
 * Initialize a named job queue
 */
export function getQueue(queueName: string = 'default'): Queue | null {
  if (useFallback || !REDIS_URL) return null;

  if (!queueInstance) {
    try {
      queueInstance = new Queue(queueName, {
        connection: typeof REDIS_URL === 'string' && REDIS_URL.startsWith('rediss://')
          ? { url: REDIS_URL } as any
          : undefined,
        defaultJobOptions: {
          removeOnComplete: { count: IS_STB ? 50 : 200 },
          removeOnFail: { count: IS_STB ? 20 : 100 },
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      });
    } catch (err) {
      console.warn('[JobQueue] Redis unavailable, using in-memory fallback');
      useFallback = true;
      return null;
    }
  }

  return queueInstance;
}

/**
 * Register a processor for a job type
 */
export function registerProcessor(jobName: string, processor: JobProcessor): void {
  registeredProcessors.set(jobName, processor);

  // If using BullMQ, set up worker
  if (!useFallback && REDIS_URL && !workerInstance) {
    try {
      workerInstance = new Worker(
        'default',
        async (job: Job) => {
          const proc = registeredProcessors.get(job.name);
          if (!proc) throw new Error(`No processor for job: ${job.name}`);
          return proc(job);
        },
        {
          connection: typeof REDIS_URL === 'string' && REDIS_URL.startsWith('rediss://')
            ? { url: REDIS_URL } as any
            : undefined,
          concurrency: IS_STB ? 2 : 5,
          limiter: {
            max: IS_STB ? 10 : 50,
            duration: 1000,
          },
        }
      );

      workerInstance.on('failed', (job, err) => {
        if (job) console.error(`[JobQueue] Job ${job.id} (${job.name}) failed:`, err.message);
      });

      workerInstance.on('completed', (job) => {
        if (job) console.debug(`[JobQueue] Job ${job.id} (${job.name}) completed`);
      });
    } catch (err) {
      console.warn('[JobQueue] Worker failed, using fallback');
      useFallback = true;
    }
  }
}

/**
 * Enqueue a job (works with or without Redis)
 */
export async function enqueueJob(
  jobName: string,
  data: any,
  options?: {
    delay?: number;
    priority?: number;
    jobId?: string;
    attempts?: number;
  }
): Promise<string> {
  const id = options?.jobId || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // BullMQ path
  if (!useFallback) {
    const queue = getQueue();
    if (queue) {
      await queue.add(jobName, data, {
        jobId: id,
        delay: options?.delay,
        priority: options?.priority,
        attempts: options?.attempts || 3,
      });
      return id;
    }
  }

  // Fallback: in-memory queue
  if (fallbackQueue.size >= MAX_FALLBACK_JOBS) {
    // Remove oldest job
    const oldest = fallbackQueue.keys().next().value;
    if (oldest) fallbackQueue.delete(oldest);
  }

  fallbackQueue.set(id, {
    id,
    name: jobName,
    data,
    attempts: 0,
    maxAttempts: options?.attempts || 3,
    backoff: 2000,
    createdAt: Date.now(),
    processAt: Date.now() + (options?.delay || 0),
  });

  return id;
}

/**
 * Process fallback queue (called periodically)
 */
export async function processFallbackQueue(): Promise<void> {
  if (!useFallback) return;

  const now = Date.now();
  for (const [id, job] of fallbackQueue) {
    if (now < job.processAt) continue;

    const processor = registeredProcessors.get(job.name);
    if (!processor) {
      console.warn(`[JobQueue] No processor for fallback job: ${job.name}`);
      fallbackQueue.delete(id);
      continue;
    }

    try {
      // Create a mock Job object
      const mockJob = {
        id: job.id,
        name: job.name,
        data: job.data,
        attemptsMade: job.attempts,
      } as Job;

      await processor(mockJob);
      fallbackQueue.delete(id);
    } catch (err) {
      job.attempts++;
      if (job.attempts >= job.maxAttempts) {
        console.error(`[JobQueue] Fallback job ${id} failed after ${job.attempts} attempts`);
        fallbackQueue.delete(id);
      } else {
        job.processAt = now + job.backoff * Math.pow(2, job.attempts);
        fallbackQueue.set(id, job);
      }
    }
  }
}

// Process fallback queue every 5 seconds
setInterval(processFallbackQueue, FALLBACK_PROCESS_INTERVAL);

/**
 * Get queue health status
 */
export function getQueueStatus(): {
  redis: boolean;
  fallbackJobs: number;
  registeredProcessors: string[];
} {
  return {
    redis: !useFallback && !!REDIS_URL,
    fallbackJobs: fallbackQueue.size,
    registeredProcessors: Array.from(registeredProcessors.keys()),
  };
}

// Clean up on process exit
process.on('SIGTERM', async () => {
  if (workerInstance) await workerInstance.close();
  if (queueInstance) await queueInstance.close();
});
