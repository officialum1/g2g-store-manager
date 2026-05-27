# G2G Seller Store Automation System

This project automates a G2G seller store for three product families:

- `boosting`
- `account`
- `smm` for views, followers, and likes

It uses:

- Node.js + Express for the API server
- PostgreSQL for orders, deliveries, inventory, and webhook logs
- Redis + BullMQ for background delivery processing
- node-cron for a 5-minute fallback order poller

## Features Included

- HMAC-signed G2G API client with retry handling for HTTP `429`
- Webhook ingestion for `order.api_delivery` and `order.confirmed`
- Async BullMQ delivery worker on queue `deliveries`
- Transaction-safe account inventory reservation in PostgreSQL
- Generic SMM panel integration with add + status polling
- Fallback order polling every 5 minutes for missed webhook events

## Setup

1. Copy the example environment file and fill in real values.

```bash
cp .env.example .env
```

2. Install dependencies.

```bash
npm install
```

3. Make sure PostgreSQL is running and that `DATABASE_URL` points to an existing database.

4. Make sure Redis is running and that `REDIS_URL` is reachable.

5. Start the service.

```bash
npm start
```

## Database Migration

There is no separate migration tool in this project. On startup, the service automatically creates these tables if they do not already exist:

- `orders`
- `deliveries`
- `inventory`
- `webhook_logs`

If you want to create the database first:

```sql
CREATE DATABASE g2g_store_manager;
```

## Required Environment Variables

```env
G2G_API_KEY=
G2G_API_SECRET=
G2G_WEBHOOK_SECRET=
DATABASE_URL=
REDIS_URL=
SMM_PANEL_URL=
SMM_PANEL_KEY=
PORT=
```

## Run Flow

1. G2G sends `order.api_delivery` to `POST /webhook/g2g`.
2. The webhook route verifies the signature, stores the raw payload, and responds `200`.
3. A BullMQ job is added to the `deliveries` queue.
4. The worker routes the order by `offer_type`.
5. Delivery is only posted back to G2G after inventory or SMM completion succeeds.
6. If the webhook is missed, the cron poller checks for `pending_delivery` orders every 5 minutes.

## Register The Webhook In G2G

Based on the public G2G OpenAPI docs, webhook setup is done in the G2G seller dashboard under the OpenAPI or API Integration area.

Use this URL:

```text
https://your-domain.example/webhook/g2g
```

Recommended checklist:

1. Open the G2G seller dashboard.
2. Go to the OpenAPI or API Integration section.
3. Add the webhook endpoint URL above.
4. Subscribe to at least `order.api_delivery` and `order.confirmed`.
5. Save the webhook secret into `G2G_WEBHOOK_SECRET`.

## Add Inventory Items

Account inventory is stored in PostgreSQL. Insert one inventory row per deliverable account.

Example:

```sql
INSERT INTO inventory (offer_id, content, content_type, status)
VALUES
  ('offer-1001', 'username:demo_account_01\npassword:strong-password-01', 'text/plain', 'available'),
  ('offer-1001', 'username:demo_account_02\npassword:strong-password-02', 'text/plain', 'available');
```

You can verify inventory with:

```sql
SELECT *
FROM inventory
WHERE offer_id = 'offer-1001'
ORDER BY created_at ASC;
```

## Add A New Offer Type Handler

Offer-type routing is centralized in [src/services/deliveryService.js](C:\Users\officialum1 llc\Desktop\g2g\g2g-store-manager\src\services\deliveryService.js).

To add a new handler:

1. Extend `normalizeOfferType()` so the incoming G2G payload maps to the new internal type.
2. Add a new `handle...` function in `deliveryService.js`.
3. Add a new branch inside `processDeliveryJob()` to route the new type.
4. Update the order payload enrichment in [src/routes/webhook.js](C:\Users\officialum1 llc\Desktop\g2g\g2g-store-manager\src\routes\webhook.js) and [src/jobs/orderPoller.js](C:\Users\officialum1 llc\Desktop\g2g\g2g-store-manager\src\jobs\orderPoller.js) if the new type needs extra fields.

## Important Note About G2G Auth

This implementation follows the requested contract for this project:

- HMAC-SHA256 signature from `API_KEY + timestamp + sorted request body`
- Headers include `g2g-signature` and `g2g-timestamp`

The current public G2G samples and docs also show additional auth headers and a path-based signing variant in some examples. If your seller account uses that contract, adjust [src/services/g2gClient.js](C:\Users\officialum1 llc\Desktop\g2g\g2g-store-manager\src\services\g2gClient.js) and [src/routes/webhook.js](C:\Users\officialum1 llc\Desktop\g2g\g2g-store-manager\src\routes\webhook.js) before production rollout.
