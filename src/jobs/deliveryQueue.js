const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const { config } = require("../config");
const Delivery = require("../db/models/Delivery");
const { processDeliveryJob } = require("../services/deliveryService");

const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null
});

const deliveryQueue = new Queue(config.queue.name, {
  connection: redisConnection
});

let deliveryWorker = null;

function buildTrackingDeliveryId(jobPayload) {
  return jobPayload.delivery_id || `local-${jobPayload.order_id}`;
}

async function enqueueDeliveryJob(jobPayload) {
  const normalizedPayload = {
    ...jobPayload,
    delivery_id: buildTrackingDeliveryId(jobPayload)
  };

  try {
    await Delivery.updateStatus(
      normalizedPayload.delivery_id,
      normalizedPayload.order_id,
      "queued",
      {
        attempts: 0
      }
    );

    return await deliveryQueue.add("deliver-order", normalizedPayload, {
      jobId: `${normalizedPayload.order_id}:${normalizedPayload.delivery_id}`,
      attempts: config.queue.attempts,
      backoff: {
        type: "exponential",
        delay: config.queue.backoffMs
      },
      removeOnComplete: 200,
      removeOnFail: 200
    });
  } catch (error) {
    throw new Error(
      `Failed to enqueue delivery job for order ${jobPayload.order_id}: ${error.message}`
    );
  }
}

function startDeliveryWorker() {
  if (deliveryWorker) {
    return deliveryWorker;
  }

  deliveryWorker = new Worker(
    config.queue.name,
    async (job) => {
      const attempts = job.attemptsMade + 1;
      const deliveryId = buildTrackingDeliveryId(job.data);

      try {
        const result = await processDeliveryJob(
          {
            ...job.data,
            delivery_id: deliveryId
          },
          attempts
        );

        return result;
      } catch (error) {
        await Delivery.updateStatus(deliveryId, job.data.order_id, "failed", {
          attempts
        });
        console.error(
          `[ALERT] Delivery job failed for order ${job.data.order_id}: ${error.message}`
        );
        throw error;
      }
    },
    {
      connection: redisConnection
    }
  );

  deliveryWorker.on("failed", (job, error) => {
    console.error(
      `[ALERT] Worker failed job ${job?.id || "unknown"} for order ${
        job?.data?.order_id || "unknown"
      }: ${error.message}`
    );
  });

  deliveryWorker.on("error", (error) => {
    console.error("[ALERT] Delivery worker error:", error);
  });

  return deliveryWorker;
}

module.exports = {
  deliveryQueue,
  enqueueDeliveryJob,
  startDeliveryWorker
};
