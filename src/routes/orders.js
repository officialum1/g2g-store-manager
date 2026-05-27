const express = require("express");
const Order = require("../db/models/Order");
const Delivery = require("../db/models/Delivery");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit || "100", 10);
    const orders = await Order.list(limit);
    res.json({
      data: orders
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId", async (req, res, next) => {
  try {
    const [order, deliveries] = await Promise.all([
      Order.findByOrderId(req.params.orderId),
      Delivery.listByOrderId(req.params.orderId)
    ]);

    if (!order) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    res.json({
      data: {
        order,
        deliveries
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
