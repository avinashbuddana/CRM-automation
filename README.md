# Neurixa CRM → WhatsApp Birthday Automation

A complete Node.js proof of concept for demonstrating:

**EspoCRM → live customer birthdays → WhatsApp Business Cloud API → delivery webhook → update EspoCRM**

The Node service does **not** maintain its own permanent customer database. Contacts are fetched live from EspoCRM.

## Features

- Fetch Contacts or Leads directly from EspoCRM.
- Dashboard groups birthdays into:
  - Today
  - Tomorrow
  - Next 7 days
  - Upcoming
  - All
- Search by name or phone.
- Per-contact **Send WhatsApp** button.
- **Send today's wishes** bulk action with a safety limit.
- Approved WhatsApp template with `{{1}} = customer name`.
- Meta webhook verification.
- Tracks:
  - Accepted
  - Sent
  - Delivered
  - Read
  - Failed
- Writes WhatsApp message ID and delivery state back to the CRM.
- Optional daily cron automation.
- No WhatsApp access token exposed to browser JavaScript.
- No permanent customer-data copy in Node.js.

---

# 1. EspoCRM fields

Use the `Contact` entity for the demo.

Open:

**Administration → Entity Manager → Contact → Fields**

Create these custom fields.

| Label | Type | Suggested field name |
|---|---|---|
| Birth Date | Date | `birthDate` |
| WhatsApp Opt In | Boolean | `whatsAppOptIn` |
| Last Birthday Sent | Date | `lastBirthdaySent` |
| WhatsApp Status | Varchar or Text | `whatsAppStatus` |
| WhatsApp Message ID | Varchar or Text | `whatsAppMessageId` |

EspoCRM normally prefixes a custom field name with `c`.

For example, `birthDate` will normally become:

`cBirthDate`

The exact technical field names are visible in:

**Administration → Entity Manager → Contact → Fields → Name**

Use those exact names in `.env`.

Also add these fields to your Contact layout using:

**Administration → Layout Manager → Contacts**

## Demo contact

Create:

- Name: `Avinash`
- Phone: `+918320103048`
- Birth Date: today's month/day
- WhatsApp Opt In: Yes

---

# 2. Create EspoCRM API user

Go to:

**Administration → API Users → Create API User**

Use:

- Authentication Method: API Key
- Assign a Role that can:
  - Read Contacts
  - Edit Contacts

Copy the API key.

EspoCRM API authentication uses:

`X-Api-Key: YOUR_API_KEY`

---

# 3. Configure environment

Copy:

```bash
cp .env.example .env
```

Set:

```env
ESPO_URL=https://YOUR-ESPOCRM.onrender.com
ESPO_API_KEY=YOUR_API_KEY

ESPO_ENTITY=Contact

ESPO_NAME_FIELD=name
ESPO_PHONE_FIELD=phoneNumber

ESPO_BIRTHDATE_FIELD=cBirthDate
ESPO_OPTIN_FIELD=cWhatsAppOptIn
ESPO_LAST_SENT_FIELD=cLastBirthdaySent
ESPO_STATUS_FIELD=cWhatsAppStatus
ESPO_MESSAGE_ID_FIELD=cWhatsAppMessageId
```

Then WhatsApp:

```env
WHATSAPP_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN=YOUR_ACCESS_TOKEN

WHATSAPP_TEMPLATE_NAME=birthdar_wish
WHATSAPP_LANGUAGE_CODE=en

META_GRAPH_VERSION=v25.0
```

The current template used during the POC is positional:

`{{1}} = customer name`

So keep:

```env
WHATSAPP_TEMPLATE_HAS_NAME=true
```

## POC vs production safety

For repeated demo testing:

```env
REQUIRE_WHATSAPP_OPT_IN=false
ALLOW_REPEAT_SEND=true
```

For production:

```env
REQUIRE_WHATSAPP_OPT_IN=true
ALLOW_REPEAT_SEND=false
```

---

# 4. Install and run

Node.js 18+ is required.

```bash
npm install
npm start
```

Open:

`http://localhost:3000`

You should see CRM contacts loaded into the dashboard.

---

# 5. Test EspoCRM API

From the browser dashboard, the CRM status should show **EspoCRM connected**.

Or call:

```bash
curl http://localhost:3000/api/crm/test
```

Expected:

```json
{
  "ok": true,
  "entity": "Contact",
  "total": 1
}
```

If you receive an Espo error, verify:

- URL
- API key
- API user's Role
- entity name
- custom technical field names

---

# 6. Birthday dashboard logic

The service compares only the month and day.

Example:

CRM birth date:

`2000-08-26`

Current date:

`2026-08-26`

Result:

`Today`

The dashboard sorts birthdays by the next occurrence.

---

# 7. WhatsApp send flow

Click **Send WhatsApp** beside a contact.

The server fetches that Contact directly from EspoCRM again, validates it, then calls:

`POST /PHONE_NUMBER_ID/messages`

with the approved template.

Example payload shape:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "918320103048",
  "type": "template",
  "template": {
    "name": "birthdar_wish",
    "language": {
      "code": "en"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          {
            "type": "text",
            "text": "Avinash"
          }
        ]
      }
    ]
  }
}
```

When Meta initially accepts it, the CRM is updated with:

- WhatsApp Status = `Accepted by Meta`
- WhatsApp Message ID = `wamid...`

That is **not** treated as final delivery.

---

# 8. Configure local Meta webhook

Meta cannot call localhost directly.

Run the app:

```bash
npm start
```

Then expose it with ngrok:

```bash
ngrok http 3000
```

Example:

`https://abc123.ngrok-free.app`

In `.env` choose a verify token:

```env
WEBHOOK_VERIFY_TOKEN=neurixa_whatsapp_demo_2026
```

In Meta Developer Dashboard configure:

Callback URL:

`https://abc123.ngrok-free.app/webhook`

Verify token:

`neurixa_whatsapp_demo_2026`

Subscribe the WABA/app to the `messages` webhook field.

The app implements:

- `GET /webhook` — Meta verification
- `POST /webhook` — incoming events and message status updates

---

# 9. Webhook → CRM update

When Meta reports:

`sent`

CRM becomes:

`Sent`

When Meta reports:

`delivered`

CRM becomes:

`Delivered`

and `Last Birthday Sent` is updated to today's date.

When Meta reports:

`read`

CRM becomes:

`Read`

When Meta reports:

`failed`

CRM stores:

`Failed: <Meta reason>`

The UI silently refreshes the CRM every 5 seconds so the status changes appear without reloading.

---

# 10. Send all today's birthdays

The dashboard has:

**Send today's wishes**

Only eligible contacts are included.

Safety limit:

```env
MAX_BULK_SEND=50
```

Increase deliberately if required.

---

# 11. Optional daily automation

After the demo works, turn on:

```env
ENABLE_DAILY_JOB=true
DAILY_CRON=0 9 * * *
APP_TIMEZONE=Asia/Kolkata
```

This runs at 09:00 each day.

Production recommendation:

```env
REQUIRE_WHATSAPP_OPT_IN=true
ALLOW_REPEAT_SEND=false
```

The production flow becomes:

```text
09:00 daily
   ↓
Fetch live EspoCRM Contacts
   ↓
Birthday today?
   ↓
Opted in?
   ↓
Already sent this year?
   ↓
Send WhatsApp template
   ↓
Meta webhook
   ↓
Delivered / Read / Failed
   ↓
Write status back to EspoCRM
```

---

# 12. Render deployment for this Node service

You can deploy this Node project as a second Render Web Service.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Add the environment variables from `.env.example` in Render's **Environment** section.

Do not commit `.env`.

For production webhook configuration use the permanent Render URL:

`https://YOUR-AUTOMATION-SERVICE.onrender.com/webhook`

instead of ngrok.

---

# 13. Important production notes

- Use a production WhatsApp Business phone number.
- Use an approved template that exists in that production WABA.
- Use a long-lived/system-user Meta token.
- Require customer WhatsApp opt-in.
- Keep duplicate protection enabled.
- Start with small batches.
- Monitor delivery failures and number quality.
- Add dashboard authentication before exposing this POC publicly.
- For large CRM datasets, move birthday filtering to CRM-side queries or a dedicated integration layer instead of fetching thousands of contacts each run.

---

# Useful routes

```text
GET  /api/health
GET  /api/config
GET  /api/crm/test
GET  /api/contacts
GET  /api/contacts/:id

POST /api/contacts/:id/send
POST /api/send-today

GET  /api/message-status
GET  /api/message-status/:messageId

GET  /webhook
POST /webhook
```


---

# Add customers directly from the automation dashboard

Version 2 includes an **Add customer** button in the Neurixa dashboard.

The flow is:

```text
Neurixa Dashboard
      ↓
Add Customer form
      ↓
POST /api/contacts
      ↓
Node.js
      ↓
EspoCRM REST API
      ↓
Contact created in CRM
      ↓
Dashboard refreshes live
```

The Node service does not keep a separate permanent customer database.

## Form fields

The dashboard asks for:

- Customer Name
- WhatsApp Phone
- Date of Birth
- WhatsApp Opt-In

Example:

```text
Name:
Avinash

WhatsApp:
+918320103048

Date of Birth:
2000-08-26

WhatsApp Opt-In:
Yes
```

## API route

The dashboard calls:

```text
POST /api/contacts
```

Example request:

```json
{
  "name": "Avinash",
  "phone": "+918320103048",
  "birthDate": "2000-08-26",
  "whatsAppOptIn": true
}
```

The Node backend maps those values to the EspoCRM technical fields configured in `.env`, then calls the EspoCRM entity-create endpoint.

After creation, the contact is fetched again from EspoCRM and returned to the dashboard.

For demo convenience, the form defaults the birthday to **today**, so a newly created test contact immediately appears in the **Today** tab. You can change the date before saving.

## Required API permission

Your EspoCRM API user role now needs:

```text
Contact:
Create ✅
Read   ✅
Edit   ✅
```

`Create` is required for the new Add Customer form.

## Full demo

```text
1. Open Neurixa Birthday Automation

2. Click:
   + Add customer

3. Enter:
   Avinash
   +918320103048
   Birthday = today
   WhatsApp opt-in = Yes

4. Click:
   Add to CRM

5. Node creates the record directly in EspoCRM.

6. The dashboard refreshes.

7. Avinash appears under:
   Today

8. Click:
   Send WhatsApp

9. Meta accepts message.

10. Webhook updates:
    Sent → Delivered → Read

11. EspoCRM is automatically updated with:
    WhatsApp Status
    WhatsApp Message ID
    Last Birthday Sent
```
