const express = require("express");
const Delivery = require("../db/models/Delivery");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    if (req.query.order_id) {
      const deliveries = await Delivery.listByOrderId(req.query.order_id);
      return res.json({
        data: deliveries
      });
    }

    const limit = Number.parseInt(req.query.limit || "100", 10);
    const deliveries = await Delivery.list(limit);

    return res.json({
      data: deliveries
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:deliveryId", async (req, res, next) => {
  try {
    const delivery = await Delivery.findByDeliveryId(req.params.deliveryId);

    if (!delivery) {
      return res.status(404).json({
        error: "Delivery not found."
      });
    }

    return res.json({
      data: delivery
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
