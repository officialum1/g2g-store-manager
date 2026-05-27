const axios = require("axios");
const { config } = require("../config");

const httpClient = axios.create({
  baseURL: config.smm.baseUrl,
  timeout: 30_000,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded"
  }
});

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatAxiosError(error, action) {
  if (error.response) {
    const message =
      error.response.data?.error ||
      error.response.data?.message ||
      JSON.stringify(error.response.data);

    return `${action} failed with status ${error.response.status}: ${message}`;
  }

  if (error.request) {
    return `${action} failed: no response received from SMM panel.`;
  }

  return `${action} failed: ${error.message}`;
}

async function postForm(action, payload) {
  const form = new URLSearchParams();
  form.set("key", config.smm.apiKey);
  form.set("action", action);

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.set(key, String(value));
    }
  });

  try {
    const response = await httpClient.post("", form.toString());
    return response.data;
  } catch (error) {
    throw new Error(formatAxiosError(error, `SMM action ${action}`));
  }
}

async function placeOrder(serviceId, link, quantity) {
  try {
    const response = await postForm("add", {
      service: serviceId,
      link,
      quantity
    });

    const orderId = response.order || response.id || response.order_id;

    if (!orderId) {
      throw new Error(
        `SMM panel did not return an order id. Response: ${JSON.stringify(response)}`
      );
    }

    return orderId;
  } catch (error) {
    throw new Error(`placeOrder failed: ${error.message}`);
  }
}

async function getOrderStatus(smmOrderId) {
  try {
    return await postForm("status", {
      order: smmOrderId
    });
  } catch (error) {
    throw new Error(`getOrderStatus failed for ${smmOrderId}: ${error.message}`);
  }
}

function normalizeStatus(statusResponse) {
  return String(
    statusResponse.status ||
      statusResponse.order_status ||
      statusResponse.state ||
      ""
  )
    .trim()
    .toLowerCase();
}

async function pollOrderUntilComplete(smmOrderId) {
  for (let pollAttempt = 1; pollAttempt <= 20; pollAttempt += 1) {
    const statusResponse = await getOrderStatus(smmOrderId);
    const normalizedStatus = normalizeStatus(statusResponse);

    if (["completed", "complete", "partial"].includes(normalizedStatus)) {
      return statusResponse;
    }

    if (
      ["failed", "error", "canceled", "cancelled", "refunded"].includes(
        normalizedStatus
      )
    ) {
      throw new Error(
        `SMM order ${smmOrderId} ended with status ${normalizedStatus}.`
      );
    }

    if (pollAttempt < 20) {
      await sleep(30_000);
    }
  }

  throw new Error(
    `SMM order ${smmOrderId} did not complete after 20 polls.`
  );
}

module.exports = {
  placeOrder,
  getOrderStatus,
  pollOrderUntilComplete
};
