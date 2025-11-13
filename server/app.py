import json
import os
import http.client
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, urlencode

ROOT_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIR = ROOT_DIR / "client"
DATA_PATH = Path(__file__).resolve().parent / "data" / "db.json"
ENV_PATH = Path(__file__).resolve().parent / ".env"


def load_env_file():
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text().splitlines():
        if not line or line.strip().startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env_file()


def load_db():
    if not DATA_PATH.exists():
        DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        DATA_PATH.write_text(json.dumps({
            "customers": [],
            "products": [],
            "invoices": [],
            "payments": [],
            "settings": {
                "companyName": "",
                "logoUrl": "",
                "defaultPaymentTerms": "Due on receipt",
                "currency": "usd"
            }
        }, indent=2))
    with DATA_PATH.open() as f:
        return json.load(f)


def save_db(data):
    DATA_PATH.write_text(json.dumps(data, indent=2))


def compute_invoice_totals(invoice):
    subtotal = 0.0
    discount_total = 0.0
    for item in invoice.get("items", []):
        qty = float(item.get("qty", 0))
        unit_cost = float(item.get("cost", 0))
        discount_pct = float(item.get("discount", 0))
        line_subtotal = qty * unit_cost
        discount_amount = line_subtotal * (discount_pct / 100)
        line_total = line_subtotal - discount_amount
        subtotal += line_total
        discount_total += discount_amount
        item["lineTotal"] = round(line_total, 2)
        item["unitPrice"] = round(unit_cost - (unit_cost * discount_pct / 100), 2)
    invoice["subtotal"] = round(subtotal, 2)
    invoice["discountTotal"] = round(discount_total, 2)
    invoice["total"] = round(subtotal, 2)
    paid = sum(p.get("amount", 0) for p in invoice.get("payments", []))
    invoice["paidTotal"] = round(paid, 2)
    invoice["balanceDue"] = round(invoice["total"] - invoice["paidTotal"], 2)
    invoice["status"] = "paid" if invoice["balanceDue"] <= 0 else "pending"
    return invoice


def send_invoice_email(customer, invoice, settings):
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("EMAIL_FROM") or smtp_user
    if not (smtp_host and smtp_user and smtp_password and sender):
        raise ValueError("SMTP credentials are not configured. Please set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, and EMAIL_FROM")

    message = MIMEMultipart("alternative")
    message["Subject"] = f"Invoice {invoice['invoiceNumber']}"
    message["From"] = sender
    message["To"] = customer["email"]

    company_name = settings.get("companyName", "")
    logo = settings.get("logoUrl")
    items_html = "".join([
        f"<tr><td>{item['productName']}</td><td>{item['qty']}</td><td>{item['unitPrice']}</td><td>{item['lineTotal']}</td></tr>"
        for item in invoice.get("items", [])
    ])

    html = f"""
    <html>
      <body style='font-family: Arial, sans-serif;'>
        <h2>{company_name or 'Invoice Summary'}</h2>
        {f'<img src="{logo}" style="max-height:60px" />' if logo else ''}
        <p>Hi {customer['name']},</p>
        <p>Thank you for your business. Please find your invoice details below.</p>
        <table style='width:100%;border-collapse:collapse;'>
          <thead>
            <tr>
              <th align='left'>Product</th>
              <th align='left'>Qty</th>
              <th align='left'>Price</th>
              <th align='left'>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items_html}
          </tbody>
        </table>
        <p><strong>Total:</strong> {invoice['total']} {invoice.get('currency', 'usd').upper()}</p>
        <p><strong>Due Date:</strong> {invoice.get('dueDate', 'N/A')}</p>
        <p>Payment Terms: {invoice.get('paymentTerms', settings.get('defaultPaymentTerms', 'Due on receipt'))}</p>
      </body>
    </html>
    """

    message.attach(MIMEText(html, "html"))
    with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
        server.login(smtp_user, smtp_password)
        server.sendmail(sender, [customer["email"]], message.as_string())


def create_checkout_session(invoice, success_url, cancel_url):
    secret = os.getenv("STRIPE_SECRET_KEY")
    if not secret:
        raise ValueError("STRIPE_SECRET_KEY is not configured")
    params = [
        ("mode", "payment"),
        ("success_url", success_url),
        ("cancel_url", cancel_url)
    ]
    currency = invoice.get("currency", "usd")
    for index, item in enumerate(invoice.get("items", [])):
        prefix = f"line_items[{index}]"
        unit_amount = int(float(item.get("unitPrice", item.get("cost", 0))) * 100)
        params.extend([
            (f"{prefix}[price_data][currency]", currency),
            (f"{prefix}[price_data][product_data][name]", item.get("productName", "Item")),
            (f"{prefix}[price_data][unit_amount]", str(max(unit_amount, 0))),
            (f"{prefix}[quantity]", str(int(item.get("qty", 1))))
        ])
    body = urlencode(params)
    conn = http.client.HTTPSConnection("api.stripe.com")
    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    conn.request("POST", "/v1/checkout/sessions", body, headers)
    response = conn.getresponse()
    payload = json.loads(response.read())
    if response.status >= 400:
        message = payload.get("error", {}).get("message", "Stripe error")
        raise ValueError(message)
    return payload


def build_dashboard(data):
    monthly = {}
    for payment in data.get("payments", []):
        try:
            date = datetime.fromisoformat(payment["date"])
        except ValueError:
            continue
        key = date.strftime("%Y-%m")
        monthly[key] = monthly.get(key, 0) + float(payment.get("amount", 0))
    monthly_points = [
        {"month": key, "total": round(total, 2)}
        for key, total in sorted(monthly.items())
    ]
    product_totals = {}
    for invoice in data.get("invoices", []):
        for item in invoice.get("items", []):
            name = item.get("productName", "Unnamed")
            product_totals[name] = product_totals.get(name, 0) + float(item.get("qty", 0))
    top_products = [
        {"name": name, "qty": qty}
        for name, qty in sorted(product_totals.items(), key=lambda x: x[1], reverse=True)
    ]
    return {"monthlyPayments": monthly_points, "topProducts": top_products[:8]}


class InvoiceRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CLIENT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_request(parsed)
        else:
            if parsed.path == "/":
                self.path = "/index.html"
            return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_request(parsed)
        else:
            self.send_error(404, "Not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_request(parsed)
        else:
            self.send_error(404, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_request(parsed)
        else:
            self.send_error(404, "Not found")

    def parse_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        data = self.rfile.read(length)
        if not data:
            return {}
        return json.loads(data.decode("utf-8"))

    def json_response(self, payload, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def handle_api_request(self, parsed):
        path = parsed.path
        method = self.command
        data = load_db()
        try:
            if path == "/api/health" and method == "GET":
                return self.json_response({"status": "ok"})
            if path == "/api/customers":
                if method == "GET":
                    return self.json_response(data["customers"])
                elif method == "POST":
                    payload = self.parse_body()
                    customer = {
                        "id": f"cust_{int(datetime.utcnow().timestamp()*1000)}",
                        "name": payload.get("name"),
                        "email": payload.get("email"),
                        "company": payload.get("company"),
                        "phone": payload.get("phone")
                    }
                    data["customers"].append(customer)
                    save_db(data)
                    return self.json_response(customer, 201)
            if path.startswith("/api/customers/"):
                customer_id = path.split("/")[-1]
                if method == "PUT":
                    payload = self.parse_body()
                    for customer in data["customers"]:
                        if customer["id"] == customer_id:
                            customer.update(payload)
                            save_db(data)
                            return self.json_response(customer)
                    return self.json_response({"error": "Customer not found"}, 404)
                if method == "DELETE":
                    data["customers"] = [c for c in data["customers"] if c["id"] != customer_id]
                    save_db(data)
                    return self.json_response({"status": "deleted"})
            if path == "/api/products":
                if method == "GET":
                    return self.json_response(data["products"])
                elif method == "POST":
                    payload = self.parse_body()
                    product = {
                        "id": f"prod_{int(datetime.utcnow().timestamp()*1000)}",
                        "name": payload.get("name"),
                        "sku": payload.get("sku"),
                        "barcode": payload.get("barcode"),
                        "rrp": float(payload.get("rrp", 0)),
                        "cost": float(payload.get("cost", 0))
                    }
                    data["products"].append(product)
                    save_db(data)
                    return self.json_response(product, 201)
            if path.startswith("/api/products/"):
                product_id = path.split("/")[-1]
                if method == "PUT":
                    payload = self.parse_body()
                    for product in data["products"]:
                        if product["id"] == product_id:
                            product.update({
                                "name": payload.get("name", product.get("name")),
                                "sku": payload.get("sku", product.get("sku")),
                                "barcode": payload.get("barcode", product.get("barcode")),
                                "rrp": float(payload.get("rrp", product.get("rrp", 0))),
                                "cost": float(payload.get("cost", product.get("cost", 0)))
                            })
                            save_db(data)
                            return self.json_response(product)
                    return self.json_response({"error": "Product not found"}, 404)
                if method == "DELETE":
                    data["products"] = [p for p in data["products"] if p["id"] != product_id]
                    save_db(data)
                    return self.json_response({"status": "deleted"})
            if path == "/api/settings":
                if method == "GET":
                    return self.json_response(data["settings"])
                elif method == "PUT":
                    payload = self.parse_body()
                    data["settings"].update({k: v for k, v in payload.items() if v is not None})
                    save_db(data)
                    return self.json_response(data["settings"])
            if path == "/api/invoices":
                if method == "GET":
                    invoices = [compute_invoice_totals(inv) for inv in data["invoices"]]
                    save_db(data)
                    return self.json_response(invoices)
                elif method == "POST":
                    payload = self.parse_body()
                    invoice = {
                        "id": f"inv_{int(datetime.utcnow().timestamp()*1000)}",
                        "invoiceNumber": payload.get("invoiceNumber") or f"INV-{len(data['invoices'])+1:04d}",
                        "customerId": payload.get("customerId"),
                        "issueDate": payload.get("issueDate") or datetime.utcnow().date().isoformat(),
                        "dueDate": payload.get("dueDate"),
                        "paymentTerms": payload.get("paymentTerms") or data["settings"].get("defaultPaymentTerms"),
                        "notes": payload.get("notes"),
                        "currency": payload.get("currency") or data["settings"].get("currency", "usd"),
                        "logoUrl": payload.get("logoUrl") or data["settings"].get("logoUrl"),
                        "items": payload.get("items", []),
                        "payments": []
                    }
                    compute_invoice_totals(invoice)
                    data["invoices"].append(invoice)
                    save_db(data)
                    return self.json_response(invoice, 201)
            if path.startswith("/api/invoices/"):
                parts = path.split("/")
                invoice_id = parts[3]
                invoice = next((inv for inv in data["invoices"] if inv["id"] == invoice_id), None)
                if not invoice:
                    return self.json_response({"error": "Invoice not found"}, 404)
                if len(parts) == 4:
                    if method == "GET":
                        compute_invoice_totals(invoice)
                        save_db(data)
                        return self.json_response(invoice)
                    if method == "PUT":
                        payload = self.parse_body()
                        allowed_keys = {
                            "customerId",
                            "paymentTerms",
                            "dueDate",
                            "notes",
                            "items",
                            "currency",
                            "logoUrl",
                            "issueDate"
                        }
                        for key in allowed_keys:
                            if key in payload and payload[key] is not None:
                                if key == "items":
                                    invoice[key] = payload[key]
                                else:
                                    invoice[key] = payload[key]
                        compute_invoice_totals(invoice)
                        save_db(data)
                        return self.json_response(invoice)
                    if method == "DELETE":
                        data["invoices"] = [inv for inv in data["invoices"] if inv["id"] != invoice_id]
                        save_db(data)
                        return self.json_response({"status": "deleted"})
                elif len(parts) == 5 and parts[4] == "payments" and method == "POST":
                    payload = self.parse_body()
                    payment = {
                        "id": f"pay_{int(datetime.utcnow().timestamp()*1000)}",
                        "invoiceId": invoice_id,
                        "amount": float(payload.get("amount", 0)),
                        "method": payload.get("method", "manual"),
                        "date": payload.get("date") or datetime.utcnow().isoformat(),
                        "notes": payload.get("notes")
                    }
                    invoice.setdefault("payments", []).append(payment)
                    data.setdefault("payments", []).append(payment)
                    compute_invoice_totals(invoice)
                    save_db(data)
                    return self.json_response(invoice)
                elif len(parts) == 5 and parts[4] == "send-email" and method == "POST":
                    customer = next((c for c in data["customers"] if c["id"] == invoice["customerId"]), None)
                    if not customer:
                        return self.json_response({"error": "Customer missing"}, 400)
                    try:
                        send_invoice_email(customer, compute_invoice_totals(invoice), data["settings"])
                        return self.json_response({"status": "sent"})
                    except Exception as exc:  # pylint: disable=broad-except
                        return self.json_response({"error": str(exc)}, 400)
            if path == "/api/payments/stripe/session" and method == "POST":
                payload = self.parse_body()
                invoice_id = payload.get("invoiceId")
                invoice = next((inv for inv in data["invoices"] if inv["id"] == invoice_id), None)
                if not invoice:
                    return self.json_response({"error": "Invoice not found"}, 404)
                try:
                    session = create_checkout_session(
                        compute_invoice_totals(invoice),
                        payload.get("successUrl"),
                        payload.get("cancelUrl")
                    )
                    invoice["stripeCheckoutUrl"] = session.get("url")
                    save_db(data)
                    return self.json_response({"url": session.get("url"), "id": session.get("id")})
                except Exception as exc:  # pylint: disable=broad-except
                    return self.json_response({"error": str(exc)}, 400)
            if path == "/api/payments" and method == "GET":
                return self.json_response(data.get("payments", []))
            if path.startswith("/api/payments/"):
                payment_id = path.split("/")[-1]
                payment = next((p for p in data.get("payments", []) if p["id"] == payment_id), None)
                if not payment:
                    return self.json_response({"error": "Payment not found"}, 404)
                if method == "PUT":
                    payload = self.parse_body()
                    payment.update({
                        "amount": float(payload.get("amount", payment.get("amount", 0))),
                        "method": payload.get("method", payment.get("method")),
                        "date": payload.get("date", payment.get("date")),
                        "notes": payload.get("notes", payment.get("notes"))
                    })
                    invoice = next((inv for inv in data["invoices"] if any(p["id"] == payment_id for p in inv.get("payments", []))), None)
                    if invoice:
                        for idx, inv_payment in enumerate(invoice.get("payments", [])):
                            if inv_payment["id"] == payment_id:
                                invoice["payments"][idx] = payment
                                compute_invoice_totals(invoice)
                                break
                    save_db(data)
                    return self.json_response(payment)
                if method == "DELETE":
                    data["payments"] = [p for p in data.get("payments", []) if p["id"] != payment_id]
                    for invoice in data["invoices"]:
                        invoice["payments"] = [p for p in invoice.get("payments", []) if p["id"] != payment_id]
                        compute_invoice_totals(invoice)
                    save_db(data)
                    return self.json_response({"status": "deleted"})
            if path == "/api/dashboard" and method == "GET":
                return self.json_response(build_dashboard(data))
            return self.json_response({"error": "Not found"}, 404)
        except json.JSONDecodeError:
            return self.json_response({"error": "Invalid JSON"}, 400)


def run(server_class=ThreadingHTTPServer, handler_class=InvoiceRequestHandler):
    port = int(os.getenv("PORT", "8000"))
    server_address = ("", port)
    httpd = server_class(server_address, handler_class)
    print(f"Invoice platform API running at http://localhost:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    run()
