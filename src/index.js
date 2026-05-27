const express = require("express");
const { config, validateConfig } = require("./config");
const { closeDatabase, initializeDatabase } = require("./db");
const { startDeliveryWorker } = require("./jobs/deliveryQueue");
const { startOrderPoller } = require("./jobs/orderPoller");
const deliveryRouter = require("./routes/delivery");
const ordersRouter = require("./routes/orders");
const webhookRouter = require("./routes/webhook");

const app = express();

app.disable("x-powered-by");
app.use("/webhook", webhookRouter);
app.use(express.json({ limit: "1mb" }));
app.use("/orders", ordersRouter);
app.use("/delivery", deliveryRouter);

app.use((error, req, res, next) => {
  console.error("Unhandled application error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: "Internal server error."
  });
});

async function bootstrap() {
  validateConfig();
  await initializeDatabase();
  startDeliveryWorker();
  startOrderPoller();

  const server = app.listen(config.port, () => {
    console.log(`G2G Store Manager listening on port ${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down...`);

    server.close(async () => {
      try {
        await closeDatabase();
      } catch (error) {
        console.error("Error while closing database pool:", error);
      } finally {
        process.exit(0);
      }
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  return server;
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error("Failed to bootstrap G2G Store Manager:", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  bootstrap
};
