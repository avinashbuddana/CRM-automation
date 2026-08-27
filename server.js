const express = require("express");
const path = require("path");
const cron = require("node-cron");

const {
  config,
  publicConfig,
  validateRequiredConfig
} = require("./src/config");

const {
  getNormalizedContacts,
  getNormalizedContact,
  createContact,
  updateWhatsAppFields,
  findContactByMessageId,
  testConnection
} = require("./src/espo");

const {
  groupContacts,
  decorateContact,
  todayIso,
  alreadySentThisYear
} = require("./src/birthdays");

const {
  createMessage,
  getMessage,
  getMessages,
  updateMessage,
  attachCrmId
} = require("./src/message-store");

const { sendBirthdayTemplate, sendOnboardingTemplate } = require("./src/whatsapp");

const app = express();

const onboardingSentSet = new Set();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function safeError(error) {
  return {
    message: error?.message || "Unexpected error",
    code: error?.code || null
  };
}

function statusLabel(status) {
  const labels = {
    accepted: "Accepted by Meta",
    sent: "Sent",
    delivered: "Delivered",
    read: "Read",
    failed: "Failed"
  };

  return labels[status] || status || "Unknown";
}

async function sendForContact(contact, { force = false } = {}) {
  const decorated = decorateContact(contact);

  if (!decorated.eligible && !force) {
    const error = new Error(
      decorated.eligibilityReasons.join(", ") || "Contact is not eligible."
    );
    error.statusCode = 400;
    throw error;
  }

  if (
    !config.espo.allowRepeatSend &&
    alreadySentThisYear(contact) &&
    !force
  ) {
    const error = new Error(
      "Birthday message has already been sent to this contact this year."
    );
    error.statusCode = 409;
    throw error;
  }

  const result = await sendBirthdayTemplate({
    phone: decorated.normalizedPhone,
    name: contact.name
  });

  const status =
    ["accepted", "sent", "delivered", "read", "failed"].includes(
      result.initialStatus
    )
      ? result.initialStatus
      : "accepted";

  const message = createMessage({
    messageId: result.messageId,
    crmId: contact.id,
    name: contact.name,
    phone: contact.phone,
    templateName: config.whatsapp.templateName,
    status
  });

  await updateWhatsAppFields(contact.id, {
    status: statusLabel(status),
    messageId: result.messageId
  });

  return {
    ...message,
    metaInitialStatus: result.initialStatus
  };
}

async function processWebhook(payload) {
  const entries = payload?.entry || [];

  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};

      for (const incoming of value?.messages || []) {
        console.log("[WhatsApp Webhook] Incoming message", {
          from: incoming.from,
          id: incoming.id,
          type: incoming.type,
          text: incoming.text?.body || null
        });
      }

      for (const statusEvent of value?.statuses || []) {
        const messageId = statusEvent.id;
        const status = statusEvent.status;
        const error = statusEvent?.errors?.[0] || null;

        console.log("[WhatsApp Webhook] Status", {
          messageId,
          recipient: statusEvent.recipient_id,
          status,
          errorCode: error?.code || null,
          errorTitle: error?.title || null,
          errorDetails:
            error?.error_data?.details || error?.message || null
        });

        let message = getMessage(messageId);

        if (!message) {
          const contact = await findContactByMessageId(messageId).catch(
            () => null
          );

          if (contact) {
            message = createMessage({
              messageId,
              crmId: contact.id,
              name: contact.name,
              phone: contact.phone,
              templateName: config.whatsapp.templateName,
              status: contact.whatsAppStatus
                ? String(contact.whatsAppStatus).toLowerCase()
                : "accepted"
            });
          }
        }

        if (!message) {
          console.warn(
            `[WhatsApp Webhook] No CRM/message record found for ${messageId}`
          );
          continue;
        }

        const updated = updateMessage(messageId, status, error);

        if (!updated) continue;

        const crmValues = {
          status: statusLabel(status),
          messageId
        };

        if (
          updated.type !== "onboarding" &&
          (status === "delivered" || status === "read")
        ) {
          crmValues.lastSent = todayIso();
        }

        if (status === "failed") {
          const reason =
            error?.error_data?.details ||
            error?.message ||
            error?.title ||
            "Unknown WhatsApp delivery failure";

          crmValues.status = `Failed: ${reason}`.slice(0, 250);
        }

        await updateWhatsAppFields(updated.crmId, crmValues).catch((err) => {
          console.error(
            "[WhatsApp Webhook] Could not update CRM:",
            err.message
          );
        });
      }
    }
  }
}

async function loadDashboardContacts() {
  const contacts = await getNormalizedContacts();
  return groupContacts(contacts);
}

async function sendTodayBatch({ initiatedBy = "manual" } = {}) {
  const grouped = await loadDashboardContacts();

  const eligible = grouped.today.filter((contact) => contact.eligible);

  if (eligible.length > config.jobs.maxBulkSend) {
    throw new Error(
      `Safety limit reached: ${eligible.length} eligible birthdays found, but MAX_BULK_SEND=${config.jobs.maxBulkSend}.`
    );
  }

  const results = [];

  for (const contact of eligible) {
    try {
      const message = await sendForContact(contact);
      results.push({
        crmId: contact.id,
        name: contact.name,
        ok: true,
        messageId: message.messageId,
        status: message.status
      });
    } catch (error) {
      results.push({
        crmId: contact.id,
        name: contact.name,
        ok: false,
        error: error.message
      });
    }
  }

  console.log(
    `[Birthday Job] ${initiatedBy}: ${results.filter((x) => x.ok).length} accepted, ` +
      `${results.filter((x) => !x.ok).length} failed/skipped`
  );

  return results;
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

app.get("/api/config", (_req, res) => {
  res.json({
    ...publicConfig(),
    warnings: validateRequiredConfig()
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "neurixa-crm-whatsapp-birthday",
    now: new Date().toISOString(),
    timezone: config.timezone
  });
});

app.get("/api/crm/test", async (_req, res) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: safeError(error) });
  }
});

app.get("/api/contacts", async (_req, res) => {
  try {
    const grouped = await loadDashboardContacts();
    res.json({
      generatedAt: new Date().toISOString(),
      timezone: config.timezone,
      ...grouped
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: safeError(error) });
  }
});

app.get("/api/contacts/:id", async (req, res) => {
  try {
    const contact = await getNormalizedContact(req.params.id);
    res.json(decorateContact(contact));
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});


app.post("/api/contacts", async (req, res) => {
  let createdContactId = null;
  let onboardingWhatsApp = null;

  try {
    const {
      firstName,
      lastName,
      phone,
      birthDate,
      whatsAppOptIn = false
    } = req.body || {};

    const trimmedFirstName = String(firstName || "").trim();
    const trimmedLastName = String(lastName || "").trim();
    const trimmedPhone = String(phone || "").trim();
    const trimmedBirthDate = String(birthDate || "").trim();

    if (!trimmedLastName) {
      return res.status(400).json({
        ok: false,
        error: { message: "Last name is required." }
      });
    }

    if (!trimmedPhone) {
      return res.status(400).json({
        ok: false,
        error: { message: "Phone number is required." }
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedBirthDate)) {
      return res.status(400).json({
        ok: false,
        error: { message: "Birth date must be in YYYY-MM-DD format." }
      });
    }

    // ponytail: hardcoded EspoCRM field names, proven working via curl.
    // Restore dynamic config.espo.fields mapping once ESPO_*_FIELD env vars are confirmed correct.
    const payload = {
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      phoneNumber: trimmedPhone,
      cDOB: trimmedBirthDate,
      cWhatsAppOptIn: Boolean(whatsAppOptIn)
    };

    console.log("ESPO CREATE PAYLOAD:", payload);

    const created = await createContact(payload);

    const createdId = created?.id || null;
    createdContactId = createdId;

    if (!createdId) {
      return res.status(201).json({
        ok: true,
        message: "Contact created in EspoCRM.",
        result: created
      });
    }

    console.log(`[CRM] Contact created: ${createdId}`);

    const contact = await getNormalizedContact(createdId);

    if (!Boolean(whatsAppOptIn)) {
      onboardingWhatsApp = {
        skipped: true,
        reason: "whatsapp_opt_in_false"
      };
    } else if (onboardingSentSet.has(createdId)) {
      onboardingWhatsApp = {
        skipped: true,
        reason: "onboarding_already_sent"
      };
    } else {
      onboardingSentSet.add(createdId);

      try {
        console.log("[WhatsApp Onboarding] Sending", {
          contactId: createdId,
          phone: trimmedPhone,
          template: config.whatsapp.onboarding.templateName
        });

        const result = await sendOnboardingTemplate({
          phone: trimmedPhone,
          firstName: trimmedFirstName
        });

        const status =
          ["accepted", "sent", "delivered", "read", "failed"].includes(
            result.initialStatus
          )
            ? result.initialStatus
            : "accepted";

        const fullName = [trimmedFirstName, trimmedLastName]
          .filter(Boolean)
          .join(" ") || trimmedLastName;

        createMessage({
          messageId: result.messageId,
          crmId: createdId,
          name: fullName,
          phone: trimmedPhone,
          type: "onboarding",
          templateName: config.whatsapp.onboarding.templateName,
          status
        });

        await updateWhatsAppFields(createdId, {
          status: statusLabel(status),
          messageId: result.messageId
        }).catch((crmErr) => {
          console.error(
            "[WhatsApp Onboarding] Could not update CRM status after accept:",
            crmErr.message
          );
        });

        console.log("[WhatsApp Onboarding] Accepted", {
          messageId: result.messageId
        });

        onboardingWhatsApp = {
          accepted: true,
          messageId: result.messageId
        };
      } catch (waError) {
        console.log("[WhatsApp Onboarding] Failed", {
          code: waError.code || null,
          message: waError.message,
          details: waError.details || null
        });

        onboardingWhatsApp = {
          accepted: false,
          error: {
            message: waError.message,
            code: waError.code || null,
            type: waError.type || null,
            details: waError.details || null,
            fbtrace_id: waError.fbtrace_id || null
          }
        };
      }
    }

    return res.status(201).json({
      ok: true,
      message: "Contact created in EspoCRM.",
      contact: decorateContact(contact),
      onboardingWhatsApp
    });
  } catch (error) {
    console.error("ESPO CREATE ERROR:", {
      message: error.message,
      status: error.status,
      statusReason: error.statusReason,
      responseBody: error.responseBody
    });

    return res.status(error.status || 500).json({
      ok: false,
      error: {
        message: error.message,
        statusReason: error.statusReason || null
      },
      onboardingWhatsApp
    });
  }
});

app.post("/api/contacts/:id/send", async (req, res) => {
  try {
    const contact = await getNormalizedContact(req.params.id);
    const result = await sendForContact(contact, {
      force: Boolean(req.body?.force)
    });

    res.json({
      ok: true,
      message: "Message accepted by Meta.",
      result
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      ok: false,
      error: safeError(error)
    });
  }
});

app.post("/api/send-today", async (_req, res) => {
  try {
    const results = await sendTodayBatch({ initiatedBy: "manual bulk send" });

    res.json({
      ok: true,
      accepted: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
      results
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: safeError(error) });
  }
});

app.get("/api/message-status", (_req, res) => {
  res.json({
    list: getMessages()
  });
});

app.get("/api/message-status/:messageId", (req, res) => {
  const message = getMessage(req.params.messageId);

  if (!message) {
    return res.status(404).json({
      error: {
        message: "Message not found in this application session."
      }
    });
  }

  res.json(message);
});

// ------------------------------------------------------------
// WhatsApp webhook verification + events
// ------------------------------------------------------------

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === config.whatsapp.webhookVerifyToken
  ) {
    console.log("[WhatsApp Webhook] Verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  // Respond quickly; process after acknowledging Meta.
  const payload = req.body;
  res.sendStatus(200);

  setImmediate(() => {
    processWebhook(payload).catch((error) => {
      console.error("[WhatsApp Webhook] Processing error:", error);
    });
  });
});

// ------------------------------------------------------------
// Optional daily job
// ------------------------------------------------------------

if (config.jobs.enabled) {
  if (!cron.validate(config.jobs.cron)) {
    console.error(
      `[Birthday Job] Invalid DAILY_CRON: ${config.jobs.cron}. Job disabled.`
    );
  } else {
    cron.schedule(
      config.jobs.cron,
      async () => {
        try {
          await sendTodayBatch({ initiatedBy: "scheduled job" });
        } catch (error) {
          console.error("[Birthday Job] Failed:", error);
        }
      },
      {
        timezone: config.timezone
      }
    );

    console.log(
      `[Birthday Job] Enabled: "${config.jobs.cron}" in ${config.timezone}`
    );
  }
}

app.listen(config.port, () => {
  console.log(
    `Neurixa CRM Birthday Automation running at http://localhost:${config.port}`
  );

  const warnings = validateRequiredConfig();
  if (warnings.length) {
    console.warn("Configuration warnings:");
    for (const warning of warnings) console.warn(`- ${warning}`);
  }
});
