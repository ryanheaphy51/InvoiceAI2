# InvoiceAI2

A zero-dependency invoice workspace inspired by modern payment tools. It lets you:

- Manage a branded customer database with company logo, payment terms, currency defaults, and postal addresses.
- Capture detailed product data (name, barcode, SKU, RRP, cost price, and sales price) and reuse the products when building invoices.
- Generate invoices in GBP with live totals, pull in product details via dropdowns, persist them, email them through your SMTP provider, and collect card payments via Stripe Checkout sessions.
- Track payments, mark invoices as paid, and visualise monthly cash-in as well as products sold.
- Navigate a sidebar workspace to add, edit, and review customers, products, invoices, and payments without cluttering the screen.

The stack intentionally avoids third-party packages due to network restrictions in this environment. The Python HTTP server relies only on the standard library and serves both the API and the static dashboard.

## Project layout

```
InvoiceAI2
├── client              # Static front-end (HTML/CSS/JS)
├── server              # Python API + file-based storage
├── README.md
```

## Prerequisites

- Python 3.10+
- A Stripe account (for Checkout sessions) and SMTP credentials for outbound emails.

## Configuration

1. Copy `server/.env.example` to `server/.env` and fill in the values:

```bash
cp server/.env.example server/.env
```

| Variable | Description |
| --- | --- |
| `PORT` | Port for the combined API + static server (default `8000`). |
| `STRIPE_SECRET_KEY` | Secret key used to create Stripe Checkout sessions. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` | Credentials for the mailbox that will send invoices. |
| `EMAIL_FROM` | Friendly email shown to recipients. |

## Running locally

```bash
# from the repo root
cd server
python app.py
```

Then open http://localhost:8000 in your browser. The Python server exposes the API under `/api/*` and serves the front-end from the `/client` folder.

## Containerised / production deployment

You can deploy the workspace as a single container without installing Python on the host.

### Build and run with Docker

```bash
# build the image (run from repo root)
docker build -t invoiceai .

# create a .env file with your secrets
cp server/.env.example server/.env
vim server/.env  # or edit with your preferred editor

# start the container and expose port 8000
docker run --env-file server/.env -p 8000:8000 invoiceai
```

### Use docker-compose for persistent data

The bundled `docker-compose.yml` keeps the JSON database on the host (`./server/data`) so restarts do not wipe invoices. It also automatically loads environment variables from `server/.env`.

```bash
cp server/.env.example server/.env
vim server/.env

docker compose up --build
```

When running in production, point your reverse proxy at the host + port exposed by Docker (default `8000`). The process inside the container still serves both the API and the static client.

## Key API routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET /api/settings` | Fetch saved branding/payment defaults. |
| `PUT /api/settings` | Update company name, logo URL, payment terms, and currency. |
| `GET/POST /api/customers` | Manage the customer directory (name, email, company, phone, address). |
| `PUT/DELETE /api/customers/:id` | Edit or remove a customer record. |
| `GET/POST /api/products` | Manage catalog products with SKU, barcode, RRP, cost price, and sales price. |
| `PUT/DELETE /api/products/:id` | Edit or delete a product. |
| `GET/POST /api/invoices` | Create invoices with rich line items and list them. |
| `PUT/DELETE /api/invoices/:id` | Update invoice metadata/items or delete an invoice. |
| `POST /api/invoices/:id/payments` | Record a payment (manual or Stripe) against an invoice. |
| `POST /api/invoices/:id/send-email` | Email the invoice to the customer's saved email. |
| `POST /api/payments/stripe/session` | Generate a Stripe Checkout URL for the invoice. |
| `GET /api/payments` | View every payment across invoices for the payments panel. |
| `PUT/DELETE /api/payments/:id` | Edit or remove a specific recorded payment. |
| `GET /api/dashboard` | Return aggregated payment totals and product quantities for the UI cards. |

## Stripe + payments flow

1. Create an invoice from the UI.
2. Click **Create Stripe checkout** to create a Checkout session with the invoice line items.
3. Share the generated URL or open it directly to collect payment. Once Stripe confirms the payment, record the amount inside the UI by selecting **Record payment** (or build a webhook pointing to `/api/invoices/:id/payments`).

## Emailing invoices

The **Email invoice** action uses the SMTP configuration to send an HTML summary to the customer's stored email address. The template contains your company name, logo, invoice totals, and due date.

## Data persistence

Data is stored in `server/data/db.json`. You can back up or reset the system by editing that file while the server is stopped.

## Development tips

- The UI fetches everything from the same origin, so keeping the Python server running is enough to test changes.
- Update the stylesheet (`client/styles.css`) for visual tweaks and `client/app.js` for interactions.
- The dashboard chart uses vanilla DOM rendering so you can easily extend it to include more analytics.
