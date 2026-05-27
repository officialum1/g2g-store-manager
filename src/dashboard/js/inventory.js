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

function renderCounts(counts) {
  const container = document.getElementById("inventory-counts");

  if (!Array.isArray(counts) || counts.length === 0) {
    container.innerHTML = '<div class="inline-note">No available stock yet.</div>';
    return;
  }

  container.innerHTML = counts
    .map((item) => {
      return `
        <div class="stock-badge">
          <strong>${item.offer_id}</strong>
          <span>${item.available_count} available</span>
        </div>
      `;
    })
    .join("");
}

function buildInventoryRow(item) {
  const defectiveDisabled = item.status === "defective" ? "disabled" : "";

  return `
    <tr>
      <td>${item.item_id}</td>
      <td>${item.offer_id}</td>
      <td>${item.content_masked || "—"}</td>
      <td>
        <span class="status-badge ${item.status === "available"
          ? "completed"
          : item.status === "defective"
            ? "failed"
            : "pending"}">
          ${item.status}
        </span>
      </td>
      <td>${item.delivered_to_order_id || "—"}</td>
      <td>${formatDate(item.created_at)}</td>
      <td>
        <button
          class="button-danger defective-button"
          data-item-id="${item.item_id}"
          ${defectiveDisabled}
        >
          Mark Defective
        </button>
      </td>
    </tr>
  `;
}

function renderInventory(items) {
  const tableBody = document.getElementById("inventory-table-body");
  const emptyState = document.getElementById("inventory-empty");

  if (!items.length) {
    tableBody.innerHTML = "";
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  tableBody.innerHTML = items.map(buildInventoryRow).join("");
}

async function loadInventory() {
  const offerId = document.getElementById("filter-offer-id").value.trim();
  const status = document.getElementById("filter-status").value.trim();
  const refreshLabel = document.getElementById("inventory-last-refresh");
  const params = new URLSearchParams();

  if (offerId) {
    params.set("offer_id", offerId);
  }

  if (status) {
    params.set("status", status);
  }

  params.set("limit", "250");

  try {
    const payload = await fetchJson(`/api/inventory?${params.toString()}`);
    renderInventory(Array.isArray(payload.data) ? payload.data : []);
    renderCounts(Array.isArray(payload.counts) ? payload.counts : []);

    if (refreshLabel) {
      refreshLabel.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
    }
  } catch (error) {
    showToast("error", error.message);
  }
}

function openModal() {
  document.getElementById("add-items-modal").classList.add("visible");
}

function closeModal() {
  document.getElementById("add-items-modal").classList.remove("visible");
}

async function submitBulkInventory() {
  const offerIdInput = document.getElementById("bulk-offer-id");
  const textarea = document.getElementById("bulk-items");
  const lines = textarea.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (!offerIdInput.value.trim()) {
    showToast("error", "Offer ID is required.");
    return;
  }

  if (lines.length === 0) {
    showToast("error", "Paste at least one inventory line.");
    return;
  }

  try {
    const payload = await fetchJson("/api/inventory/bulk", {
      method: "POST",
      body: JSON.stringify({
        offer_id: offerIdInput.value.trim(),
        items: lines
      })
    });

    showToast("success", `Added ${payload.created} inventory item(s).`);
    textarea.value = "";
    offerIdInput.value = "";
    closeModal();
    await loadInventory();
  } catch (error) {
    showToast("error", error.message);
  }
}

async function markDefective(itemId) {
  try {
    await fetchJson(`/api/inventory/${encodeURIComponent(itemId)}/defective`, {
      method: "POST"
    });
    showToast("success", `Item ${itemId} marked defective.`);
    await loadInventory();
  } catch (error) {
    showToast("error", error.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const filterButton = document.getElementById("apply-inventory-filter");
  const resetButton = document.getElementById("reset-inventory-filter");
  const openModalButton = document.getElementById("open-add-items-modal");
  const closeModalButton = document.getElementById("close-add-items-modal");
  const saveBulkButton = document.getElementById("save-bulk-items");
  const tableBody = document.getElementById("inventory-table-body");
  const modal = document.getElementById("add-items-modal");

  filterButton.addEventListener("click", () => {
    void loadInventory();
  });

  resetButton.addEventListener("click", () => {
    document.getElementById("filter-offer-id").value = "";
    document.getElementById("filter-status").value = "";
    void loadInventory();
  });

  openModalButton.addEventListener("click", openModal);
  closeModalButton.addEventListener("click", closeModal);
  saveBulkButton.addEventListener("click", () => {
    void submitBulkInventory();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  tableBody.addEventListener("click", (event) => {
    const button = event.target.closest(".defective-button");

    if (!button || button.disabled) {
      return;
    }

    void markDefective(button.dataset.itemId);
  });

  void loadInventory();
});
