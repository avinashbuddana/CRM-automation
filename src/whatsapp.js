const { config } = require("./config");

function assertWhatsAppConfigured() {
  if (!config.whatsapp.phoneNumberId || !config.whatsapp.accessToken) {
    throw new Error(
      "WhatsApp is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN."
    );
  }
}

async function sendBirthdayTemplate({ phone, name }) {
  assertWhatsAppConfigured();

  const url =
    `https://graph.facebook.com/${config.whatsapp.graphVersion}/` +
    `${config.whatsapp.phoneNumberId}/messages`;

  const template = {
    name: config.whatsapp.templateName,
    language: {
      code: config.whatsapp.languageCode
    }
  };

  if (config.whatsapp.templateHasName) {
    template.components = [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: String(name)
          }
        ]
      }
    ];
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(phone),
    type: "template",
    template
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      body?.error?.error_user_msg ||
      body?.error?.message ||
      `WhatsApp HTTP ${response.status}`;

    const error = new Error(message);
    error.code = body?.error?.code;
    error.details = body?.error;
    throw error;
  }

  const messageId = body?.messages?.[0]?.id;

  if (!messageId) {
    throw new Error("Meta accepted the request but did not return a message ID.");
  }

  return {
    messageId,
    initialStatus:
      body?.messages?.[0]?.message_status || "accepted",
    response: body
  };
}

async function sendOnboardingTemplate({ phone, firstName }) {
  assertWhatsAppConfigured();

  const normalizedPhone = String(phone || "").replace(/\D/g, "");

  const url =
    `https://graph.facebook.com/${config.whatsapp.graphVersion}/` +
    `${config.whatsapp.phoneNumberId}/messages`;

  const template = {
    name: config.whatsapp.onboarding.templateName,
    language: {
      code: config.whatsapp.onboarding.languageCode
    },
    components: []
  };

  if (config.whatsapp.onboarding.imageUrl) {
    template.components.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            link: config.whatsapp.onboarding.imageUrl
          }
        }
      ]
    });
  }

  template.components.push({
    type: "body",
    parameters: [
      {
        type: "text",
        text: String(firstName || "")
      }
    ]
  });

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedPhone,
    type: "template",
    template
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      raw?.error?.error_user_msg ||
        raw?.error?.message ||
        `WhatsApp HTTP ${response.status}`
    );
    error.code = raw?.error?.code;
    error.type = raw?.error?.type;
    error.details = raw?.error?.error_data?.details || raw?.error;
    error.fbtrace_id = raw?.error?.fbtrace_id;
    error.raw = raw;
    throw error;
  }

  const messageId = raw?.messages?.[0]?.id;

  if (!messageId) {
    throw new Error("Meta accepted the request but did not return a message ID.");
  }

  return {
    accepted: true,
    messageId,
    initialStatus: raw?.messages?.[0]?.message_status || "accepted",
    raw
  };
}

module.exports = {
  sendBirthdayTemplate,
  sendOnboardingTemplate
};
