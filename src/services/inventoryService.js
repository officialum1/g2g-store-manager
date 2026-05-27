const Inventory = require("../db/models/Inventory");

async function getNextAvailableItem(offerId, orderId = null) {
  try {
    const reservedItem = await Inventory.reserveNextAvailable(offerId, orderId);

    if (!reservedItem) {
      throw new Error(`No inventory available for offer ${offerId}.`);
    }

    return reservedItem;
  } catch (error) {
    throw new Error(`getNextAvailableItem failed: ${error.message}`);
  }
}

async function markItemDelivered(itemId, orderId) {
  try {
    const deliveredItem = await Inventory.markDelivered(itemId, orderId);

    if (!deliveredItem) {
      throw new Error(
        `Inventory item ${itemId} could not be marked as delivered for order ${orderId}.`
      );
    }

    return deliveredItem;
  } catch (error) {
    throw new Error(`markItemDelivered failed: ${error.message}`);
  }
}

module.exports = {
  getNextAvailableItem,
  markItemDelivered
};
