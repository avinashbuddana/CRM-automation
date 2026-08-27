const { config } = require("./config");

function datePartsInTimeZone(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function datePartsAfterDays(days) {
  const today = datePartsInTimeZone();
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
  base.setUTCDate(base.getUTCDate() + days);

  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate()
  };
}

function isoDate(parts) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

function parseBirthDate(value) {
  if (!value) return null;

  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const test = new Date(Date.UTC(year, month - 1, day));

  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() + 1 !== month ||
    test.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function birthdayOccurrenceForYear(birthDate, year) {
  const parsed = parseBirthDate(birthDate);
  if (!parsed) return null;

  // Feb 29: for non-leap years we keep Mar 1 for sorting/demo consistency.
  const candidate = new Date(Date.UTC(year, parsed.month - 1, parsed.day));

  return {
    year: candidate.getUTCFullYear(),
    month: candidate.getUTCMonth() + 1,
    day: candidate.getUTCDate()
  };
}

function daysUntilBirthday(birthDate) {
  const today = datePartsInTimeZone();
  const todayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day));

  let occurrence = birthdayOccurrenceForYear(birthDate, today.year);
  if (!occurrence) return null;

  let birthdayUtc = new Date(
    Date.UTC(occurrence.year, occurrence.month - 1, occurrence.day)
  );

  if (birthdayUtc < todayUtc) {
    occurrence = birthdayOccurrenceForYear(birthDate, today.year + 1);
    birthdayUtc = new Date(
      Date.UTC(occurrence.year, occurrence.month - 1, occurrence.day)
    );
  }

  return Math.round((birthdayUtc - todayUtc) / 86400000);
}

function isBirthdayOn(contact, targetParts) {
  const birth = parseBirthDate(contact.birthDate);
  if (!birth) return false;

  return birth.month === targetParts.month && birth.day === targetParts.day;
}

function alreadySentThisYear(contact) {
  if (!contact.lastBirthdaySent) return false;

  const sent = String(contact.lastBirthdaySent).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!sent) return false;

  const today = datePartsInTimeZone();
  return Number(sent[1]) === today.year;
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function contactEligibility(contact) {
  const reasons = [];

  const normalizedPhone = normalizePhone(contact.phone);

  if (!contact.name) reasons.push("Missing name");
  if (!parseBirthDate(contact.birthDate)) reasons.push("Missing/invalid birthday");

  if (normalizedPhone.length < 8 || normalizedPhone.length > 15) {
    reasons.push("Invalid WhatsApp phone number");
  }

  if (config.espo.requireOptIn && !contact.whatsAppOptIn) {
    reasons.push("WhatsApp opt-in required");
  }

  if (!config.espo.allowRepeatSend && alreadySentThisYear(contact)) {
    reasons.push("Birthday message already sent this year");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    normalizedPhone
  };
}

function decorateContact(contact) {
  const days = daysUntilBirthday(contact.birthDate);
  const eligibility = contactEligibility(contact);

  let bucket = "upcoming";
  if (days === 0) bucket = "today";
  else if (days === 1) bucket = "tomorrow";
  else if (typeof days === "number" && days <= 7) bucket = "next7";

  return {
    ...contact,
    daysUntilBirthday: days,
    birthdayBucket: bucket,
    eligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    normalizedPhone: eligibility.normalizedPhone,
    alreadySentThisYear: alreadySentThisYear(contact)
  };
}

function sortContacts(contacts) {
  return contacts
    .map(decorateContact)
    .sort((a, b) => {
      const da =
        typeof a.daysUntilBirthday === "number"
          ? a.daysUntilBirthday
          : Number.MAX_SAFE_INTEGER;
      const db =
        typeof b.daysUntilBirthday === "number"
          ? b.daysUntilBirthday
          : Number.MAX_SAFE_INTEGER;

      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
}

function groupContacts(contacts) {
  const sorted = sortContacts(contacts);

  return {
    total: sorted.length,
    today: sorted.filter((c) => c.daysUntilBirthday === 0),
    tomorrow: sorted.filter((c) => c.daysUntilBirthday === 1),
    next7: sorted.filter(
      (c) =>
        typeof c.daysUntilBirthday === "number" &&
        c.daysUntilBirthday >= 2 &&
        c.daysUntilBirthday <= 7
    ),
    upcoming: sorted.filter(
      (c) =>
        typeof c.daysUntilBirthday === "number" &&
        c.daysUntilBirthday > 7
    ),
    invalid: sorted.filter((c) => c.daysUntilBirthday === null),
    all: sorted
  };
}

function todayIso() {
  return isoDate(datePartsInTimeZone());
}

module.exports = {
  datePartsInTimeZone,
  datePartsAfterDays,
  isoDate,
  parseBirthDate,
  daysUntilBirthday,
  isBirthdayOn,
  alreadySentThisYear,
  normalizePhone,
  contactEligibility,
  decorateContact,
  sortContacts,
  groupContacts,
  todayIso
};
