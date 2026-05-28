const state = {
  orders: [],
  stats: {},
  filter: "all",
  selectedOrderId: null
};

const platformIcons = {
  facebook: "📘",
  instagram: "📸",
  other: "*",
  tiktok: "📱",
  twitter: "X",
  youtube: "📺"
};

function showToast(type, message) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = `${type === "success" ? "Success:" : "Error:"} ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
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
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function capitalize(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function platformLabel(platform) {
  const value = String(platform || "other").toLowerCase();
  return `${platformIcons[value] || platformIcons.other} ${capitalize(value)}`;
}

function statusBadges(order) {
  const badges = [
    `<span class="status-badge status-${escapeHtml(order.status)}">${escapeHtml(capitalize(order.status))}</span>`
  ];

  if (order.g2g_delivered) {
    badges.push('<span class="status-badge status-g2g">G2G Delivered</span>');
  }

  return badges.join(" ");
}

function renderStats() {
  document.getElementById("stat-total").textContent = state.stats.total || 0;
  document.getElementById("stat-pending").textContent = state.stats.pending || 0;
  document.getElementById("stat-processing").textContent = state.stats.processing || 0;
  document.getElementById("stat-completed-today").textContent = state.stats.completed_today || 0;
  document.getElementById("stat-failed").textContent = state.stats.failed || 0;

  ["all", "pending", "processing", "completed", "failed"].forEach((status) => {
    const badge = document.querySelector(`[data-count="${status}"]`);

    if (!badge) {
      return;
    }

    badge.textContent = status === "all" ? state.stats.total || 0 : state.stats[status] || 0;
  });
}

function actionButtons(order) {
  const buttons = [];

  if (order.status === "pending") {
    buttons.push(`<button class="button-secondary" data-action="processing" data-id="${order.id}">Start Processing</button>`);
  }

  if (order.status !== "completed") {
    buttons.push(`<button class="button" data-action="complete" data-id="${order.id}">Mark Completed</button>`);
  }

  if (order.status !== "failed") {
    buttons.push(`<button class="button-danger" data-action="failed" data-id="${order.id}">Mark Failed</button>`);
  }

  if (order.status === "completed" && !order.g2g_delivered) {
    buttons.push(`<button class="button" data-action="deliver-g2g" data-id="${order.id}">Deliver to G2G</button>`);
  }

  return buttons.join("");
}

function buildRow(order) {
  return `
    <tr>
      <td>${escapeHtml(order.g2g_order_id || "-")}</td>
      <td>${escapeHtml(platformLabel(order.platform))}</td>
      <td>${escapeHtml(capitalize(order.service_type))}</td>
      <td><a href="${escapeHtml(order.link || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(order.link || "-")}</a></td>
      <td>${Number.parseInt(order.quantity || 0, 10)}</td>
      <td>${escapeHtml(order.buyer_username || order.buyer_id || "-")}</td>
      <td>${statusBadges(order)}</td>
      <td>${formatDate(order.created_at)}</td>
      <td>
        <div class="actions">
          <input class="inline-input" data-delivery-input="${order.id}" value="${escapeHtml(order.g2g_delivery_id || "")}" placeholder="Delivery ID" />
          <button class="button-secondary" data-action="save-delivery-id" data-id="${order.id}">Save</button>
        </div>
      </td>
      <td><div class="actions">${actionButtons(order)}</div></td>
    </tr>
  `;
}

function renderOrders() {
  const body = document.getElementById("orders-body");
  body.innerHTML = state.orders.length
    ? state.orders.map(buildRow).join("")
    : '<tr><td colspan="10">No SMM orders found.</td></tr>';
}

async function loadStats() {
  state.stats = await fetchJson("/smm/api/stats");
  renderStats();
}

async function loadOrders() {
  const query = state.filter === "all" ? "" : `?status=${encodeURIComponent(state.filter)}`;
  const payload = await fetchJson(`/smm/api/orders${query}`);
  state.orders = Array.isArray(payload.data) ? payload.data : [];
  renderOrders();
  await loadStats();
  document.getElementById("last-refreshed").textContent = `Last refreshed: ${new Date().toLocaleTimeString()}`;
}

function openModal(id) {
  document.getElementById(id).classList.add("visible");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("visible");
}

function getOrder(id) {
  return state.orders.find((order) => String(order.id) === String(id));
}

function openProofModal(id) {
  const order = getOrder(id);

  if (!order) {
    return;
  }

  state.selectedOrderId = id;
  document.getElementById("proof-details").innerHTML = `
    <p><strong>Order:</strong> ${escapeHtml(order.g2g_order_id)}</p>
    <p><strong>Target:</strong> <a href="${escapeHtml(order.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(order.link)}</a></p>
    <p><strong>Service:</strong> ${escapeHtml(platformLabel(order.platform))} ${escapeHtml(capitalize(order.service_type))}</p>
    <p><strong>Quantity:</strong> ${Number.parseInt(order.quantity || 0, 10)}</p>
  `;
  document.getElementById("proof-notes").value = order.notes || "";
  document.getElementById("proof-url").value = order.proof_url || "";
  openModal("proof-modal");
}

async function updateStatus(id, status, notes = null) {
  await fetchJson(`/smm/api/orders/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({
      status,
      notes
    })
  });
  showToast("success", `Order marked ${status}.`);
  await loadOrders();
}

async function markCompleted() {
  if (!state.selectedOrderId) {
    return;
  }

  await fetchJson(`/smm/api/orders/${state.selectedOrderId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      notes: document.getElementById("proof-notes").value,
      proof_url: document.getElementById("proof-url").value
    })
  });
  closeModal("proof-modal");
  showToast("success", "Order completed. You can now deliver it to G2G.");
  await loadOrders();
}

async function saveDeliveryId(id) {
  const input = document.querySelector(`[data-delivery-input="${id}"]`);
  await fetchJson(`/smm/api/orders/${id}/set-delivery-id`, {
    method: "POST",
    body: JSON.stringify({
      g2g_delivery_id: input?.value || ""
    })
  });
  showToast("success", "Delivery ID saved.");
  await loadOrders();
}

async function deliverToG2G(id) {
  await fetchJson(`/smm/api/orders/${id}/deliver-g2g`, {
    method: "POST"
  });
  showToast("success", "Delivered to G2G.");
  await loadOrders();
}

async function addOrder() {
  const form = document.getElementById("add-order-form");
  const data = Object.fromEntries(new FormData(form).entries());

  await fetchJson("/smm/api/orders", {
    method: "POST",
    body: JSON.stringify(data)
  });
  form.reset();
  closeModal("add-modal");
  showToast("success", "SMM order added.");
  await loadOrders();
}

function bindEvents() {
  document.querySelectorAll("[data-filter]").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
      state.filter = link.dataset.filter;
      void loadOrders();
    });
  });

  document.getElementById("add-order-button").addEventListener("click", () => openModal("add-modal"));
  document.getElementById("cancel-add").addEventListener("click", () => closeModal("add-modal"));
  document.getElementById("cancel-proof").addEventListener("click", () => closeModal("proof-modal"));
  document.getElementById("confirm-proof").addEventListener("click", () => {
    void markCompleted();
  });
  document.getElementById("add-order-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void addOrder();
  });

  document.getElementById("orders-body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");

    if (!button) {
      return;
    }

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "processing") {
      void updateStatus(id, "processing");
    }

    if (action === "complete") {
      openProofModal(id);
    }

    if (action === "failed") {
      const reason = window.prompt("Failure reason?") || "Failed";
      void updateStatus(id, "failed", reason);
    }

    if (action === "save-delivery-id") {
      void saveDeliveryId(id);
    }

    if (action === "deliver-g2g") {
      void deliverToG2G(id);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void loadOrders();
  setInterval(() => {
    void loadOrders();
  }, 30_000);
});
