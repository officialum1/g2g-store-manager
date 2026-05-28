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
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(canonical)
    .digest("hex");

  console.log("[G2G] canonical string:", canonical);
  console.log("[G2G] signature:", signature.slice(0, 10) + "...");

  return {
    "g2g-api-key": apiKey,
    "g2g-userid": userId,
    "g2g-signature": signature,
    "g2g-timestamp": timestamp,
    "Content-Type": "application/json"
  };
}

async function getOrderById(orderId) {
  const endpoints = [
    `/${API_VERSION}/order/${orderId}`,
    `/${API_VERSION}/orders/${orderId}`
  ];

  for (const urlPath of endpoints) {
    try {
      const res = await axios.get(BASE_URL + urlPath, {
        headers: buildHeaders(urlPath)
      });

      console.log("[G2G] getOrderById success at:", urlPath, res.status);
      console.log("[G2G] FULL order response:", JSON.stringify(res.data));

      return res.data?.payload;
    } catch (err) {
      console.error(
        "[G2G] getOrderById failed at:",
        urlPath,
        err.response?.status,
        JSON.stringify(err.response?.data)
      );
    }
  }

  throw new Error("Order not found on G2G - check order ID format");
}

async function getDeliveries(orderId) {
  const urlPath = `/${API_VERSION}/orders/${orderId}/deliveries`;
  const url = BASE_URL + urlPath;

  try {
    const res = await axios.get(url, {
      headers: buildHeaders(urlPath)
    });

    console.log("[G2G] getDeliveries full response:", JSON.stringify(res.data));

    return res.data?.payload;
  } catch (err) {
    console.error(
      "[G2G] getDeliveries error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );

    return null;
  }
}

async function getStoreSettings() {
  const urlPath = `/${API_VERSION}/store`;
  const url = BASE_URL + urlPath;

  try {
    const res = await axios.get(url, {
      headers: buildHeaders(urlPath)
    });

    console.log("[G2G] getStore response:", res.status);

    return res.data?.payload;
  } catch (err) {
    console.error(
      "[G2G] getStore error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw new Error(
      `getStore failed: ${err.response?.status} ${JSON.stringify(
        err.response?.data
      )}`
    );
  }
}

async function deliverCode(orderId, deliveryId, codes) {
  const urlPath = `/${API_VERSION}/order/${orderId}/delivery/${deliveryId}/code`;
  const body = {
    code_list: codes.map((code) => ({
      code
    }))
  };

  try {
    const res = await axios.post(BASE_URL + urlPath, body, {
      headers: buildHeaders(urlPath)
    });

    return res.data;
  } catch (err) {
    console.error("[G2G] deliverCode error:", err.response?.data);
    throw new Error(
      `deliverCode failed: ${err.response?.status} ${JSON.stringify(
        err.response?.data
      )}`
    );
  }
}

async function patchDelivery(orderId, deliveryId, status = "delivered") {
  const urlPath = `/${API_VERSION}/order/${orderId}/delivery/${deliveryId}`;
  const body = {
    status
  };

  try {
    const res = await axios.patch(BASE_URL + urlPath, body, {
      headers: buildHeaders(urlPath)
    });

    return res.data;
  } catch (err) {
    console.error("[G2G] patchDelivery error:", err.response?.data);
    throw new Error(
      `patchDelivery failed: ${err.response?.status} ${JSON.stringify(
        err.response?.data
      )}`
    );
  }
}

async function postDelivery(orderId, codes, deliveryId = null) {
  if (!deliveryId) {
    throw new Error("postDelivery failed: deliveryId is required for G2G v2 delivery.");
  }

  const codeValues = codes.map((item) => {
    if (item && typeof item === "object") {
      return item.code || item.content || JSON.stringify(item);
    }

    return String(item);
  });

  return deliverCode(orderId, deliveryId, codeValues);
}

module.exports = {
  getOrderById,
  getDeliveries,
  getStoreSettings,
  deliverCode,
  patchDelivery,
  postDelivery,
  buildHeaders
};
