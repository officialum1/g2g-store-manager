const state = {
  orders: [],
  selectedDeliveryOrderId: null,
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
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function capitalize(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRawPayload(order) {
  let raw = order.raw_payload;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      raw = {};
    }
  }

  raw = raw || {};

  if (raw && typeof raw === "object") {
    return raw.payload || raw;
  }

  return order.payload || order;
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

function getNestedValue(source, paths) {
  for (const pathName of paths) {
    const value = pathName.split(".").reduce((current, key) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return current[key];
    }, source);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function extractDeliveryId(order) {
  if (order.delivery_id) {
    return order.delivery_id;
  }

  let raw = order.raw_payload;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      raw = {};
    }
  }

  raw = raw || {};

  return (
    raw.delivery_summary?.delivery_id ||
    raw.delivery_id ||
    raw.deliveries?.[0]?.delivery_id ||
    raw.delivery_list?.[0]?.delivery_id ||
    raw.payload?.delivery_summary?.delivery_id ||
    raw.payload?.delivery_id ||
    raw.payload?.deliveries?.[0]?.delivery_id ||
    raw.payload?.delivery_list?.[0]?.delivery_id ||
    order.deliveryId ||
    order.fetched_delivery_id ||
    raw.fetched_delivery_id ||
    null
  );
}

function extractAdditionalInfo(order) {
  let raw = order.raw_payload;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      raw = {};
    }
  }

  return (
    raw?.delivery_summary?.additional_info_list ||
    raw?.additional_info_list ||
    raw?.payload?.delivery_summary?.additional_info_list ||
    raw?.payload?.additional_info_list ||
    []
  );
}

function getAdditionalInfoList(order) {
  return extractAdditionalInfo(order);
}

function getAdditionalInfoLabel(item, index) {
  return (
    item.attribute_key ||
    item.key ||
    item.name ||
    item.attribute_group_name ||
    `Info ${index + 1}`
  );
}

function getAdditionalInfoValue(item) {
  const value =
    item.value ??
    item.attribute_value ??
    item.attribute_values ??
    item.attribute_group_value ??
    item.content ??
    "";

  return Array.isArray(value) ? value.join(", ") : String(value);
}

function getDeliveryId(order) {
  return extractDeliveryId(order) || "";
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
    <tr data-order-id="${escapeHtml(orderId)}">
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
          <button class="button-secondary view-details-button" data-order-id="${escapeHtml(orderId)}">
            View Details
          </button>
          <button class="button complete-button" data-order-id="${escapeHtml(orderId)}">
            Mark Delivered
          </button>
          <button onclick="forceDeliver('${escapeHtml(orderId)}')" 
            style="background:#ff6b35; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; margin-top:4px; display:block; width:100%;">
            Force Deliver G2G
          </button>
          <button class="button-secondary retry-button" data-order-id="${escapeHtml(orderId)}" ${retryDisabled}>
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
      "No orders yet. Orders appear automatically when buyers purchase. Use Lookup to find a specific order by ID.";
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

function upsertLocalOrder(order) {
  const index = state.orders.findIndex((item) => {
    return String(item.order_id) === String(order.order_id);
  });

  if (index >= 0) {
    state.orders[index] = {
      ...state.orders[index],
      ...order
    };
  } else {
    state.orders.unshift(order);
  }
}

function scrollToOrder(orderId) {
  const row = document.querySelector(
    `[data-order-id="${CSS.escape(String(orderId))}"]`
  );

  if (row) {
    row.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }
}

async function lookupOrder(button) {
  const input = document.getElementById("lookup-order-id");
  const orderId = String(input?.value || "").trim();

  if (!orderId) {
    showToast("error", "Enter a G2G Order ID first.");
    input?.focus();
    return;
  }

  if (button) {
    button.disabled = true;
  }

  try {
    const payload = await fetchJson(`/api/orders/lookup/${encodeURIComponent(orderId)}`);
    const order = {
      ...(payload.data || payload.order || {}),
      delivery_id: payload.deliveryId || payload.data?.delivery_id,
      raw_payload: payload.raw || payload.data?.raw_payload || payload.order
    };

    if (!order || !order.order_id) {
      throw new Error("Lookup succeeded but no order data was returned.");
    }

    upsertLocalOrder(order);
    renderOrders();
    await loadOrderCounts();
    scrollToOrder(order.order_id);
    openDeliveryModal(order.order_id);
    showToast("success", `Order ${order.order_id} added to the dashboard.`);

    if (input) {
      input.value = "";
    }
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

function openDetailsModal(orderId) {
  const order = state.orders.find((item) => String(item.order_id) === String(orderId));
  const modal = document.getElementById("order-details-modal");
  const title = document.getElementById("order-details-title");
  const content = document.getElementById("order-details-json");

  if (!order || !modal || !title || !content) {
    return;
  }

  title.textContent = `Order ${order.order_id}`;
  content.textContent = JSON.stringify(getRawPayload(order), null, 2);
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

function renderModalAdditionalInfo(order) {
  const container = document.getElementById("modalAdditionalInfo");
  const list = getAdditionalInfoList(order);

  if (!container) {
    return;
  }

  if (!list.length) {
    container.innerHTML = "<p>No additional buyer info found.</p>";
    return;
  }

  container.innerHTML = `
    <h3 style="margin:16px 0 8px;">Additional Info</h3>
    <dl style="display:grid; grid-template-columns:160px 1fr; gap:8px 12px; margin:0;">
      ${list
        .map((item, index) => {
          return `
            <dt style="color:#a1a1aa;">${escapeHtml(getAdditionalInfoLabel(item, index))}</dt>
            <dd style="margin:0;">${escapeHtml(getAdditionalInfoValue(item))}</dd>
          `;
        })
        .join("")}
    </dl>
  `;
}

function syncDeliveryTypeUi() {
  const deliveryType = document.getElementById("deliveryType");
  const codesField = document.getElementById("deliveryCodes");

  if (!deliveryType || !codesField) {
    return;
  }

  codesField.style.display = deliveryType.value === "boost" ? "none" : "block";
}

function openDeliveryModal(orderId) {
  const order = state.orders.find((item) => String(item.order_id) === String(orderId));
  const modal = document.getElementById("deliveryModal");
  const title = document.getElementById("modalOrderId");
  const buyerInfo = document.getElementById("modalBuyerInfo");
  const deliveryType = document.getElementById("deliveryType");
  const codesField = document.getElementById("deliveryCodes");
  const deliveryIdInput = document.getElementById("modalDeliveryIdInput");
  const deliveryId = getDeliveryId(order || {});

  if (!order || !modal || !title || !buyerInfo || !deliveryType || !codesField || !deliveryIdInput) {
    return;
  }

  state.selectedDeliveryOrderId = String(order.order_id);
  title.textContent = `Deliver Order ${order.order_id}`;
  buyerInfo.innerHTML = `
    <p><strong>Order ID:</strong> ${escapeHtml(order.order_id || "-")}</p>
    <p><strong>Offer ID:</strong> ${escapeHtml(order.offer_id || "-")}</p>
    <p><strong>Buyer ID:</strong> ${escapeHtml(order.buyer_id || "-")}</p>
    <p><strong>Qty:</strong> ${Number.parseInt(order.purchased_qty || 0, 10)} purchased / ${Number.parseInt(order.delivered_qty || 0, 10)} delivered</p>
    <p><strong>Status:</strong> ${escapeHtml(getOrderStatusLabel(order))}</p>
  `;
  deliveryIdInput.value = deliveryId || "";
  renderModalAdditionalInfo(order);
  deliveryType.value = String(order.offer_type || "").toLowerCase().includes("boost")
    ? "boost"
    : "code";
  codesField.value = "";
  syncDeliveryTypeUi();
  modal.style.display = "block";
}

function closeModal() {
  const modal = document.getElementById("deliveryModal");

  if (modal) {
    modal.style.display = "none";
  }

  state.selectedDeliveryOrderId = null;
}

async function confirmDelivery() {
  const orderId = state.selectedDeliveryOrderId;
  const order = state.orders.find((item) => String(item.order_id) === String(orderId));
  const deliveryId = document.getElementById("modalDeliveryIdInput")?.value?.trim();
  const deliveryType = document.getElementById("deliveryType")?.value || "code";
  const codes = String(document.getElementById("deliveryCodes")?.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!orderId || !order) {
    showToast("error", "No order selected.");
    return;
  }

  if (!deliveryId) {
    alert("Please enter a Delivery ID! Try: D1779535809637");
    return;
  }

  try {
    let payload;

    if (deliveryType === "code") {
      if (!codes.length) {
        showToast("error", "Enter at least one code or credential line.");
        return;
      }

      payload = await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          delivery_id: deliveryId,
          codes
        })
      });
    } else {
      payload = await fetchJson(`/api/orders/${encodeURIComponent(orderId)}/complete`, {
        method: "POST",
        body: JSON.stringify({
          delivery_id: deliveryId,
          note: "Boost completed"
        })
      });
    }

    upsertLocalOrder({
      ...order,
      ...(payload.data || {}),
      status: "delivered",
      dashboard_status: "delivered",
      delivered_qty: order.purchased_qty || order.delivered_qty || 1
    });
    renderOrders();
    closeModal();
    showToast("success", `Order ${orderId} marked as delivered.`);
  } catch (error) {
    showToast("error", error.message);
  }
}

async function forceDeliver(orderId) {
  if (!confirm(`Force deliver order ${orderId} to G2G?`)) return;

  const notes = prompt("Enter delivery note (optional):", "100,000 TikTok Views Delivered");

  try {
    showToast("success", "Attempting G2G delivery...");
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/force-deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || "Delivered" })
    });
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];

    const successes = results.filter((result) => {
      return result.status === 200 || result.status === 201;
    });
    const failures = results.filter((result) => {
      return result.status !== 200 && result.status !== 201;
    });

    if (successes.length > 0) {
      showToast("success", `Success! Method: ${successes[0].method}`);
      alert("SUCCESS!\n\n" + JSON.stringify(successes[0], null, 2));
      void loadOrders();
    } else {
      showToast("error", "All methods failed - check popup");
      alert("ALL FAILED:\n\n" + JSON.stringify(results.length ? results : data, null, 2));
    }
  } catch (err) {
    showToast("error", "Error: " + err.message);
  }
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
  const lookupButton = document.getElementById("lookup-order-button");
  const emptyLookupButton = document.getElementById("empty-lookup-order-button");
  const lookupInput = document.getElementById("lookup-order-id");
  const closeModalButton = document.getElementById("close-order-details-button");
  const deliveryType = document.getElementById("deliveryType");
  const detailsModal = document.getElementById("order-details-modal");
  const deliveryModal = document.getElementById("deliveryModal");
  const tableBody = document.getElementById("orders-table-body");

  refreshButton?.addEventListener("click", () => {
    void loadOrders();
  });

  lookupButton?.addEventListener("click", () => {
    void lookupOrder(lookupButton);
  });

  emptyLookupButton?.addEventListener("click", () => {
    lookupInput?.focus();
  });

  lookupInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void lookupOrder(lookupButton);
    }
  });

  closeModalButton?.addEventListener("click", closeDetailsModal);
  deliveryType?.addEventListener("change", syncDeliveryTypeUi);

  detailsModal?.addEventListener("click", (event) => {
    if (event.target === detailsModal) {
      closeDetailsModal();
    }
  });

  deliveryModal?.addEventListener("click", (event) => {
    if (event.target === deliveryModal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDetailsModal();
      closeModal();
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
      openDeliveryModal(completeButton.dataset.orderId);
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

window.confirmDelivery = confirmDelivery;
window.closeModal = closeModal;
window.forceDeliver = forceDeliver;
