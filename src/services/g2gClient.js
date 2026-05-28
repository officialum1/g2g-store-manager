const crypto = require("crypto");
const axios = require("axios");

function buildHeaders(apiKey, apiSecret, body = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = Object.keys(body).length > 0 ? JSON.stringify(body) : "";
  const stringToSign = timestamp + apiKey + payload;
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(stringToSign)
    .digest("hex");

  return {
    "g2g-signature": signature,
    "g2g-timestamp": timestamp,
    "Content-Type": "application/json"
  };
}

async function getOrderById(orderId) {
  const { G2G_API_KEY, G2G_API_SECRET } = process.env;
  const url = `https://open-api.g2g.com/v2/order/${encodeURIComponent(orderId)}`;
  const headers = buildHeaders(G2G_API_KEY, G2G_API_SECRET);

  console.log("[G2G] GET", url);

  try {
    const res = await axios.get(url, {
      headers
    });

    console.log(
      "[G2G] Response:",
      res.status,
      JSON.stringify(res.data).slice(0, 300)
    );

    return res.data?.payload;
  } catch (err) {
    console.error(
      "[G2G] Error:",
      err.response?.status,
      JSON.stringify(err.response?.data)
    );
    throw new Error(
      `getOrderById failed: ${err.response?.status} ${JSON.stringify(
        err.response?.data
      )}`
    );
  }
}

async function deliverCode(orderId, deliveryId, codes) {
  const { G2G_API_KEY, G2G_API_SECRET } = process.env;
  const body = {
    code_list: codes.map((code) => ({
      code
    }))
  };
  const url = `https://open-api.g2g.com/v2/order/${encodeURIComponent(
    orderId
  )}/delivery/${encodeURIComponent(deliveryId)}/code`;
  const headers = buildHeaders(G2G_API_KEY, G2G_API_SECRET, body);

  console.log("[G2G] POST deliver", url);

  try {
    const res = await axios.post(url, body, {
      headers
    });

    return res.data;
  } catch (err) {
    console.error("[G2G] Deliver error:", err.response?.data);
    throw new Error(
      `deliverCode failed: ${err.response?.status} ${JSON.stringify(
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
  deliverCode,
  postDelivery,
  buildHeaders
};
