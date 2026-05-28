const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = "https://open-api.g2g.com/v1";

function previewJson(value, maxLength = 400) {
  return String(JSON.stringify(value) || "").slice(0, maxLength);
}

function getBodyString(body = "") {
  if (body && typeof body === "object" && Object.keys(body).length > 0) {
    return JSON.stringify(body);
  }

  return "";
}

function generateSignature(timestamp, body = "") {
  const bodyString = getBodyString(body);
  const stringToSign = `${timestamp}:${bodyString}`;

  console.log("[G2G] String to sign:", stringToSign);

  return crypto
    .createHmac("sha256", process.env.G2G_API_SECRET)
    .update(stringToSign)
    .digest("hex");
}

function getHeaders(body = "") {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = generateSignature(timestamp, body);

  return {
    Authorization: `Bearer ${process.env.G2G_API_KEY}`,
    "X-G2G-Signature": signature,
    "X-G2G-Timestamp": timestamp,
    "Content-Type": "application/json"
  };
}

function getSafeHeadersForLog(headers) {
  return {
    ...headers,
    Authorization: headers.Authorization
      ? `${headers.Authorization.slice(0, 20)}...`
      : ""
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function buildApiError(action, err) {
  const status = err.response?.status;
  const responseData = err.response?.data;

  if (status === 401) {
    return new Error("G2G_AUTH_FAILED: Check API Key and Secret");
  }

  if (status === 403) {
    return new Error("G2G_FORBIDDEN: API Key may not have permission");
  }

  if (status === 404) {
    return new Error("G2G_NOT_FOUND: Check API endpoint URL");
  }

  if (status) {
    return new Error(`${action} failed: ${status} ${JSON.stringify(responseData)}`);
  }

  if (err.request) {
    return new Error(`${action} failed: no response received from G2G API`);
  }

  return new Error(`${action} failed: ${err.message}`);
}

async function requestWithRetry(config, action, retryCount = 0) {
  const method = String(config.method || "GET").toUpperCase();
  const url = config.url;
  const body = config.data || "";
  const headers = getHeaders(body);

  console.log("[G2G] Calling:", method, url);
  console.log("[G2G] Headers:", JSON.stringify(getSafeHeadersForLog(headers)));

  try {
    const res = await axios.request({
      ...config,
      headers: {
        ...headers,
        ...(config.headers || {})
      }
    });

    console.log("[G2G] Response:", res.status, previewJson(res.data, 300));

    return res.data;
  } catch (err) {
    console.error("[G2G] Error:", err.response?.status, err.response?.data);

    if (err.response?.status === 429 && retryCount < 3) {
      const delayMs = 1_000 * 2 ** retryCount;
      console.warn(
        `G2G rate limit hit during ${action}. Retrying in ${delayMs}ms (attempt ${
          retryCount + 1
        }/3).`
      );
      await sleep(delayMs);
      return requestWithRetry(config, action, retryCount + 1);
    }

    throw buildApiError(action, err);
  }
}

async function getOrders(status = "pending_delivery") {
  const url = `${BASE_URL}/seller/orders`;
  const headers = getHeaders();

  console.log("[G2G] GET", url);
  console.log("[G2G] Headers:", JSON.stringify(getSafeHeadersForLog(headers)));

  try {
    const res = await axios.get(url, {
      headers,
      params: {
        status
      }
    });

    console.log("[G2G] Response status:", res.status);
    console.log("[G2G] Response data:", previewJson(res.data));

    return res.data;
  } catch (err) {
    console.error("[G2G] 403 detail:", err.response?.data);
    throw new Error(
      `getOrders failed: ${err.response?.status} ${JSON.stringify(err.response?.data)}`
    );
  }
}

async function getOrder(orderId) {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: `${BASE_URL}/seller/orders/${encodeURIComponent(orderId)}`
      },
      `Fetching order ${orderId}`
    );
  } catch (err) {
    throw new Error(`getOrder failed for ${orderId}: ${err.message}`);
  }
}

async function postDelivery(orderId, codes, deliveryId = null) {
  try {
    const payload = {
      codes
    };

    if (deliveryId) {
      payload.delivery_id = deliveryId;
    }

    return await requestWithRetry(
      {
        method: "POST",
        url: `${BASE_URL}/seller/orders/${encodeURIComponent(orderId)}/delivery`,
        data: payload
      },
      `Posting delivery for order ${orderId}`
    );
  } catch (err) {
    throw new Error(`postDelivery failed for ${orderId}: ${err.message}`);
  }
}

async function getDeliveries(orderId, filters = {}) {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: `${BASE_URL}/seller/orders/${encodeURIComponent(orderId)}/deliveries`,
        params: filters
      },
      `Fetching deliveries for order ${orderId}`
    );
  } catch (err) {
    throw new Error(`getDeliveries failed for ${orderId}: ${err.message}`);
  }
}

async function updateOffer(offerId, data) {
  try {
    return await requestWithRetry(
      {
        method: "PUT",
        url: `${BASE_URL}/seller/offers/${encodeURIComponent(offerId)}`,
        data
      },
      `Updating offer ${offerId}`
    );
  } catch (err) {
    throw new Error(`updateOffer failed for ${offerId}: ${err.message}`);
  }
}

async function getStore() {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: `${BASE_URL}/seller/store`
      },
      "Fetching store information"
    );
  } catch (err) {
    throw new Error(`getStore failed: ${err.message}`);
  }
}

module.exports = {
  getOrders,
  getOrder,
  postDelivery,
  getDeliveries,
  updateOffer,
  getStore
};
