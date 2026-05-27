const axios = require("axios");
const crypto = require("crypto");
const { config } = require("../config");

const httpClient = axios.create({
  baseURL: config.g2g.baseUrl,
  timeout: 30_000
});

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortObject(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function stableStringify(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return JSON.stringify(sortObject(value));
}

function createSignature(timestamp, body) {
  const canonicalBody = stableStringify(body);
  const message = `${config.g2g.apiKey}${timestamp}${canonicalBody}`;

  return crypto
    .createHmac("sha256", config.g2g.apiSecret)
    .update(message)
    .digest("hex");
}

function buildHeaders(timestamp, body) {
  return {
    "Content-Type": "application/json",
    "g2g-api-key": config.g2g.apiKey,
    "g2g-signature": createSignature(timestamp, body),
    "g2g-timestamp": timestamp
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatAxiosError(error, action) {
  if (error.response) {
    const responseMessage =
      error.response.data?.message ||
      error.response.data?.error ||
      JSON.stringify(error.response.data);

    return `${action} failed with status ${error.response.status}: ${responseMessage}`;
  }

  if (error.request) {
    return `${action} failed: no response received from G2G API.`;
  }

  return `${action} failed: ${error.message}`;
}

async function requestWithRetry(requestConfig, action, retryCount = 0) {
  const timestamp = Date.now().toString();
  const headers = buildHeaders(timestamp, requestConfig.data);

  try {
    const response = await httpClient.request({
      ...requestConfig,
      headers: {
        ...headers,
        ...(requestConfig.headers || {})
      }
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 429 && retryCount < 3) {
      const delayMs = 1_000 * 2 ** retryCount;
      console.warn(
        `G2G rate limit hit during ${action}. Retrying in ${delayMs}ms (attempt ${
          retryCount + 1
        }/3).`
      );
      await sleep(delayMs);
      return requestWithRetry(requestConfig, action, retryCount + 1);
    }

    throw new Error(formatAxiosError(error, action));
  }
}

async function getOrders(filters = {}) {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: "/orders",
        params: filters
      },
      "Fetching orders"
    );
  } catch (error) {
    throw new Error(`getOrders failed: ${error.message}`);
  }
}

async function getOrder(orderId) {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: `/orders/${orderId}`
      },
      `Fetching order ${orderId}`
    );
  } catch (error) {
    throw new Error(`getOrder failed for ${orderId}: ${error.message}`);
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
        url: `/orders/${orderId}/delivery`,
        data: payload
      },
      `Posting delivery for order ${orderId}`
    );
  } catch (error) {
    throw new Error(`postDelivery failed for ${orderId}: ${error.message}`);
  }
}

async function getDeliveries(orderId, filters = {}) {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: `/orders/${orderId}/deliveries`,
        params: filters
      },
      `Fetching deliveries for order ${orderId}`
    );
  } catch (error) {
    throw new Error(`getDeliveries failed for ${orderId}: ${error.message}`);
  }
}

async function updateOffer(offerId, data) {
  try {
    return await requestWithRetry(
      {
        method: "PUT",
        url: `/offers/${offerId}`,
        data
      },
      `Updating offer ${offerId}`
    );
  } catch (error) {
    throw new Error(`updateOffer failed for ${offerId}: ${error.message}`);
  }
}

async function getStore() {
  try {
    return await requestWithRetry(
      {
        method: "GET",
        url: "/store"
      },
      "Fetching store information"
    );
  } catch (error) {
    throw new Error(`getStore failed: ${error.message}`);
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
