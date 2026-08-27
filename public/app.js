const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  contacts: {
    today: [],
    tomorrow: [],
    next7: [],
    upcoming: [],
    all: []
  },
  activeFilter: "today",
  search: "",
  modalAction: null,
  loading: false
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast${isError ? " error" : ""}`;
  setTimeout(() => toast.classList.add("hidden"), 4500);
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatBirthday(value) {
  if (!value) return "—";

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return escapeHtml(value);

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function birthdayRelative(contact) {
  const days = contact.daysUntilBirthday;

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (typeof days === "number") return `In ${days} days`;
  return "Birthday not configured";
}

function statusBadge(status) {
  const raw = String(status || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return `<span class="badge neutral">Not sent</span>`;
  }

  if (lower.startsWith("failed")) {
    return `<span class="badge danger" title="${escapeHtml(raw)}">Failed</span>`;
  }

  if (lower.includes("read")) {
    return `<span class="badge success">Read ✓</span>`;
  }

  if (lower.includes("delivered")) {
    return `<span class="badge success">Delivered ✓</span>`;
  }

  if (lower === "sent" || lower.includes("sent")) {
    return `<span class="badge success">Sent ✓</span>`;
  }

  if (lower.includes("accepted")) {
    return `<span class="badge pending">Accepted ⏳</span>`;
  }

  return `<span class="badge neutral">${escapeHtml(raw)}</span>`;
}

function optInBadge(contact) {
  if (contact.whatsAppOptIn) {
    return `<span class="badge success">Yes</span>`;
  }

  if (state.config?.crm?.requireOptIn) {
    return `<span class="badge danger">No</span>`;
  }

  return `<span class="badge neutral">Not required</span>`;
}

function visibleContacts() {
  let list = state.contacts[state.activeFilter] || [];

  const q = state.search.trim().toLowerCase();

  if (q) {
    list = list.filter(
      (contact) =>
        String(contact.name || "").toLowerCase().includes(q) ||
        String(contact.phone || "").toLowerCase().includes(q)
    );
  }

  return list;
}

function renderContacts() {
  const body = $("contactsBody");
  const contacts = visibleContacts();

  if (!contacts.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          No customers found for this view.
        </td>
      </tr>
    `;
    return;
  }

  body.innerHTML = contacts
    .map((contact) => {
      const reasons = contact.eligibilityReasons || [];
      const disabled = !contact.eligible;
      const title = disabled ? reasons.join(", ") : "Send birthday message";

      return `
        <tr>
          <td>
            <div class="customer">
              <div class="avatar">${escapeHtml(initials(contact.name))}</div>
              <div>
                <strong>${escapeHtml(contact.name || "Unnamed contact")}</strong>
                <span>CRM ID ${escapeHtml(contact.id)}</span>
              </div>
            </div>
          </td>

          <td>
            <div class="birthday-main">${formatBirthday(contact.birthDate)}</div>
            <div class="birthday-sub">${escapeHtml(birthdayRelative(contact))}</div>
          </td>

          <td>${escapeHtml(contact.phone || "—")}</td>

          <td>${optInBadge(contact)}</td>

          <td>${statusBadge(contact.whatsAppStatus)}</td>

          <td class="action-cell">
            <button
              class="send-btn"
              data-contact-id="${escapeHtml(contact.id)}"
              ${disabled ? "disabled" : ""}
              title="${escapeHtml(title)}"
            >
              Send WhatsApp
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".send-btn[data-contact-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const contact = contacts.find(
        (item) => item.id === button.dataset.contactId
      );

      if (contact) openContactModal(contact);
    });
  });
}

function renderCounts(payload) {
  $("totalCount").textContent = payload.total ?? 0;
  $("todayCount").textContent = payload.today?.length ?? 0;
  $("tomorrowCount").textContent = payload.tomorrow?.length ?? 0;
  $("next7Count").textContent = payload.next7?.length ?? 0;

  $("tabTodayCount").textContent = payload.today?.length ?? 0;
  $("tabTomorrowCount").textContent = payload.tomorrow?.length ?? 0;
  $("tabNext7Count").textContent = payload.next7?.length ?? 0;
  $("tabUpcomingCount").textContent = payload.upcoming?.length ?? 0;
  $("tabAllCount").textContent = payload.all?.length ?? 0;

  const generated = new Date(payload.generatedAt || Date.now());

  $("lastSyncedText").textContent =
    `Synced from CRM ${generated.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
}

function setLoading(loading) {
  state.loading = loading;
  $("refreshButton").disabled = loading;
  $("sendTodayButton").disabled = loading;
  $("refreshNav").disabled = loading;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();

  state.config = data;

  $("integrationEntity").textContent = data.crm.entity;
  $("integrationTemplate").textContent = data.whatsapp.templateName;
  $("integrationLanguage").textContent = data.whatsapp.languageCode;
  $("integrationTimezone").textContent = data.timezone;
  $("integrationJob").textContent = data.jobs.enabled
    ? `Enabled · ${data.jobs.cron}`
    : "Manual";
  $("crmEntityText").textContent = `${data.crm.entity} · EspoCRM`;

  const warnings = data.warnings || [];
  const warningBox = $("warningBox");

  if (warnings.length) {
    warningBox.classList.remove("hidden");
    warningBox.innerHTML =
      `<strong>Configuration required:</strong> ${warnings
        .map(escapeHtml)
        .join(" ")}`;
  } else {
    warningBox.classList.add("hidden");
  }
}

async function testCrm() {
  const dot = document.querySelector(".connection-dot");

  try {
    const response = await fetch("/api/crm/test");
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "CRM connection failed");
    }

    dot.className = "connection-dot ok";
    $("crmConnectionText").textContent = "EspoCRM connected";
    $("integrationCrm").textContent = "EspoCRM · Connected";
  } catch (error) {
    dot.className = "connection-dot bad";
    $("crmConnectionText").textContent = "CRM connection failed";
    $("integrationCrm").textContent = "EspoCRM · Error";
  }
}

async function loadContacts({ quiet = false } = {}) {
  if (!quiet) setLoading(true);

  try {
    const response = await fetch("/api/contacts");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || "Could not fetch CRM contacts.");
    }

    state.contacts = {
      today: data.today || [],
      tomorrow: data.tomorrow || [],
      next7: data.next7 || [],
      upcoming: data.upcoming || [],
      all: data.all || []
    };

    renderCounts(data);
    renderContacts();
  } catch (error) {
    if (!quiet) showToast(error.message, true);

    $("contactsBody").innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          ${escapeHtml(error.message)}
        </td>
      </tr>
    `;
  } finally {
    if (!quiet) setLoading(false);
  }
}

function openModal({ title, copy, confirmText, action }) {
  $("modalTitle").textContent = title;
  $("modalCopy").textContent = copy;
  $("modalConfirm").textContent = confirmText;
  state.modalAction = action;
  $("confirmModal").classList.remove("hidden");
}

function closeModal() {
  $("confirmModal").classList.add("hidden");
  state.modalAction = null;
}

function openContactModal(contact) {
  openModal({
    title: `Send birthday wish to ${contact.name}?`,
    copy:
      `This will send the approved WhatsApp template ` +
      `"${state.config?.whatsapp?.templateName || "birthday template"}" ` +
      `to ${contact.phone}. Meta delivery status will be written back to EspoCRM.`,
    confirmText: "Send WhatsApp",
    action: async () => {
      const response = await fetch(
        `/api/contacts/${encodeURIComponent(contact.id)}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "Message send failed.");
      }

      showToast(`Message accepted by Meta for ${contact.name}.`);
      await loadContacts({ quiet: true });
    }
  });
}

function openSendTodayModal() {
  const count = state.contacts.today.filter((c) => c.eligible).length;

  if (!count) {
    showToast("There are no eligible birthdays to send today.", true);
    return;
  }

  openModal({
    title: `Send ${count} birthday message${count === 1 ? "" : "s"}?`,
    copy:
      `This will send the approved WhatsApp Marketing template to all ` +
      `eligible CRM contacts whose birthday is today. Only continue if ` +
      `these contacts are permitted to receive your WhatsApp communication.`,
    confirmText: `Send ${count} message${count === 1 ? "" : "s"}`,
    action: async () => {
      const response = await fetch("/api/send-today", {
        method: "POST"
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "Bulk send failed.");
      }

      showToast(
        `${data.accepted} accepted by Meta, ${data.failed} failed/skipped.`
      );

      await loadContacts({ quiet: true });
    }
  });
}

$("tabs").addEventListener("click", (event) => {
  const button = event.target.closest(".tab");
  if (!button) return;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab === button);
  });

  state.activeFilter = button.dataset.filter;
  renderContacts();
});

$("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderContacts();
});

$("refreshButton").addEventListener("click", async () => {
  await loadContacts();
  await testCrm();
  showToast("CRM contacts refreshed.");
});

$("refreshNav").addEventListener("click", async () => {
  await loadContacts();
  await testCrm();
});

$("sendTodayButton").addEventListener("click", openSendTodayModal);

$("modalCancel").addEventListener("click", closeModal);

$("confirmModal").addEventListener("click", (event) => {
  if (event.target === $("confirmModal")) closeModal();
});

$("modalConfirm").addEventListener("click", async () => {
  const action = state.modalAction;
  if (!action) return;

  const button = $("modalConfirm");
  const previous = button.textContent;

  button.disabled = true;
  button.textContent = "Working…";

  try {
    await action();
    closeModal();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
});


function openCustomerModal() {
  $("customerForm").reset();

  // For demos, default DOB to today so the new contact immediately
  // appears in the "Today" birthday tab. The user can change it.
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  $("customerBirthDate").value = local;

  if (!state.config?.crm?.requireOptIn) {
    $("customerOptIn").checked = true;
  }

  $("customerModal").classList.remove("hidden");
  setTimeout(() => $("customerFirstName").focus(), 0);
}

function closeCustomerModal() {
  $("customerModal").classList.add("hidden");
}

async function createCustomer(event) {
  event.preventDefault();

  const saveButton = $("customerSave");
  const previous = saveButton.textContent;

  const payload = {
    firstName: $("customerFirstName").value.trim(),
    lastName: $("customerLastName").value.trim(),
    phone: $("customerPhone").value.trim(),
    birthDate: $("customerBirthDate").value,
    whatsAppOptIn: $("customerOptIn").checked
  };

  if (!payload.lastName || !payload.phone || !payload.birthDate) {
    showToast("Last name, phone number and DOB are required.", true);
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Adding…";

  try {
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || "Could not create contact in EspoCRM."
      );
    }

    closeCustomerModal();
    const displayName = [payload.firstName, payload.lastName]
      .filter(Boolean)
      .join(" ");

    const onboarding = data.onboardingWhatsApp || null;

    if (onboarding?.accepted) {
      showToast(
        `${displayName} was added to EspoCRM. WhatsApp onboarding message accepted.`
      );
    } else if (onboarding?.skipped) {
      const skipReason =
        onboarding.reason === "whatsapp_opt_in_false"
          ? "WhatsApp onboarding skipped because WhatsApp opt-in is disabled."
          : onboarding.reason === "onboarding_already_sent"
            ? "WhatsApp onboarding skipped (already sent)."
            : "WhatsApp onboarding skipped.";
      showToast(`${displayName} was added to EspoCRM. ${skipReason}`);
    } else if (onboarding && onboarding.accepted === false && onboarding.error) {
      const errMsg = onboarding.error.message
        ? String(onboarding.error.message)
        : "Unknown error";
      showToast(
        `${displayName} was added to EspoCRM. WhatsApp onboarding message failed: ${errMsg}`,
        true
      );
    } else {
      showToast(`${displayName} was added to EspoCRM.`);
    }

    state.activeFilter = "today";
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.filter === "today");
    });

    await loadContacts();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = previous;
  }
}

$("addCustomerButton").addEventListener("click", openCustomerModal);
$("customerCancel").addEventListener("click", closeCustomerModal);
$("customerForm").addEventListener("submit", createCustomer);

$("customerModal").addEventListener("click", (event) => {
  if (event.target === $("customerModal")) closeCustomerModal();
});


async function init() {
  await loadConfig();
  await Promise.all([testCrm(), loadContacts()]);

  // While the dashboard is open, refresh quietly so webhook-written
  // delivery/read statuses appear without a page reload.
  setInterval(() => {
    loadContacts({ quiet: true });
  }, 5000);
}

init();
