function showToast(type, message) {
  const container = document.getElementById("toast-container");

  if (!container) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = `${type === "success" ? "✅" : "❌"} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString();
}

function capitalize(value) {
  return String(value || "")
    .split("_")
    .join(" ");
}

function computeSummary(orders) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let pending = 0;
  let failed = 0;
  let deliveredToday = 0;

  orders.forEach((order) => {
    if (order.dashboard_status === "pending") {
      pending += 1;
    }

    if (order.dashboard_status === "failed") {
      failed += 1;
    }

    const deliveredQuantity = Number.parseInt(order.delivered_qty || 0, 10);
    const updatedAt = new Date(order.updated_at || order.created_at);

    if (
      deliveredQuantity > 0 &&
      !Number.isNaN(updatedAt.getTime()) &&
      updatedAt >= today
    ) {
      deliveredToday += 1;
    }
  });

  return {
    total: orders.length,
    pending,
    deliveredToday,
    failed
  };
}

function renderSummary(orders) {
  const summary = computeSummary(orders);

  document.getElementById("summary-total").textContent = String(summary.total);
  document.getElementById("summary-pending").textContent = String(summary.pending);
  document.getElementById("summary-delivered").textContent = String(summary.deliveredToday);
  document.getElementById("summary-failed").textContent = String(summary.failed);
}

function buildRow(order) {
  const retryDisabled = order.dashboard_status !== "failed" ? "disabled" : "";

  return `
    <tr>
      <td>${order.order_id || "—"}</td>
      <td>${capitalize(order.offer_type || "unknown")}</td>
      <td>${order.buyer_id || "—"}</td>
      <td>
        <span class="status-badge ${order.dashboard_status}">
          ${capitalize(order.dashboard_status)}
        </span>
      </td>
      <td>${Number.parseInt(order.purchased_qty || 0, 10)}</td>
      <td>${Number.parseInt(order.delivered_qty || 0, 10)}</td>
      <td>${formatDate(order.created_at)}</td>
      <td>
        <button
          class="button-secondary retry-button"
          data-order-id="${order.order_id}"
          ${retryDisabled}
        >
          Retry Delivery
        </button>
      </td>
    </tr>
  `;
}

function renderOrders(orders) {
  const tableBody = document.getElementById("orders-table-body");
  const emptyState = document.getElementById("orders-empty");

  if (!orders.length) {
    tableBody.innerHTML = "";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  tableBody.innerHTML = orders.map(buildRow).join("");
}

async function loadOrders() {
  const refreshLabel = document.getElementById("orders-last-refresh");

  try {
    const payload = await fetchJson("/api/orders?limit=200");
    const orders = Array.isArray(payload.data) ? payload.data : [];

    renderSummary(orders);
    renderOrders(orders);

    if (refreshLabel) {
      refreshLabel.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
    }
  } catch (error) {
    showToast("error", error.message);
  }
}

async function retryOrderDelivery(orderId, button) {
  button.disabled = true;

  try {
    await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/retry`, {
      method: "POST"
    });
    showToast("success", `Retry queued for order ${orderId}.`);
    await loadOrders();
  } catch (error) {
    showToast("error", error.message);
    button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshButton = document.getElementById("refresh-orders-button");
  const tableBody = document.getElementById("orders-table-body");

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      void loadOrders();
    });
  }

  tableBody.addEventListener("click", (event) => {
    const button = event.target.closest(".retry-button");

    if (!button || button.disabled) {
      return;
    }

    const orderId = button.dataset.orderId;

    if (!orderId) {
      return;
    }

    void retryOrderDelivery(orderId, button);
  });

  void loadOrders();
  setInterval(() => {
    void loadOrders();
  }, 30_000);
});
