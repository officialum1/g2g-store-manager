const state = {
  orders: [],
  filters: {
    search: "",
    status: "all",
    dateRange: "all"
  },
  refreshTimer: null
};

function showToast(type, message) {
  const container = document.getElementById("toast-container");

  if (!container) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = `${type === "success" ? "Success:" : "Error:"} ${message}`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function capitalize(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getOrderStatus(order) {
  return order.dashboard_status || order.status || "pending";
}

function getOrderStatusLabel(order) {
  const status = getOrderStatus(order);

  if (status === "manual_pending") {
    return "Manual Required";
  }

  return capitalize(status);
}

function getOrderRawPayload(order) {
  if (order.raw_payload && typeof order.raw_payload === "object") {
    return order.raw_payload;
  }

  return {};
}

function getOrderAgeDate(order) {
  const date = new Date(order.created_at || order.updated_at || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeSummary(orders) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return orders.reduce(
    (summary, order) => {
      const status = getOrderStatus(order);
      const deliveredQuantity = Number.parseInt(order.delivered_qty || 0, 10);
      const updatedAt = new Date(order.updated_at || order.created_at || "");

      summary.total += 1;

      if (status === "pending") {
        summary.pending += 1;
      }

      if (status === "failed") {
        summary.failed += 1;
      }

      if (
        deliveredQuantity > 0 &&
        !Number.isNaN(updatedAt.getTime()) &&
        updatedAt >= today
      ) {
        summary.deliveredToday += 1;
      }

      return summary;
    },
    {
      total: 0,
      pending: 0,
      deliveredToday: 0,
      failed: 0
    }
  );
}

function renderSummary(orders) {
  const summary = computeSummary(orders);

  document.getElementById("summary-total").textContent = String(summary.total);
  document.getElementById("summary-pending").textContent = String(summary.pending);
  document.getElementById("summary-delivered").textContent = String(summary.deliveredToday);
  document.getElementById("summary-failed").textContent = String(summary.failed);
}

function updatePendingBadge(counts = {}) {
  const badge = document.getElementById("orders-pending-badge");

  if (!badge) {
    return;
  }

  const total = Number.parseInt(counts.pending || 0, 10);

  badge.textContent = String(total);
  badge.hidden = total === 0;
}

function filterOrders(orders) {
  const search = state.filters.search.trim().toLowerCase();
  const status = state.filters.status;
  const dateRange = state.filters.dateRange;
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return orders.filter((order) => {
    const orderStatus = getOrderStatus(order);
    const createdAt = getOrderAgeDate(order);
    const matchesSearch =
      !search ||
      String(order.order_id || "").toLowerCase().includes(search) ||
      String(order.buyer_id || "").toLowerCase().includes(search);
    const matchesStatus = status === "all" || orderStatus === status;
    let matchesDate = true;

    if (dateRange === "today") {
      matchesDate = Boolean(createdAt && createdAt >= todayStart);
    }

    if (dateRange === "last_7_days") {
      matchesDate = Boolean(createdAt && createdAt >= sevenDaysAgo);
    }

    return matchesSearch && matchesStatus && matchesDate;
  });
}

function buildRow(order) {
  const status = getOrderStatus(order);
  const retryDisabled = status !== "failed" ? "disabled" : "";
  const orderId = String(order.order_id || "");

  return `
    <tr>
      <td>${escapeHtml(orderId || "-")}</td>
      <td>${escapeHtml(capitalize(order.offer_type || "unknown"))}</td>
      <td>${escapeHtml(order.buyer_id || "-")}</td>
      <td>
        <span class="status-badge ${escapeHtml(status)}">
          ${escapeHtml(getOrderStatusLabel(order))}
        </span>
      </td>
      <td>${Number.parseInt(order.purchased_qty || 0, 10)}</td>
      <td>${Number.parseInt(order.delivered_qty || 0, 10)}</td>
      <td>${escapeHtml(formatDate(order.created_at))}</td>
      <td>
        <div class="button-row order-actions">
          <button
            class="button-secondary view-details-button"
            data-order-id="${escapeHtml(orderId)}"
          >
            View Details
          </button>
          <button
            class="button complete-button"
            data-order-id="${escapeHtml(orderId)}"
          >
            Mark Delivered
          </button>
          <button
            class="button-secondary retry-button"
            data-order-id="${escapeHtml(orderId)}"
            ${retryDisabled}
          >
            Retry Delivery
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderOrders() {
  const tableBody = document.getElementById("orders-table-body");
  const emptyState = document.getElementById("orders-empty");
  const emptyMessage = document.getElementById("orders-empty-message");
  const filteredOrders = filterOrders(state.orders);

  renderSummary(state.orders);

  if (!state.orders.length) {
    tableBody.innerHTML = "";
    emptyMessage.textContent =
      "No orders yet. Click 'Sync from G2G' to fetch your latest orders.";
    emptyState.hidden = false;
    return;
  }

  if (!filteredOrders.length) {
    tableBody.innerHTML = "";
    emptyMessage.textContent = "No orders match the current filters.";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  tableBody.innerHTML = filteredOrders.map(buildRow).join("");
}

function readFiltersFromDom() {
  state.filters.search = document.getElementById("order-search").value || "";
  state.filters.status = document.getElementById("status-filter").value || "all";
  state.filters.dateRange = document.getElementById("date-filter").value || "all";
}

async function loadOrderCounts() {
  const counts = await fetchJson("/api/orders/counts");
  updatePendingBadge(counts);
}

async function loadOrders() {
  const refreshLabel = document.getElementById("orders-last-refresh");

  try {
    const payload = await fetchJson("/api/orders?limit=200");
    state.orders = Array.isArray(payload.data) ? payload.data : [];
    renderOrders();
    await loadOrderCounts();

    if (refreshLabel) {
      refreshLabel.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
    }
  } catch (error) {
    showToast("error", error.message);
  }
}

async function syncOrders(button) {
  if (button) {
    button.disabled = true;
  }

  try {
    const payload = await fetchJson("/api/orders/sync");
    const synced = Number.parseInt(payload.synced || 0, 10);
    showToast("success", `Synced ${synced} new order${synced === 1 ? "" : "s"}.`);
    await loadOrders();
  } catch (error) {
    showToast("error", error.message);
  } finally {
    if (button) {
      button.disabled = false;
    }
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

async function completeOrderDelivery(orderId, button) {
  button.disabled = true;

  try {
    await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/complete`, {
      method: "POST"
    });
    showToast("success", `Order ${orderId} marked as delivered.`);
    await loadOrders();
  } catch (error) {
    showToast("error", error.message);
    button.disabled = false;
  }
}

function openDetailsModal(orderId) {
  const order = state.orders.find((item) => String(item.order_id) === String(orderId));
  const modal = document.getElementById("order-details-modal");
  const title = document.getElementById("order-details-title");
  const content = document.getElementById("order-details-json");

  if (!order || !modal || !title || !content) {
    return;
  }

  title.textContent = `Order ${order.order_id}`;
  content.textContent = JSON.stringify(getOrderRawPayload(order), null, 2);
  modal.classList.add("visible");
  modal.setAttribute("aria-hidden", "false");
}

function closeDetailsModal() {
  const modal = document.getElementById("order-details-modal");

  if (!modal) {
    return;
  }

  modal.classList.remove("visible");
  modal.setAttribute("aria-hidden", "true");
}

function bindFilters() {
  ["order-search", "status-filter", "date-filter"].forEach((id) => {
    const input = document.getElementById(id);

    if (!input) {
      return;
    }

    input.addEventListener("input", () => {
      readFiltersFromDom();
      renderOrders();
    });

    input.addEventListener("change", () => {
      readFiltersFromDom();
      renderOrders();
    });
  });
}

function bindButtons() {
  const refreshButton = document.getElementById("refresh-orders-button");
  const syncButton = document.getElementById("sync-orders-button");
  const searchG2GButton = document.getElementById("search-g2g-button");
  const emptySyncButton = document.getElementById("empty-sync-orders-button");
  const closeModalButton = document.getElementById("close-order-details-button");
  const modal = document.getElementById("order-details-modal");
  const tableBody = document.getElementById("orders-table-body");

  refreshButton?.addEventListener("click", () => {
    void loadOrders();
  });

  syncButton?.addEventListener("click", () => {
    void syncOrders(syncButton);
  });

  searchG2GButton?.addEventListener("click", () => {
    void syncOrders(searchG2GButton);
  });

  emptySyncButton?.addEventListener("click", () => {
    void syncOrders(emptySyncButton);
  });

  closeModalButton?.addEventListener("click", closeDetailsModal);

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeDetailsModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDetailsModal();
    }
  });

  tableBody?.addEventListener("click", (event) => {
    const retryButton = event.target.closest(".retry-button");
    const completeButton = event.target.closest(".complete-button");
    const detailsButton = event.target.closest(".view-details-button");

    if (retryButton && !retryButton.disabled) {
      void retryOrderDelivery(retryButton.dataset.orderId, retryButton);
      return;
    }

    if (completeButton && !completeButton.disabled) {
      void completeOrderDelivery(completeButton.dataset.orderId, completeButton);
      return;
    }

    if (detailsButton) {
      openDetailsModal(detailsButton.dataset.orderId);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindFilters();
  bindButtons();
  readFiltersFromDom();

  void loadOrders();
  state.refreshTimer = setInterval(() => {
    void loadOrders();
  }, 30_000);
});
