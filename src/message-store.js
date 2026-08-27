const messages = new Map();

const rank = {
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 99
};

function nowIso() {
  return new Date().toISOString();
}

function createMessage(record) {
  const existing = messages.get(record.messageId);

  if (existing) {
    return existing;
  }

  const message = {
    messageId: record.messageId,
    crmId: record.crmId,
    name: record.name,
    phone: record.phone,
    type: record.type || "birthday",
    templateName: record.templateName,
    status: record.status || "accepted",
    acceptedAt: record.acceptedAt || nowIso(),
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    errorCode: null,
    errorTitle: null,
    errorMessage: null
  };

  messages.set(message.messageId, message);
  return message;
}

function getMessage(messageId) {
  return messages.get(messageId) || null;
}

function getMessages() {
  return [...messages.values()].sort((a, b) =>
    String(b.acceptedAt).localeCompare(String(a.acceptedAt))
  );
}

function shouldProgress(current, next) {
  if (!current) return true;
  if (current === "failed" || current === "read") return false;
  if (next === "failed") return true;

  return (rank[next] || 0) >= (rank[current] || 0);
}

function updateMessage(messageId, status, error = null) {
  const message = messages.get(messageId);
  if (!message) return null;

  if (!shouldProgress(message.status, status)) {
    return message;
  }

  message.status = status;

  const timestamp = nowIso();

  if (status === "sent" && !message.sentAt) message.sentAt = timestamp;
  if (status === "delivered" && !message.deliveredAt) {
    message.deliveredAt = timestamp;
  }
  if (status === "read" && !message.readAt) message.readAt = timestamp;

  if (status === "failed") {
    message.failedAt = timestamp;
    message.errorCode = error?.code ?? null;
    message.errorTitle = error?.title ?? null;
    message.errorMessage =
      error?.error_data?.details ||
      error?.message ||
      error?.details ||
      null;
  }

  messages.set(messageId, message);
  return message;
}

function attachCrmId(messageId, crmId) {
  const message = messages.get(messageId);
  if (!message) return null;
  message.crmId = crmId;
  return message;
}

module.exports = {
  createMessage,
  getMessage,
  getMessages,
  updateMessage,
  attachCrmId
};
