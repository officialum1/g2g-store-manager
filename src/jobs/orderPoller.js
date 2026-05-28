let scheduledTask = null;

async function runOrderPoll() {
  console.log(
    "[ORDER POLLER] Skipped: G2G OpenAPI does not provide a bulk order list endpoint. Orders arrive through webhooks."
  );
}

function startOrderPoller() {
  if (scheduledTask) {
    return scheduledTask;
  }

  scheduledTask = {
    stop() {
      scheduledTask = null;
    }
  };

  console.log("[ORDER POLLER] Disabled. Webhook delivery is the source of truth.");

  return scheduledTask;
}

module.exports = {
  startOrderPoller,
  runOrderPoll
};
