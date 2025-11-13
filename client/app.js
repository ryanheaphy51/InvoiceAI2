const state = {
  settings: {},
  customers: [],
  products: [],
  invoices: [],
  payments: [],
  dashboard: {
    monthlyPayments: [],
    topProducts: [],
    snapshot: { totalInvoices: 0, totalCustomers: 0, paymentsThisMonth: 0 }
  }
};

const selectors = {
  settingsForm: document.getElementById('settingsForm'),
  customerForm: document.getElementById('customerForm'),
  productForm: document.getElementById('productForm'),
  invoiceForm: document.getElementById('invoiceForm'),
  invoiceCustomer: document.getElementById('invoiceCustomer'),
  invoiceItems: document.getElementById('invoiceItems'),
  invoiceTotals: document.getElementById('invoiceTotals'),
  customersList: document.getElementById('customersList'),
  productsList: document.getElementById('productsList'),
  invoicesList: document.getElementById('invoicesList'),
  paymentsList: document.getElementById('paymentsList'),
  paymentsChart: document.getElementById('paymentsChart'),
  topProducts: document.getElementById('topProducts'),
  refreshButton: document.getElementById('refreshButton'),
  apiStatus: document.getElementById('apiStatus'),
  addRowButton: document.getElementById('addRowButton'),
  navItems: document.querySelectorAll('.nav-item'),
  panels: document.querySelectorAll('.panel'),
  cancelCustomerEdit: document.getElementById('cancelCustomerEdit'),
  cancelProductEdit: document.getElementById('cancelProductEdit'),
  cancelInvoiceEdit: document.getElementById('cancelInvoiceEdit'),
  cancelPaymentEdit: document.getElementById('cancelPaymentEdit'),
  paymentForm: document.getElementById('paymentForm'),
  paymentInvoice: document.getElementById('paymentInvoice'),
  snapshotInvoices: document.getElementById('totalInvoices'),
  snapshotCustomers: document.getElementById('totalCustomers'),
  snapshotPayments: document.getElementById('paymentsMonth')
};

async function apiFetch(path, options = {}) {
  const opts = { ...options };
  opts.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  const response = await fetch(path, opts);
  selectors.apiStatus.textContent = `API: ${response.status}`;
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

function hydrateSettingsForm() {
  const { settingsForm } = selectors;
  settingsForm.companyName.value = state.settings.companyName || '';
  settingsForm.logoUrl.value = state.settings.logoUrl || '';
  const defaultTerms = state.settings.defaultPaymentTerms || 'On receipt';
  ensureSelectValue(settingsForm.defaultPaymentTerms, defaultTerms);
  settingsForm.currency.value = (state.settings.currency || 'gbp').toUpperCase();
  syncInvoicePaymentTerms();
}

function setActiveSection(section) {
  selectors.navItems.forEach((item) => {
    const isActive = item.dataset.section === section;
    item.classList.toggle('active', isActive);
  });
  selectors.panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${section}Panel`);
  });
}

function ensureSelectValue(selectElement, value) {
  if (!selectElement || !value) return;
  const exists = Array.from(selectElement.options).some((option) => option.value === value);
  if (!exists) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  }
  selectElement.value = value;
}

function syncInvoicePaymentTerms() {
  const defaultTerms = state.settings.defaultPaymentTerms || 'On receipt';
  if (selectors.invoiceForm && selectors.invoiceForm.paymentTerms) {
    ensureSelectValue(selectors.invoiceForm.paymentTerms, defaultTerms);
  }
}

function resetCustomerForm() {
  selectors.customerForm.reset();
  selectors.customerForm.customerId.value = '';
}

function resetProductForm() {
  selectors.productForm.reset();
  selectors.productForm.productId.value = '';
}

function resetInvoiceForm() {
  selectors.invoiceForm.reset();
  selectors.invoiceForm.invoiceId.value = '';
  selectors.invoiceItems.innerHTML = '';
  syncInvoicePaymentTerms();
  addItemRow();
}

function resetPaymentForm() {
  selectors.paymentForm.reset();
  selectors.paymentForm.paymentId.value = '';
  if (selectors.paymentForm.method) {
    selectors.paymentForm.method.value = 'BACs';
  }
}

function populateInvoiceSelects() {
  selectors.invoiceCustomer.innerHTML = '<option value="">Select customer</option>';
  state.customers.forEach((customer) => {
    const option = document.createElement('option');
    option.value = customer.id;
    option.textContent = `${customer.name} (${customer.company || 'Direct'})`;
    selectors.invoiceCustomer.appendChild(option);
  });

  selectors.paymentInvoice.innerHTML = '<option value="">Select invoice</option>';
  state.invoices.forEach((invoice) => {
    const option = document.createElement('option');
    option.value = invoice.id;
    option.textContent = `${invoice.invoiceNumber} · ${formatCurrency(invoice.total)}`;
    selectors.paymentInvoice.appendChild(option);
  });
}

function renderCustomers() {
  const { customersList } = selectors;
  customersList.innerHTML = '';
  state.customers.forEach((customer) => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div>
        <strong>${customer.name}</strong>
        <p>${customer.email || 'No email'} · ${customer.company || ''}</p>
        <small>${customer.phone || 'No phone'}${customer.address ? ` · ${customer.address}` : ''}</small>
      </div>
      <div class="product-actions">
        <button class="ghost" data-action="edit" data-id="${customer.id}">Edit</button>
        <button class="ghost" data-action="delete" data-id="${customer.id}">Delete</button>
      </div>
    `;
    customersList.appendChild(div);
  });
  customersList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const { action, id } = button.dataset;
      if (action === 'edit') {
        const customer = state.customers.find((c) => c.id === id);
        if (customer) {
          selectors.customerForm.customerId.value = customer.id;
          selectors.customerForm.name.value = customer.name || '';
          selectors.customerForm.company.value = customer.company || '';
          selectors.customerForm.email.value = customer.email || '';
          selectors.customerForm.phone.value = customer.phone || '';
          selectors.customerForm.address.value = customer.address || '';
        }
      }
      if (action === 'delete') {
        await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
        await loadCustomers();
      }
    });
  });
}

function renderProducts() {
  const { productsList } = selectors;
  productsList.innerHTML = '';
  state.products.forEach((product) => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div>
        <strong>${product.name}</strong>
        <p>SKU ${product.sku || '—'} · Barcode ${product.barcode || '—'}</p>
        <small>Cost ${formatCurrency(product.costPrice ?? product.cost || 0)} · Sales ${formatCurrency(product.salesPrice ?? product.rrp || 0)}</small>
      </div>
      <div class="product-actions">
        <button class="ghost" data-action="add" data-id="${product.id}">Add</button>
        <button class="ghost" data-action="edit" data-id="${product.id}">Edit</button>
        <button class="ghost" data-action="delete" data-id="${product.id}">✕</button>
      </div>
    `;
    productsList.appendChild(div);
  });
  productsList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const { action, id } = button.dataset;
      if (action === 'add') {
        const product = state.products.find((p) => p.id === id);
        if (product) {
          addItemRow({
            productId: product.id,
            productName: product.name,
            barcode: product.barcode,
            sku: product.sku,
            qty: 1,
            rrp: product.rrp,
            sellingPrice: product.salesPrice ?? product.rrp,
            discount: 0
          });
        }
        return;
      }
      if (action === 'edit') {
        const product = state.products.find((p) => p.id === id);
        if (product) {
          selectors.productForm.productId.value = product.id;
          selectors.productForm.name.value = product.name || '';
          selectors.productForm.sku.value = product.sku || '';
          selectors.productForm.barcode.value = product.barcode || '';
          selectors.productForm.rrp.value = product.rrp || '';
          selectors.productForm.costPrice.value = product.costPrice ?? product.cost ?? '';
          selectors.productForm.salesPrice.value = product.salesPrice ?? product.rrp ?? '';
        }
        return;
      }
      if (action === 'delete') {
        await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
        await loadProducts();
      }
    });
  });
}

function formatCurrency(value) {
  const currency = (state.settings.currency || 'gbp').toUpperCase();
  const amount = Number(value || 0).toFixed(2);
  if (currency === 'GBP') return `£${amount}`;
  return `${currency} ${amount}`;
}

function renderInvoices() {
  const { invoicesList } = selectors;
  invoicesList.innerHTML = '';
  state.invoices.forEach((invoice) => {
    const customer = state.customers.find((c) => c.id === invoice.customerId);
    const div = document.createElement('div');
    div.className = 'invoice-card';
    div.innerHTML = `
      <header>
        <div>
          <strong>${invoice.invoiceNumber}</strong>
          <p>${customer ? customer.name : 'Unknown customer'}</p>
        </div>
        <div class="invoice-card-figures">
          <span>${formatCurrency(invoice.total)}</span>
          <small>Balance ${formatCurrency(invoice.balanceDue)}</small>
        </div>
        <span class="badge ${invoice.status}">${invoice.status}</span>
      </header>
      <ul class="invoice-meta">
        <li>Due ${invoice.dueDate || '—'}</li>
        <li>${invoice.paymentTerms || state.settings.defaultPaymentTerms || ''}</li>
        <li>${invoice.items.length} item${invoice.items.length === 1 ? '' : 's'}</li>
      </ul>
      <footer>
        <button class="ghost" data-action="edit" data-id="${invoice.id}">Edit</button>
        <button class="ghost" data-action="email" data-id="${invoice.id}">Email</button>
        <button class="ghost" data-action="stripe" data-id="${invoice.id}">${invoice.stripeCheckoutUrl ? 'Open checkout' : 'Create checkout'}</button>
        <button class="ghost" data-action="payment" data-id="${invoice.id}">Record payment</button>
        <button class="ghost" data-action="delete" data-id="${invoice.id}">Delete</button>
      </footer>
    `;
    invoicesList.appendChild(div);
  });
  invoicesList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const { action, id } = button.dataset;
      const invoice = state.invoices.find((inv) => inv.id === id);
      try {
        if (action === 'edit' && invoice) {
          selectors.invoiceForm.invoiceId.value = invoice.id;
          selectors.invoiceForm.customerId.value = invoice.customerId;
          ensureSelectValue(
            selectors.invoiceForm.paymentTerms,
            invoice.paymentTerms || state.settings.defaultPaymentTerms || 'On receipt'
          );
          selectors.invoiceForm.dueDate.value = invoice.dueDate || '';
          selectors.invoiceForm.notes.value = invoice.notes || '';
          selectors.invoiceItems.innerHTML = '';
          invoice.items.forEach((item) => addItemRow({
            productId: item.productId,
            productName: item.productName,
            barcode: item.barcode,
            sku: item.sku,
            qty: item.qty,
            rrp: item.rrp,
            discount: item.discount,
            sellingPrice: item.sellingPrice ?? item.cost
          }));
          updateInvoiceTotals();
          setActiveSection('invoices');
        }
        if (action === 'email') {
          await apiFetch(`/api/invoices/${id}/send-email`, { method: 'POST' });
          alert('Invoice emailed successfully.');
        }
        if (action === 'stripe') {
          if (invoice?.stripeCheckoutUrl) {
            window.open(invoice.stripeCheckoutUrl, '_blank');
            return;
          }
          const url = new URL(window.location.href);
          const payload = {
            invoiceId: id,
            successUrl: `${url.origin}?checkout=success`,
            cancelUrl: `${url.origin}?checkout=cancel`
          };
          const session = await apiFetch('/api/payments/stripe/session', { method: 'POST', body: payload });
          window.open(session.url, '_blank');
        }
        if (action === 'payment') {
          selectors.paymentForm.invoiceId.value = id;
          setActiveSection('payments');
        }
        if (action === 'delete') {
          await apiFetch(`/api/invoices/${id}`, { method: 'DELETE' });
          await Promise.all([loadInvoices(), loadPayments(), loadDashboard()]);
        }
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderPayments() {
  const { paymentsList } = selectors;
  paymentsList.innerHTML = '';
  state.payments.forEach((payment) => {
    const invoice = state.invoices.find((inv) => inv.id === payment.invoiceId);
    const dateLabel = payment.date ? new Date(payment.date).toLocaleDateString() : '—';
    const div = document.createElement('div');
    div.className = 'payments-list-item';
    div.innerHTML = `
      <div>
        <strong>${invoice ? invoice.invoiceNumber : payment.invoiceId}</strong>
        <p>${payment.method || 'Manual'} · ${dateLabel}</p>
      </div>
      <div class="product-actions">
        <span>${formatCurrency(payment.amount)}</span>
        <button class="ghost" data-action="edit" data-id="${payment.id}">Edit</button>
        <button class="ghost" data-action="delete" data-id="${payment.id}">Delete</button>
      </div>
    `;
    paymentsList.appendChild(div);
  });
  paymentsList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const { action, id } = button.dataset;
      if (action === 'edit') {
        const payment = state.payments.find((p) => p.id === id);
        if (payment) {
          selectors.paymentForm.paymentId.value = payment.id;
          selectors.paymentForm.invoiceId.value = payment.invoiceId;
          selectors.paymentForm.amount.value = payment.amount;
          ensureSelectValue(selectors.paymentForm.method, payment.method || 'BACs');
          selectors.paymentForm.date.value = payment.date ? payment.date.split('T')[0] : '';
          selectors.paymentForm.notes.value = payment.notes || '';
        }
      }
      if (action === 'delete') {
        await apiFetch(`/api/payments/${id}`, { method: 'DELETE' });
        await Promise.all([loadPayments(), loadInvoices(), loadDashboard()]);
      }
    });
  });
}

function renderDashboard() {
  const { paymentsChart, topProducts } = selectors;
  paymentsChart.innerHTML = '';
  const max = Math.max(...state.dashboard.monthlyPayments.map((m) => m.total), 1);
  state.dashboard.monthlyPayments.forEach((point) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${(point.total / max) * 100 || 5}%`;
    bar.innerHTML = `<span>${point.month}</span>`;
    paymentsChart.appendChild(bar);
  });
  topProducts.innerHTML = '';
  state.dashboard.topProducts.forEach((product) => {
    const pill = document.createElement('div');
    pill.className = 'product-pill';
    pill.innerHTML = `<span>${product.name}</span><strong>${product.qty}</strong>`;
    topProducts.appendChild(pill);
  });
  updateSnapshotCounts();
}

function updateSnapshotCounts() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const paymentsTotal = state.payments.reduce((sum, payment) => {
    if (!payment.date) return sum;
    const paymentDate = new Date(payment.date);
    if (Number.isNaN(paymentDate.getTime())) return sum;
    const paymentKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
    if (paymentKey === monthKey) {
      return sum + Number(payment.amount || 0);
    }
    return sum;
  }, 0);
  selectors.snapshotInvoices.textContent = state.invoices.length;
  selectors.snapshotCustomers.textContent = state.customers.length;
  selectors.snapshotPayments.textContent = formatCurrency(paymentsTotal);
}

function populateProductOptions(selectElement, selectedId = '') {
  if (!selectElement) return;
  const currentValue = selectedId || selectElement.value;
  selectElement.innerHTML = '<option value="">Select product</option>';
  state.products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = product.name || product.sku || 'Product';
    selectElement.appendChild(option);
  });
  if (currentValue) {
    selectElement.value = currentValue;
  }
}

function refreshInvoiceProductSelects() {
  selectors.invoiceItems.querySelectorAll('select[name="productId"]').forEach((selectElement) => {
    populateProductOptions(selectElement);
  });
}

function addItemRow(preset = {}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <select name="productId" class="product-select"></select>
    <input name="productName" placeholder="Name" value="${preset.productName || ''}" />
    <input name="barcode" placeholder="Barcode" value="${preset.barcode || ''}" />
    <input name="sku" placeholder="SKU" value="${preset.sku || ''}" />
    <input name="qty" type="number" min="1" value="${preset.qty || 1}" />
    <input name="rrp" type="number" step="0.01" value="${preset.rrp || 0}" />
    <input name="discount" type="number" step="0.01" value="${preset.discount || 0}" />
    <input name="sellingPrice" type="number" step="0.01" value="${preset.sellingPrice ?? preset.cost ?? 0}" />
    <input name="lineTotal" type="text" disabled value="0.00" />
    <button type="button" class="remove-btn">×</button>
  `;
  const productSelect = row.querySelector('select[name="productId"]');
  populateProductOptions(productSelect, preset.productId);
  productSelect.addEventListener('change', () => {
    const product = state.products.find((p) => p.id === productSelect.value);
    if (product) {
      row.querySelector('input[name="productName"]').value = product.name || '';
      row.querySelector('input[name="barcode"]').value = product.barcode || '';
      row.querySelector('input[name="sku"]').value = product.sku || '';
      row.querySelector('input[name="rrp"]').value = product.rrp || 0;
      row.querySelector('input[name="sellingPrice"]').value = product.salesPrice ?? product.rrp ?? 0;
    }
    updateInvoiceTotals();
  });
  row.querySelector('.remove-btn').addEventListener('click', () => {
    row.remove();
    updateInvoiceTotals();
  });
  ['qty', 'discount', 'sellingPrice'].forEach((field) => {
    const input = row.querySelector(`input[name="${field}"]`);
    input.addEventListener('input', updateInvoiceTotals);
  });
  selectors.invoiceItems.appendChild(row);
  updateInvoiceTotals();
}

function collectInvoiceItems() {
  const items = [];
  selectors.invoiceItems.querySelectorAll('.item-row').forEach((row) => {
    const item = {
      productId: row.querySelector('select[name="productId"]').value || null,
      productName: row.querySelector('input[name="productName"]').value,
      barcode: row.querySelector('input[name="barcode"]').value,
      sku: row.querySelector('input[name="sku"]').value,
      qty: Number(row.querySelector('input[name="qty"]').value || 0),
      rrp: Number(row.querySelector('input[name="rrp"]').value || 0),
      discount: Number(row.querySelector('input[name="discount"]').value || 0),
      sellingPrice: Number(row.querySelector('input[name="sellingPrice"]').value || 0)
    };
    if (item.productName || item.productId) {
      items.push(item);
    }
  });
  return items;
}

function updateInvoiceTotals() {
  const items = collectInvoiceItems();
  let subtotal = 0;
  items.forEach((item, index) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.sellingPrice || 0);
    const discount = Number(item.discount || 0) / 100;
    const total = qty * price * (1 - discount);
    subtotal += total;
    const row = selectors.invoiceItems.querySelectorAll('.item-row')[index];
    const totalField = row.querySelector('input[name="lineTotal"]');
    if (totalField) {
      totalField.value = total.toFixed(2);
    }
  });
  selectors.invoiceTotals.innerHTML = `<div>Subtotal: ${formatCurrency(subtotal)}</div>`;
  return { subtotal };
}

async function loadSettings() {
  state.settings = await apiFetch('/api/settings');
  hydrateSettingsForm();
}

async function loadCustomers() {
  state.customers = await apiFetch('/api/customers');
  renderCustomers();
  populateInvoiceSelects();
  updateSnapshotCounts();
}

async function loadProducts() {
  state.products = await apiFetch('/api/products');
  renderProducts();
  refreshInvoiceProductSelects();
}

async function loadInvoices() {
  state.invoices = await apiFetch('/api/invoices');
  renderInvoices();
  populateInvoiceSelects();
  updateSnapshotCounts();
}

async function loadDashboard() {
  state.dashboard = await apiFetch('/api/dashboard');
  renderDashboard();
}

async function loadPayments() {
  state.payments = await apiFetch('/api/payments');
  renderPayments();
  updateSnapshotCounts();
}

selectors.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.currency = (payload.currency || 'GBP').toLowerCase();
  await apiFetch('/api/settings', { method: 'PUT', body: payload });
  await loadSettings();
});

selectors.customerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  const customerId = payload.customerId;
  delete payload.customerId;
  if (customerId) {
    await apiFetch(`/api/customers/${customerId}`, { method: 'PUT', body: payload });
  } else {
    await apiFetch('/api/customers', { method: 'POST', body: payload });
  }
  resetCustomerForm();
  await loadCustomers();
});

selectors.productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.rrp = Number(payload.rrp || 0);
  payload.costPrice = Number(payload.costPrice || 0);
  payload.salesPrice = Number(payload.salesPrice || payload.rrp || 0);
  const productId = payload.productId;
  delete payload.productId;
  if (productId) {
    await apiFetch(`/api/products/${productId}`, { method: 'PUT', body: payload });
  } else {
    await apiFetch('/api/products', { method: 'POST', body: payload });
  }
  resetProductForm();
  await loadProducts();
});

selectors.invoiceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const items = collectInvoiceItems();
  if (!items.length) {
    alert('Add at least one line item.');
    return;
  }
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.items = items;
  payload.currency = state.settings.currency || 'gbp';
  payload.logoUrl = state.settings.logoUrl;
  const invoiceId = payload.invoiceId;
  delete payload.invoiceId;
  try {
    if (invoiceId) {
      await apiFetch(`/api/invoices/${invoiceId}`, { method: 'PUT', body: payload });
    } else {
      await apiFetch('/api/invoices', { method: 'POST', body: payload });
    }
    resetInvoiceForm();
    await Promise.all([loadInvoices(), loadDashboard(), loadPayments()]);
  } catch (error) {
    alert(error.message);
  }
});

selectors.paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  const paymentId = payload.paymentId;
  const invoiceId = payload.invoiceId;
  payload.amount = Number(payload.amount || 0);
  if (!invoiceId) {
    alert('Choose an invoice');
    return;
  }
  try {
    if (paymentId) {
      await apiFetch(`/api/payments/${paymentId}`, { method: 'PUT', body: payload });
    } else {
      await apiFetch(`/api/invoices/${invoiceId}/payments`, { method: 'POST', body: payload });
    }
    resetPaymentForm();
    await Promise.all([loadPayments(), loadInvoices(), loadDashboard()]);
  } catch (error) {
    alert(error.message);
  }
});

selectors.refreshButton.addEventListener('click', async () => {
  await bootstrap();
});

selectors.addRowButton.addEventListener('click', (event) => {
  event.preventDefault();
  addItemRow();
});

selectors.cancelCustomerEdit.addEventListener('click', (event) => {
  event.preventDefault();
  resetCustomerForm();
});

selectors.cancelProductEdit.addEventListener('click', (event) => {
  event.preventDefault();
  resetProductForm();
});

selectors.cancelInvoiceEdit.addEventListener('click', (event) => {
  event.preventDefault();
  resetInvoiceForm();
});

selectors.cancelPaymentEdit.addEventListener('click', (event) => {
  event.preventDefault();
  resetPaymentForm();
});

selectors.navItems.forEach((item) => {
  item.addEventListener('click', () => {
    setActiveSection(item.dataset.section);
  });
});

async function bootstrap() {
  try {
    await Promise.all([loadSettings(), loadCustomers(), loadProducts(), loadInvoices(), loadPayments(), loadDashboard()]);
    if (!selectors.invoiceItems.children.length) addItemRow();
    setActiveSection('dashboard');
  } catch (error) {
    selectors.apiStatus.textContent = 'API unreachable';
    console.error(error);
  }
}

bootstrap();
