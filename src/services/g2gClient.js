const crypto = require("crypto");
const axios = require("axios");

const BASE_URL = "https://open-api.g2g.com";
const API_VERSION = "v2";

function buildHeaders(urlPath) {
  const apiKey = process.env.G2G_API_KEY;
  const apiSecret = process.env.G2G_API_SECRET;
  const userId = process.env.G2G_USER_ID;
  const timestamp = Date.now().toString();
  const canonical = urlPath + apiKey + userId + timestamp;
  const signature = crypto.createHmac("sha256", apiSecret).update(canonical).digest("hex");

  return {
    "g2g-api-key": apiKey,
    "g2g-userid": userId,
    "g2g-signature": signature,
    "g2g-timestamp": timestamp,
    "Content-Type": "application/json"
  };
}

async function getOrderById(orderId) {
  const urlPath = `/${API_VERSION}/orders/${orderId}`;

  try {
    const res = await axios.get(BASE_URL + urlPath, {
      headers: buildHeaders(urlPath)
    });

    return res.data?.payload;
  } catch (err) {
    console.error(
      "[G2G] getOrderById error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw new Error(
      `getOrderById failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`
    );
  }
}

async function getDeliveries(orderId) {
  const urlPath = `/${API_VERSION}/orders/${orderId}/deliveries`;

  try {
    const res = await axios.get(BASE_URL + urlPath, {
      headers: buildHeaders(urlPath)
    });

    console.log("[G2G] getDeliveries:", JSON.stringify(res.data));
    const list = res.data?.payload?.delivery_list || [];

    return {
      list,
      delivery_list: list,
      delivery_id:
        list[0]?.delivery_summary?.delivery_id ||
        list[0]?.delivery_id ||
        list[0]?.id ||
        null
    };
  } catch (err) {
    console.error(
      "[G2G] getDeliveries error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );

    return {
      list: [],
      delivery_id: null
    };
  }
}

async function deliverCode(orderId, deliveryId, codes) {
  const urlPath = `/${API_VERSION}/orders/${orderId}/delivery`;
  const body = {
    delivery_id: deliveryId,
    codes: codes.map((code, index) => ({
      content: code,
      content_type: "text/plain",
      reference_id: `ref_${index + 1}`
    }))
  };

  console.log("[G2G] deliverCode:", urlPath, JSON.stringify(body));

  try {
    const res = await axios.post(BASE_URL + urlPath, body, {
      headers: buildHeaders(urlPath)
    });

    console.log("[G2G] deliverCode response:", res.status, JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    console.error(
      "[G2G] deliverCode error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw new Error(
      `deliverCode failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`
    );
  }
}

async function patchDelivery(orderId, deliveryId, deliveredQty = 1) {
  const urlPath = `/${API_VERSION}/orders/${orderId}/delivery`;
  const parsedDeliveredQty = Number.parseInt(deliveredQty, 10);
  const body = {
    delivery_id: deliveryId,
    delivered_qty: Number.isNaN(parsedDeliveredQty) ? 1 : parsedDeliveredQty
  };

  console.log("[G2G] patchDelivery:", urlPath, JSON.stringify(body));

  try {
    const res = await axios.patch(BASE_URL + urlPath, body, {
      headers: buildHeaders(urlPath)
    });

    console.log("[G2G] patchDelivery response:", res.status, JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    console.error(
      "[G2G] patchDelivery error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw new Error(
      `patchDelivery failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`
    );
  }
}

async function getStoreSettings() {
  const urlPath = `/${API_VERSION}/store`;

  try {
    const res = await axios.get(BASE_URL + urlPath, {
      headers: buildHeaders(urlPath)
    });

    return res.data?.payload;
  } catch (err) {
    throw new Error(`getStore failed: ${err.response?.status}`);
  }
}

async function postDelivery(orderId, codes, deliveryId = null) {
  if (!deliveryId) {
    throw new Error("postDelivery failed: deliveryId is required for G2G v2 delivery.");
  }

  const values = codes.map((item) => {
    if (item && typeof item === "object") {
      return item.code || item.content || JSON.stringify(item);
    }

    return String(item);
  });

  return deliverCode(orderId, deliveryId, values);
}

module.exports = {
  getOrderById,
  getDeliveries,
  deliverCode,
  patchDelivery,
  getStoreSettings,
  buildHeaders,
  postDelivery
};
