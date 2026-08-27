require("dotenv").config();

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const config = {
  port: intEnv("PORT", 3000),
  timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",

  espo: {
    url: (process.env.ESPO_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.ESPO_API_KEY || "",
    entity: process.env.ESPO_ENTITY || "Contact",
    maxContacts: intEnv("ESPO_MAX_CONTACTS", 5000),
    fields: {
      name: process.env.ESPO_NAME_FIELD || "name",
      phone: process.env.ESPO_PHONE_FIELD || "phoneNumber",
      birthDate: process.env.ESPO_BIRTHDATE_FIELD || "cBirthDate",
      optIn: process.env.ESPO_OPTIN_FIELD || "cWhatsAppOptIn",
      lastSent: process.env.ESPO_LAST_SENT_FIELD || "cLastBirthdaySent",
      status: process.env.ESPO_STATUS_FIELD || "cWhatsAppStatus",
      messageId: process.env.ESPO_MESSAGE_ID_FIELD || "cWhatsAppMessageId"
    },
    requireOptIn: boolEnv("REQUIRE_WHATSAPP_OPT_IN", false),
    allowRepeatSend: boolEnv("ALLOW_REPEAT_SEND", true)
  },

  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || "birthdar_wish",
    languageCode: process.env.WHATSAPP_LANGUAGE_CODE || "en",
    templateHasName: boolEnv("WHATSAPP_TEMPLATE_HAS_NAME", true),
    graphVersion: process.env.META_GRAPH_VERSION || "v25.0",
    webhookVerifyToken:
      process.env.WEBHOOK_VERIFY_TOKEN || "neurixa_whatsapp_demo_2026",
    onboarding: {
      templateName: process.env.WHATSAPP_ONBOARDING_TEMPLATE_NAME || "customer_signup_confirmation",
      languageCode: process.env.WHATSAPP_ONBOARDING_LANGUAGE_CODE || "en",
      imageUrl: process.env.WHATSAPP_ONBOARDING_IMAGE_URL || ""
    }
  },

  jobs: {
    enabled: boolEnv("ENABLE_DAILY_JOB", false),
    cron: process.env.DAILY_CRON || "0 9 * * *",
    maxBulkSend: intEnv("MAX_BULK_SEND", 50)
  }
};

function publicConfig() {
  return {
    timezone: config.timezone,
    crm: {
      configured: Boolean(config.espo.url && config.espo.apiKey),
      url: config.espo.url || null,
      entity: config.espo.entity,
      requireOptIn: config.espo.requireOptIn,
      allowRepeatSend: config.espo.allowRepeatSend,
      fields: config.espo.fields
    },
    whatsapp: {
      configured: Boolean(
        config.whatsapp.phoneNumberId && config.whatsapp.accessToken
      ),
      templateName: config.whatsapp.templateName,
      languageCode: config.whatsapp.languageCode,
      graphVersion: config.whatsapp.graphVersion
    },
    jobs: {
      enabled: config.jobs.enabled,
      cron: config.jobs.cron,
      maxBulkSend: config.jobs.maxBulkSend
    }
  };
}

function validateRequiredConfig() {
  const warnings = [];

  if (!config.espo.url) warnings.push("ESPO_URL is not configured.");
  if (!config.espo.apiKey) warnings.push("ESPO_API_KEY is not configured.");
  if (!config.whatsapp.phoneNumberId) {
    warnings.push("WHATSAPP_PHONE_NUMBER_ID is not configured.");
  }
  if (!config.whatsapp.accessToken) {
    warnings.push("WHATSAPP_ACCESS_TOKEN is not configured.");
  }

  return warnings;
}

module.exports = {
  config,
  publicConfig,
  validateRequiredConfig
};
