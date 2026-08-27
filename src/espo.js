const { config } = require("./config");

function assertEspoConfigured() {
  if (!config.espo.url || !config.espo.apiKey) {
    throw new Error(
      "EspoCRM is not configured. Set ESPO_URL and ESPO_API_KEY."
    );
  }
}

async function espoRequest(path, options = {}) {
  assertEspoConfigured();

  const url = `${config.espo.url}/api/v1/${path.replace(/^\/+/, "")}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "X-Api-Key": config.espo.apiKey,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const statusReason = response.headers.get("x-status-reason");

    // EspoCRM returns the conflicting record(s) as the body on a duplicate error.
    const duplicateRecord =
      statusReason === "duplicate" && Array.isArray(body) ? body[0] : null;

    const message =
      (duplicateRecord &&
        `A contact with this phone number already exists in EspoCRM (${duplicateRecord.name || duplicateRecord.phoneNumber || duplicateRecord.id}).`) ||
      statusReason ||
      body?.message ||
      body?.error?.message ||
      (typeof body === "string" ? body : "") ||
      `EspoCRM HTTP ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.statusReason = statusReason;
    error.responseBody = body;

    throw error;
  }

  return body;
}

function selectedAttributes() {
  const f = config.espo.fields;

  return Array.from(
    new Set([
      "id",
      f.name,
      f.phone,
      f.birthDate,
      f.optIn,
      f.lastSent,
      f.status,
      f.messageId
    ])
  ).join(",");
}

async function listContacts() {
  const pageSize = 200;
  let offset = 0;
  const all = [];

  while (all.length < config.espo.maxContacts) {
    const params = new URLSearchParams({
      maxSize: String(
        Math.min(pageSize, config.espo.maxContacts - all.length)
      ),
      offset: String(offset),
      select: selectedAttributes()
    });

    const result = await espoRequest(
      `${encodeURIComponent(config.espo.entity)}?${params.toString()}`
    );

    const list = Array.isArray(result?.list)
      ? result.list
      : Array.isArray(result)
        ? result
        : [];

    all.push(...list);

    if (list.length < pageSize) break;

    offset += list.length;

    if (
      typeof result?.total === "number" &&
      result.total >= 0 &&
      offset >= result.total
    ) {
      break;
    }
  }

  return all.slice(0, config.espo.maxContacts);
}

async function getContact(id) {
  return espoRequest(
    `${encodeURIComponent(config.espo.entity)}/${encodeURIComponent(id)}`
  );
}

async function updateContact(id, payload) {
  return espoRequest(
    `${encodeURIComponent(config.espo.entity)}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}


async function createContact(payload) {
  return espoRequest(
    `${encodeURIComponent(config.espo.entity)}`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

function normalizeContact(record) {
  const f = config.espo.fields;

  return {
    id: record.id,
    name: String(record[f.name] || "").trim(),
    phone: String(record[f.phone] || "").trim(),
    birthDate: record[f.birthDate] || null,
    whatsAppOptIn: Boolean(record[f.optIn]),
    lastBirthdaySent: record[f.lastSent] || null,
    whatsAppStatus: record[f.status] || null,
    whatsAppMessageId: record[f.messageId] || null,
    raw: record
  };
}

async function getNormalizedContacts() {
  const records = await listContacts();
  return records.map(normalizeContact);
}

async function getNormalizedContact(id) {
  const record = await getContact(id);
  return normalizeContact(record);
}

async function updateWhatsAppFields(id, values = {}) {
  const f = config.espo.fields;
  const payload = {};

  if (values.status !== undefined) payload[f.status] = values.status;
  if (values.messageId !== undefined) payload[f.messageId] = values.messageId;
  if (values.lastSent !== undefined) payload[f.lastSent] = values.lastSent;

  if (Object.keys(payload).length === 0) return null;

  return updateContact(id, payload);
}

async function findContactByMessageId(messageId) {
  if (!messageId) return null;

  const contacts = await getNormalizedContacts();
  return (
    contacts.find((contact) => contact.whatsAppMessageId === messageId) || null
  );
}

async function testConnection() {
  const result = await espoRequest(
    `${encodeURIComponent(config.espo.entity)}?maxSize=1`
  );

  return {
    ok: true,
    entity: config.espo.entity,
    total:
      typeof result?.total === "number"
        ? result.total
        : Array.isArray(result?.list)
          ? result.list.length
          : null
  };
}

module.exports = {
  listContacts,
  getContact,
  updateContact,
  createContact,
  normalizeContact,
  getNormalizedContacts,
  getNormalizedContact,
  updateWhatsAppFields,
  findContactByMessageId,
  testConnection
};
