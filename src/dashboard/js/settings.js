const SECTION_FIELDS = {
  g2g: ["G2G_API_KEY", "G2G_API_SECRET"],
  webhook: ["G2G_WEBHOOK_SECRET", "G2G_OFFER_WEBHOOK_SECRET"],
  smm: ["SMM_PANEL_URL", "SMM_PANEL_KEY"]
};

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

function setSecretFieldValue(input, setting) {
  input.value = "";
  input.dataset.maskedValue = setting.value || "";
  input.placeholder = setting.value || "";
}

function setPlainFieldValue(input, setting) {
  input.value = setting.value || "";
}

function populateFields(settings) {
  Object.entries(settings || {}).forEach(([key, setting]) => {
    const input = document.querySelector(`[data-setting-key="${key}"]`);

    if (!input) {
      return;
    }

    if (setting.is_secret) {
      setSecretFieldValue(input, setting);
      return;
    }

    setPlainFieldValue(input, setting);
  });
}

function buildSectionPayload(sectionName) {
  const settings = [];

  SECTION_FIELDS[sectionName].forEach((key) => {
    const input = document.querySelector(`[data-setting-key="${key}"]`);

    if (!input) {
      return;
    }

    const isSecret = input.type === "password" || input.dataset.secret === "true";
    const value = input.value.trim();

    if (isSecret) {
      if (value !== "") {
        settings.push({
          key,
          value
        });
      }

      return;
    }

    settings.push({
      key,
      value
    });
  });

  return settings;
}

async function loadSettings() {
  try {
    const payload = await fetchJson("/api/settings");
    populateFields(payload.data || {});
    document.getElementById("webhook-url-display").value =
      `${window.location.origin}/webhook/g2g`;
  } catch (error) {
    showToast("error", error.message);
  }
}

async function saveSection(sectionName) {
  const payload = buildSectionPayload(sectionName);

  if (payload.length === 0) {
    showToast("error", "No new values entered for this section.");
    return;
  }

  try {
    await fetchJson("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        settings: payload
      })
    });

    showToast("success", "Settings saved.");
    await loadSettings();
  } catch (error) {
    showToast("error", error.message);
  }
}

function wireVisibilityToggles() {
  document.querySelectorAll(".toggle-visibility").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.toggleTarget);

      if (!target) {
        return;
      }

      const showing = target.type === "text";
      target.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireVisibilityToggles();

  document.querySelectorAll("[data-save-section]").forEach((button) => {
    button.addEventListener("click", () => {
      void saveSection(button.dataset.saveSection);
    });
  });

  void loadSettings();
});
