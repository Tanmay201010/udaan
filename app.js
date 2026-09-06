// =============================================
// UdaanPro - Accounting Web App
// =============================================

// --- State ---
let currentRole = localStorage.getItem('udaanRole') || null;
let settings = JSON.parse(localStorage.getItem('udaanSettings') || '{}');
let appData = { inventory: [], pos: [], journal: [], nextInvoice: 1 };
let currentSha = null;
let journalListenersAttached = false;

// --- Utility ---
function fmt(n) {
    return '₹ ' + (parseFloat(n) || 0).toFixed(2);
}

function today() {
    return new Date().toISOString().split('T')[0];
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ensureIds() {
    if (appData.journal) appData.journal.forEach(e => { if (!e.id) e.id = uid(); });
    if (appData.pos) appData.pos.forEach(b => { if (!b.id) b.id = uid(); });
    if (appData.inventory) appData.inventory.forEach(i => { if (!i.id) i.id = uid(); });
}

function saveLocal() {
    ensureIds();
    localStorage.setItem('udaanData', JSON.stringify(appData));
}

function loadLocal() {
    const d = localStorage.getItem('udaanData');
    if (d) {
        try { appData = JSON.parse(d); } catch(e) {}
    }
    if (!appData.inventory) appData.inventory = [];
    if (!appData.pos) appData.pos = [];
    if (!appData.journal) appData.journal = [];
    if (!appData.nextInvoice) appData.nextInvoice = 1;
    ensureIds();
}

// =============================================
// INIT APP
// =============================================
function initApp() {
    loadLocal();
    lucide.createIcons();

    if (!currentRole) {
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.style.display = 'flex';
        const appEl = document.getElementById('app');
        if (appEl) appEl.style.display = 'none';
    } else {
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.style.display = 'none';
        startApp();
    }

    // Login button
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('login-user').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('login-pass').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') handleLogin();
    });
}

function handleLogin() {
    const user = document.getElementById('login-user').value.trim().toLowerCase();
    const pass = document.getElementById('login-pass').value.trim().toLowerCase();
    const errEl = document.getElementById('login-error');

    // Credentials: username=admin, password=sales or finance
    if (user === 'admin' && (pass === 'sales' || pass === 'finance')) {
        currentRole = pass; // 'sales' or 'finance'
        localStorage.setItem('udaanRole', currentRole);
        document.getElementById('login-overlay').style.display = 'none';
        errEl.style.display = 'none';
        startApp();
    } else {
        errEl.style.display = 'block';
    }
}

function startApp() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';

    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'flex';
    document.getElementById('logged-in-role').textContent = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);

    // Show/hide nav links based on role
    document.querySelectorAll('#app li[data-role]').forEach(li => {
        const role = li.getAttribute('data-role');
        if (role === 'all') {
            li.style.display = '';
        } else if (role === currentRole) {
            li.style.display = '';
        } else {
            li.style.display = 'none';
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', e => {
        e.preventDefault();
        localStorage.removeItem('udaanRole');
        currentRole = null;
        location.reload();
    });

    // Mobile menu
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebar = document.querySelector('.sidebar');
    if (mobileMenuBtn) {
        mobileMenuBtn.style.display = '';
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('active');
        });
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }

    // Navigation
    document.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const target = link.getAttribute('data-target');
            navigateTo(target);
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    });

    // Force sync button
    document.getElementById('force-sync-btn').addEventListener('click', () => {
        syncData();
    });

    // Load from GitHub if configured
    if (settings.pat && settings.owner && settings.repo) {
        fetchFromGitHub();
    } else {
        updateSyncStatus('Not configured', 'warning');
    }

    // Route to default
    const hash = location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        const h = location.hash.replace('#', '') || 'dashboard';
        navigateTo(h, false);
    });
}

// =============================================
// NAVIGATION / ROUTING
// =============================================
function navigateTo(target, pushState = true) {
    const container = document.getElementById('view-container');
    const tpl = document.getElementById('tpl-' + target);
    if (!tpl) return;

    container.innerHTML = '';
    const clone = tpl.content.cloneNode(true);
    container.appendChild(clone);
    lucide.createIcons();

    document.getElementById('page-title').textContent = pageTitles[target] || target;

    document.querySelectorAll('.nav-item').forEach(l => {
        l.classList.toggle('active', l.getAttribute('data-target') === target);
    });

    if (pushState) {
        history.pushState({ target }, '', '#' + target);
    }

    // Initialize the view
    switch (target) {
        case 'dashboard':       initDashboard(); break;
        case 'inventory':       initInventory(); break;
        case 'pos':             initPOS(); break;
        case 'bill-history':    initBillHistory(); break;
        case 'journal':         initJournal(); break;
        case 'ledger':          initLedger(); break;
        case 'trial-balance':   initTrialBalance(); break;
        case 'cash-book':       initCashBook(); break;
        case 'financial-statements': initFinancialStatements(); break;
        case 'settings':        initSettingsView(); break;
    }
}

const pageTitles = {
    'dashboard': 'Dashboard',
    'inventory': 'Inventory',
    'pos': 'Billing / POS',
    'bill-history': 'Bill History',
    'journal': 'Journal',
    'ledger': 'Ledger',
    'trial-balance': 'Trial Balance',
    'cash-book': 'Cash Book',
    'financial-statements': 'Financial Statements',
    'settings': 'Settings'
};

// =============================================
// DASHBOARD
// =============================================
function initDashboard() {
    const expenseKeywords = ['rent', 'salary', 'salaries', 'wages', 'expense', 'utilities', 'electricity', 'purchase', 'purchases', 'cost', 'loss', 'depreciation', 'freight', 'carriage', 'advertising', 'stationery', 'telephone', 'water', 'tax', 'discount allowed'];

    // Cash balance from journal (Cash and Bank accounts)
    let cashBalance = 0;
    appData.journal.forEach(e => {
        const d = (e.debitAcc || '').toLowerCase();
        const c = (e.creditAcc || '').toLowerCase();
        if (d.includes('cash') || d.includes('bank')) cashBalance += parseFloat(e.debitAmt) || 0;
        if (c.includes('cash') || c.includes('bank')) cashBalance -= parseFloat(e.creditAmt) || 0;
    });

    const cashEl = document.getElementById('dash-cash-balance');
    if (cashEl) cashEl.textContent = fmt(cashBalance);

    const billsEl = document.getElementById('dash-bills-count');
    if (billsEl) billsEl.textContent = appData.pos ? appData.pos.length : 0;

    // Total expenses (debit entries for expense accounts)
    let expenses = 0;
    appData.journal.forEach(e => {
        const d = (e.debitAcc || '').toLowerCase();
        const c = (e.creditAcc || '').toLowerCase();
        if (expenseKeywords.some(k => d.includes(k))) {
            expenses += parseFloat(e.debitAmt) || 0;
        }
        if (expenseKeywords.some(k => c.includes(k))) {
            expenses -= parseFloat(e.creditAmt) || 0;
        }
    });
    const expEl = document.getElementById('dash-expenses');
    if (expEl) expEl.textContent = fmt(Math.max(0, expenses));

    const jEl = document.getElementById('dash-journal-count');
    if (jEl) jEl.textContent = appData.journal ? appData.journal.length : 0;

    // Recent transactions table
    const tbody = document.querySelector('#dash-recent-table tbody');
    if (tbody) {
        const recent = [...appData.journal].reverse().slice(0, 10);
        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);">No transactions yet.</td></tr>';
        } else {
            tbody.innerHTML = recent.map(e => `
                <tr>
                    <td>${e.date || ''}</td>
                    <td>${e.desc || ''}</td>
                    <td>${e.debitAcc || ''} / ${e.creditAcc || ''}</td>
                    <td>${fmt(e.debitAmt || e.creditAmt)}</td>
                </tr>
            `).join('');
        }
    }
}

// =============================================
// INVENTORY
// =============================================
function initInventory() {
    renderInventoryTable();

    document.getElementById('new-item-btn').addEventListener('click', () => {
        document.getElementById('inventory-modal').style.display = 'block';
        document.getElementById('inv-modal-title').textContent = 'Add New Product';
        document.getElementById('inv-edit-id').value = '';
        document.getElementById('inv-name').value = '';
        document.getElementById('inv-consignor').value = '';
        document.getElementById('inv-qty').value = '1';
        document.getElementById('inv-price').value = '';
    });

    document.getElementById('inv-cancel-btn').addEventListener('click', () => {
        document.getElementById('inventory-modal').style.display = 'none';
    });

    document.getElementById('inv-save-btn').addEventListener('click', () => {
        const editId = document.getElementById('inv-edit-id').value;
        const name = document.getElementById('inv-name').value.trim();
        const consignor = document.getElementById('inv-consignor').value.trim();
        const qty = parseInt(document.getElementById('inv-qty').value) || 0;
        const price = parseFloat(document.getElementById('inv-price').value) || 0;

        if (!name || qty <= 0 || price <= 0) {
            alert('Please fill all required fields.');
            return;
        }

        if (editId) {
            const idx = appData.inventory.findIndex(i => String(i.id) === String(editId));
            if (idx >= 0) {
                appData.inventory[idx] = { id: editId, name, consignor, qty, price };
            }
        } else {
            appData.inventory.push({ id: uid(), name, consignor, qty, price });
        }

        saveLocal();
        syncData();
        document.getElementById('inventory-modal').style.display = 'none';
        renderInventoryTable();
    });
}

function renderInventoryTable() {
    const tbody = document.querySelector('#inventory-table tbody');
    if (!tbody) return;
    if (appData.inventory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">No products yet. Add a product to get started.</td></tr>';
        return;
    }
    tbody.innerHTML = appData.inventory.map(item => `
        <tr>
            <td>${item.name}</td>
            <td>${item.consignor || '—'}</td>
            <td>${item.qty}</td>
            <td>${fmt(item.price)}</td>
            <td style="display:flex;gap:0.5rem;">
                <button class="btn btn-sm btn-secondary inv-edit-btn" data-id="${item.id}">Edit</button>
                <button class="btn btn-sm btn-secondary inv-del-btn" data-id="${item.id}" style="color:var(--danger);">Delete</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.inv-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const item = appData.inventory.find(i => String(i.id) === String(id));
            if (!item) return;
            document.getElementById('inventory-modal').style.display = 'block';
            document.getElementById('inv-modal-title').textContent = 'Edit Product';
            document.getElementById('inv-edit-id').value = item.id;
            document.getElementById('inv-name').value = item.name || '';
            document.getElementById('inv-consignor').value = item.consignor || '';
            document.getElementById('inv-qty').value = item.qty || 1;
            document.getElementById('inv-price').value = item.price || '';
        });
    });

    tbody.querySelectorAll('.inv-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            if (!confirm('Are you sure you want to delete this product?')) return;
            appData.inventory = appData.inventory.filter(i => String(i.id) !== String(id));
            saveLocal();
            syncData();
            renderInventoryTable();
        });
    });
}

// =============================================
// POS / BILLING
// =============================================
function initPOS() {
    let posItems = [];

    // Set Invoice No and Date
    const invoiceNo = '#' + String(appData.nextInvoice).padStart(6, '0');
    document.getElementById('pos-no').value = invoiceNo;
    document.getElementById('pos-date').value = today();

    // Populate product select with optional live search
    populatePosProductSelect();

    function populatePosProductSelect(filterQuery = '') {
        const sel = document.getElementById('pos-product-select');
        if (!sel) return;
        const q = filterQuery.trim().toLowerCase();
        sel.innerHTML = '<option value="">Select an item...</option>';
        
        const matched = appData.inventory.filter(item => {
            if (item.qty <= 0) return false;
            if (!q) return true;
            return (item.name || '').toLowerCase().includes(q) || (item.consignor || '').toLowerCase().includes(q);
        });

        matched.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name} (${item.consignor ? item.consignor + ' - ' : ''}Stock: ${item.qty}) — Price: ${fmt(item.price)}`;
            sel.appendChild(opt);
        });

        // If filtered down to 1 match, auto-select it and pre-fill price
        if (q && matched.length === 1) {
            sel.value = matched[0].id;
            const priceInput = document.getElementById('pos-sale-price');
            if (priceInput && (!priceInput.value || priceInput.value == 0)) {
                priceInput.value = matched[0].price || '';
            }
        }
    }

    // Live search input handler
    const prodSearch = document.getElementById('pos-product-search');
    if (prodSearch) {
        prodSearch.addEventListener('input', (e) => {
            populatePosProductSelect(e.target.value);
        });
    }

    // Auto-fill price when an item is selected from dropdown
    const prodSelect = document.getElementById('pos-product-select');
    if (prodSelect) {
        prodSelect.addEventListener('change', () => {
            const selectedId = prodSelect.value;
            const inv = appData.inventory.find(i => String(i.id) === String(selectedId));
            const priceInput = document.getElementById('pos-sale-price');
            if (inv && priceInput) {
                priceInput.value = inv.price || '';
            }
        });
    }

    function renderPosItems() {
        const container = document.getElementById('pos-items-container');
        if (!container) return;
        if (posItems.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">No items added yet.</p>';
            return;
        }
        let total = 0;
        posItems.forEach(i => total += i.salePrice * i.qty);
        container.innerHTML = `
            <table class="data-table" style="margin-bottom:0.5rem;">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th style="text-align:right;">Qty</th>
                        <th style="text-align:right;">Sale Price</th>
                        <th style="text-align:right;">Subtotal</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${posItems.map((item, idx) => `
                        <tr>
                            <td>${item.name}</td>
                            <td style="text-align:right;">${item.qty}</td>
                            <td style="text-align:right;">${fmt(item.salePrice)}</td>
                            <td style="text-align:right;">${fmt(item.salePrice * item.qty)}</td>
                            <td><button class="btn btn-sm btn-secondary pos-rm-btn" data-idx="${idx}">✕</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="text-align:right;font-weight:bold;margin-top:0.5rem;">Total: ${fmt(total)}</p>
        `;
        container.querySelectorAll('.pos-rm-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                posItems.splice(parseInt(btn.getAttribute('data-idx')), 1);
                renderPosItems();
            });
        });
    }

    document.getElementById('pos-add-item-btn').addEventListener('click', () => {
        const sel = document.getElementById('pos-product-select');
        const itemId = sel.value;
        const salePrice = parseFloat(document.getElementById('pos-sale-price').value);
        if (!itemId) { alert('Please select a product.'); return; }
        if (!salePrice || salePrice <= 0) { alert('Please enter a valid sale price.'); return; }
        const inv = appData.inventory.find(i => String(i.id) === String(itemId));
        if (!inv) return;
        const existing = posItems.find(i => String(i.id) === String(itemId));
        if (existing) {
            existing.qty += 1;
        } else {
            posItems.push({ id: itemId, name: inv.name, consignor: inv.consignor, costPrice: inv.price, salePrice: salePrice, qty: 1 });
        }
        // Reset item add inputs
        document.getElementById('pos-sale-price').value = '';
        if (prodSearch) prodSearch.value = '';
        populatePosProductSelect();
        renderPosItems();
    });

    function saveBill(withPrint) {
        const customer = document.getElementById('pos-customer').value.trim() || 'Walk-in Customer';
        const note = document.getElementById('pos-note').value;
        if (posItems.length === 0) { alert('Add at least one item.'); return; }
        const total = posItems.reduce((s, i) => s + i.salePrice * i.qty, 0);
        const bill = {
            id: uid(),
            invoiceNo: document.getElementById('pos-no').value,
            date: document.getElementById('pos-date').value,
            customer,
            items: posItems.map(i => ({...i})),
            total,
            note
        };
        appData.pos.push(bill);
        appData.nextInvoice = (appData.nextInvoice || 1) + 1;
        // Deduct from inventory
        posItems.forEach(pi => {
            const inv = appData.inventory.find(i => i.id === pi.id);
            if (inv) inv.qty -= pi.qty;
        });
        // Auto journal entry for cash/UPI sale
        const jEntry = {
            id: uid(),
            date: bill.date,
            desc: `Sale - Invoice ${bill.invoiceNo} to ${customer}`,
            debitAcc: 'Cash',
            debitAmt: total,
            creditAcc: 'Sales',
            creditAmt: total
        };
        appData.journal.push(jEntry);
        saveLocal();
        syncData();
        if (withPrint) generateAndPrintBill(bill);
        // Reset
        posItems = [];
        document.getElementById('pos-customer').value = '';
        document.getElementById('pos-no').value = '#' + String(appData.nextInvoice).padStart(6, '0');
        renderPosItems();
        populatePosProductSelect();
    }

    document.getElementById('generate-bill-btn').addEventListener('click', () => saveBill(true));
    document.getElementById('save-history-btn').addEventListener('click', () => saveBill(false));
}

function generateAndPrintBill(bill) {
    const itemsHTML = bill.items.map((item, idx) => `
        <tr>
            <td style="padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0;">${idx + 1}</td>
            <td style="padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0;">${item.name}</td>
            <td style="padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; text-align: right;">${item.qty}</td>
            <td style="padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; text-align: right;">₹ ${parseFloat(item.salePrice).toFixed(2)}</td>
            <td style="padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; text-align: right;">₹ ${(item.salePrice * item.qty).toFixed(2)}</td>
        </tr>
    `).join('');

    const dateStr = bill.date ? new Date(bill.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    const printHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${bill.invoiceNo}</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #1e293b; background: white; }
    .bill-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #e2e8f0; }
    .logo-section h2 { font-size: 1.5rem; font-weight: 700; color: #0f172a; }
    .logo-section p { color: #64748b; font-size: 0.85rem; margin-top: 0.25rem; }
    .meta-section { text-align: right; }
    .meta-section p { font-size: 0.9rem; color: #475569; }
    .title-area { display: flex; justify-content: space-between; align-items: center; margin: 2rem 0; }
    .invoice-label { font-size: 2rem; font-weight: 300; letter-spacing: 0.5em; color: #64748b; }
    .to-from { font-size: 0.9rem; }
    .to-from strong { display: block; color: #0f172a; font-size: 1rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    thead tr { background: #f1f5f9; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; }
    thead th { padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; letter-spacing: 0.05em; color: #475569; text-transform: uppercase; }
    thead th:last-child, thead th:nth-child(3), thead th:nth-child(4) { text-align: right; }
    .footer { display: flex; justify-content: space-between; align-items: flex-end; border-top: 2px solid #e2e8f0; padding-top: 1rem; margin-top: 1rem; }
    .grand-total { font-size: 1.1rem; font-weight: bold; }
    .amount { font-size: 1.3rem; color: #0f172a; }
    @media print { body { padding: 20px; } }
</style>
</head>
<body>
    <div class="bill-header">
        <div class="logo-section">
            <h2>UdaanPro</h2>
            <p>Delhi Public School Nacharam</p>
        </div>
        <div class="meta-section">
            <p><strong>Date Issued:</strong></p>
            <p>${dateStr}</p>
        </div>
    </div>

    <div class="title-area">
        <div class="to-from">
            <p style="color:#64748b;font-size:0.8rem;">INVOICE NO</p>
            <strong>${bill.invoiceNo}</strong>
        </div>
        <div class="invoice-label">IN VO IC E</div>
        <div class="to-from" style="text-align:right;">
            <p style="color:#64748b;font-size:0.8rem;">ISSUED TO</p>
            <strong>${bill.customer}</strong>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>NO</th>
                <th>DESCRIPTION</th>
                <th style="text-align:right;">QTY</th>
                <th style="text-align:right;">PRICE</th>
                <th style="text-align:right;">SUBTOTAL</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHTML}
        </tbody>
    </table>

    <div class="footer">
        <div>
            <p style="color:#64748b;font-size:0.8rem;">PAYMENT METHOD</p>
            <p style="font-weight:600;">${bill.note || 'Cash'}</p>
        </div>
        <div style="text-align:right;">
            <p class="grand-total">GRAND TOTAL &nbsp; <span class="amount">₹ ${parseFloat(bill.total).toFixed(2)}</span></p>
        </div>
    </div>
</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(printHTML);
        printWindow.document.close();
        printWindow.onload = () => {
            printWindow.print();
        };
    }
}

// =============================================
// BILL HISTORY
// =============================================
function initBillHistory() {
    let filtered = [...appData.pos].reverse(); // newest first

    function render(list) {
        const tbody = document.querySelector('#bill-history-table tbody');
        const emptyMsg = document.getElementById('bill-history-empty');
        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = '';
            if (emptyMsg) emptyMsg.style.display = 'block';
            return;
        }
        if (emptyMsg) emptyMsg.style.display = 'none';

        tbody.innerHTML = list.map(bill => {
            const itemSummary = (bill.items || [])
                .map(i => `${i.name} ×${i.qty}`)
                .join(', ');
            return `
                <tr>
                    <td><strong>${bill.invoiceNo || '—'}</strong></td>
                    <td>${bill.date || '—'}</td>
                    <td>${bill.customer || 'Walk-in'}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${itemSummary}">${itemSummary || '—'}</td>
                    <td>${bill.note || 'Cash'}</td>
                    <td style="text-align:right;font-weight:600;">${fmt(bill.total)}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary reprint-btn" data-id="${bill.id}">
                            <i data-lucide="printer"></i> Reprint
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        lucide.createIcons();

        tbody.querySelectorAll('.reprint-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const bill = appData.pos.find(b => b.id === id);
                if (bill) generateAndPrintBill(bill);
            });
        });
    }

    // Initial render
    render(filtered);

    // Search
    const searchInput = document.getElementById('bill-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            if (!q) {
                render(filtered);
                return;
            }
            render(filtered.filter(b =>
                (b.customer || '').toLowerCase().includes(q) ||
                (b.invoiceNo || '').toLowerCase().includes(q) ||
                (b.date || '').includes(q)
            ));
        });
    }

    // Export CSV
    const exportBtn = document.getElementById('export-bills-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (appData.pos.length === 0) { alert('No bills to export.'); return; }
            const header = 'Invoice No,Date,Customer,Items,Payment,Total\n';
            const rows = [...appData.pos].reverse().map(b => {
                const items = (b.items || []).map(i => `${i.name}x${i.qty}`).join(' | ');
                return [b.invoiceNo, b.date, b.customer, `"${items}"`, b.note, b.total].join(',');
            }).join('\n');
            const blob = new Blob([header + rows], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'bill_history.csv';
            a.click();
        });
    }
}

// =============================================
// JOURNAL
// =============================================
function initJournal() {
    renderJournalTable();

    if (!journalListenersAttached) {
        journalListenersAttached = true;

        document.addEventListener('click', e => {
            // New entry button
            if (e.target.closest('#new-journal-btn')) {
                const modal = document.getElementById('journal-modal');
                if (!modal) return;
                modal.style.display = 'block';
                document.getElementById('journal-modal-title').textContent = 'New Journal Entry';
                document.getElementById('j-edit-id').value = '';
                document.getElementById('j-date').value = today();
                document.getElementById('j-desc').value = '';
                document.getElementById('j-debit-acc').value = '';
                document.getElementById('j-debit-amt').value = '';
                document.getElementById('j-credit-acc').value = '';
                document.getElementById('j-credit-amt').value = '';
            }

            // Cancel
            if (e.target.closest('#j-cancel-btn')) {
                const modal = document.getElementById('journal-modal');
                if (modal) modal.style.display = 'none';
            }

            // Save
            if (e.target.closest('#j-save-btn')) {
                const editId = document.getElementById('j-edit-id').value;
                const entry = {
                    id: editId || uid(),
                    date: document.getElementById('j-date').value,
                    desc: document.getElementById('j-desc').value.trim(),
                    debitAcc: document.getElementById('j-debit-acc').value.trim(),
                    debitAmt: parseFloat(document.getElementById('j-debit-amt').value) || 0,
                    creditAcc: document.getElementById('j-credit-acc').value.trim(),
                    creditAmt: parseFloat(document.getElementById('j-credit-amt').value) || 0,
                };
                if (!entry.desc || !entry.debitAcc || !entry.creditAcc) {
                    alert('Please fill in description, debit account, and credit account.');
                    return;
                }
                if (editId) {
                    const idx = appData.journal.findIndex(j => j.id === editId);
                    if (idx >= 0) appData.journal[idx] = entry;
                } else {
                    appData.journal.push(entry);
                }
                saveLocal();
                syncData();
                const modal = document.getElementById('journal-modal');
                if (modal) modal.style.display = 'none';
                renderJournalTable();
            }

            // Edit
            const editBtn = e.target.closest('.j-edit-btn');
            if (editBtn) {
                const id = editBtn.getAttribute('data-id');
                const entry = appData.journal.find(j => String(j.id) === String(id));
                if (!entry) return;
                const modal = document.getElementById('journal-modal');
                if (!modal) return;
                modal.style.display = 'block';
                document.getElementById('journal-modal-title').textContent = 'Edit Journal Entry';
                document.getElementById('j-edit-id').value = entry.id;
                document.getElementById('j-date').value = entry.date || '';
                document.getElementById('j-desc').value = entry.desc || '';
                document.getElementById('j-debit-acc').value = entry.debitAcc || '';
                document.getElementById('j-debit-amt').value = entry.debitAmt || '';
                document.getElementById('j-credit-acc').value = entry.creditAcc || '';
                document.getElementById('j-credit-amt').value = entry.creditAmt || '';
            }

            // Delete
            const delBtn = e.target.closest('.j-del-btn');
            if (delBtn) {
                const id = delBtn.getAttribute('data-id');
                if (!confirm('Delete this entry?')) return;
                appData.journal = appData.journal.filter(j => String(j.id) !== String(id));
                saveLocal();
                syncData();
                renderJournalTable();
            }
        });
    }

    // Export button
    const exportBtn = document.getElementById('export-journal-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportJournalCSV);
    }
}

function renderJournalTable() {
    const tbody = document.querySelector('#journal-table tbody');
    if (!tbody) return;
    if (appData.journal.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);">No journal entries yet.</td></tr>';
        return;
    }
    tbody.innerHTML = [...appData.journal].reverse().map(e => `
        <tr>
            <td>${e.date || ''}</td>
            <td>${e.debitAcc || ''} / ${e.creditAcc || ''}</td>
            <td>${e.desc || ''}</td>
            <td>${e.debitAmt ? fmt(e.debitAmt) : '—'}</td>
            <td>${e.creditAmt ? fmt(e.creditAmt) : '—'}</td>
            <td style="display:flex;gap:0.5rem;">
                <button class="btn btn-sm btn-secondary j-edit-btn" data-id="${e.id}">Edit</button>
                <button class="btn btn-sm btn-secondary j-del-btn" data-id="${e.id}" style="color:var(--danger);">Del</button>
            </td>
        </tr>
    `).join('');
}

function exportJournalCSV() {
    if (appData.journal.length === 0) { alert('No entries to export.'); return; }
    const header = 'Date,Description,Debit Account,Debit Amount,Credit Account,Credit Amount\n';
    const rows = appData.journal.map(e => [e.date, e.desc, e.debitAcc, e.debitAmt, e.creditAcc, e.creditAmt].join(',')).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'journal_export.csv';
    a.click();
}

// =============================================
// LEDGER
// =============================================
function initLedger() {
    const select = document.getElementById('ledger-acc-select');
    if (!select) return;

    // Get all unique accounts from journal
    const accounts = new Set();
    appData.journal.forEach(e => {
        if (e.debitAcc) accounts.add(e.debitAcc);
        if (e.creditAcc) accounts.add(e.creditAcc);
    });

    select.innerHTML = '<option value="">Select Account...</option>';
    [...accounts].sort().forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc;
        opt.textContent = acc;
        select.appendChild(opt);
    });

    select.addEventListener('change', () => {
        renderLedger(select.value);
    });
}

function renderLedger(account) {
    const tbody = document.querySelector('#ledger-table tbody');
    if (!tbody) return;

    if (!account) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">Select an account to view its ledger.</td></tr>';
        return;
    }

    const entries = appData.journal.filter(e => e.debitAcc === account || e.creditAcc === account);
    entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">No transactions for this account.</td></tr>';
        return;
    }

    let balance = 0;
    tbody.innerHTML = entries.map(e => {
        let debit = 0, credit = 0, particulars = '';
        if (e.debitAcc === account) {
            debit = parseFloat(e.debitAmt) || 0;
            particulars = `By ${e.creditAcc}`;
        }
        if (e.creditAcc === account) {
            credit = parseFloat(e.creditAmt) || 0;
            particulars = `To ${e.debitAcc}`;
        }
        balance += debit - credit;
        const balStr = (balance >= 0 ? '' : '-') + '₹ ' + Math.abs(balance).toFixed(2) + (balance >= 0 ? ' Dr' : ' Cr');
        return `
            <tr>
                <td>${e.date || ''}</td>
                <td>${e.desc || ''}<br><small style="color:var(--text-secondary);">${particulars}</small></td>
                <td>${debit ? fmt(debit) : '—'}</td>
                <td>${credit ? fmt(credit) : '—'}</td>
                <td>${balStr}</td>
            </tr>
        `;
    }).join('');
}

// =============================================
// TRIAL BALANCE
// =============================================
function initTrialBalance() {
    const accounts = {};
    appData.journal.forEach(e => {
        if (e.debitAcc) {
            if (!accounts[e.debitAcc]) accounts[e.debitAcc] = { debit: 0, credit: 0 };
            accounts[e.debitAcc].debit += parseFloat(e.debitAmt) || 0;
        }
        if (e.creditAcc) {
            if (!accounts[e.creditAcc]) accounts[e.creditAcc] = { debit: 0, credit: 0 };
            accounts[e.creditAcc].credit += parseFloat(e.creditAmt) || 0;
        }
    });

    const tbody = document.querySelector('#tb-table tbody');
    if (!tbody) return;

    const names = Object.keys(accounts).sort();
    let totalDebit = 0, totalCredit = 0;

    if (names.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);">No data available.</td></tr>';
    } else {
        tbody.innerHTML = names.map(acc => {
            const { debit, credit } = accounts[acc];
            // Net: show debit balance or credit balance
            const netDebit = Math.max(0, debit - credit);
            const netCredit = Math.max(0, credit - debit);
            totalDebit += netDebit;
            totalCredit += netCredit;
            return `
                <tr>
                    <td>${acc}</td>
                    <td style="text-align:right;">${netDebit > 0 ? fmt(netDebit) : '—'}</td>
                    <td style="text-align:right;">${netCredit > 0 ? fmt(netCredit) : '—'}</td>
                </tr>
            `;
        }).join('');
    }

    const tdEl = document.getElementById('tb-total-debit');
    const tcEl = document.getElementById('tb-total-credit');
    if (tdEl) tdEl.innerHTML = `<strong>${fmt(totalDebit)}</strong>`;
    if (tcEl) tcEl.innerHTML = `<strong>${fmt(totalCredit)}</strong>`;
}

// =============================================
// CASH BOOK
// =============================================
function initCashBook() {
    const cashEntries = [];
    appData.journal.forEach(e => {
        const d = (e.debitAcc || '').toLowerCase();
        const c = (e.creditAcc || '').toLowerCase();
        if (d.includes('cash')) {
            cashEntries.push({ date: e.date, particulars: e.desc + ` (from ${e.creditAcc})`, receipts: parseFloat(e.debitAmt) || 0, payments: 0 });
        }
        if (c.includes('cash')) {
            cashEntries.push({ date: e.date, particulars: e.desc + ` (to ${e.debitAcc})`, receipts: 0, payments: parseFloat(e.creditAmt) || 0 });
        }
    });
    cashEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const tbody = document.querySelector('#cash-book-table tbody');
    if (!tbody) return;

    if (cashEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">No cash transactions yet.</td></tr>';
        return;
    }

    let balance = 0;
    tbody.innerHTML = cashEntries.map(entry => {
        balance += entry.receipts - entry.payments;
        const balStr = (balance >= 0 ? '₹ ' : '-₹ ') + Math.abs(balance).toFixed(2);
        return `
            <tr>
                <td>${entry.date || ''}</td>
                <td>${entry.particulars}</td>
                <td style="color:var(--success);">${entry.receipts ? fmt(entry.receipts) : '—'}</td>
                <td style="color:var(--danger);">${entry.payments ? fmt(entry.payments) : '—'}</td>
                <td>${balStr}</td>
            </tr>
        `;
    }).join('');
}

// =============================================
// FINANCIAL STATEMENTS
// =============================================
function initFinancialStatements() {
    // 1. Calculate trial balances for all accounts
    const accounts = {};
    appData.journal.forEach(e => {
        if (e.debitAcc) {
            if (!accounts[e.debitAcc]) accounts[e.debitAcc] = { debit: 0, credit: 0 };
            accounts[e.debitAcc].debit += parseFloat(e.debitAmt) || 0;
        }
        if (e.creditAcc) {
            if (!accounts[e.creditAcc]) accounts[e.creditAcc] = { debit: 0, credit: 0 };
            accounts[e.creditAcc].credit += parseFloat(e.creditAmt) || 0;
        }
    });

    // Account Keyword Dictionaries
    const incomeKeywords = ['sales', 'revenue', 'income', 'gain', 'interest received', 'commission received', 'discount received'];
    const expenseKeywords = ['rent', 'salary', 'salaries', 'wages', 'expense', 'utilities', 'electricity', 'purchase', 'purchases', 'cost', 'loss', 'depreciation', 'freight', 'carriage', 'advertising', 'stationery', 'telephone', 'water', 'tax', 'discount allowed'];
    const equityKeywords = ['capital', 'equity', 'drawing', 'drawings', 'share capital', 'retained earnings'];
    const liabilityKeywords = ['payable', 'creditor', 'creditors', 'loan', 'borrowing', 'overdraft', 'liability', 'liabilities', 'duty', 'duties', 'tax payable', 'outstanding', 'unearned'];
    const assetKeywords = ['cash', 'bank', 'receivable', 'debtor', 'debtors', 'inventory', 'stock', 'equipment', 'machinery', 'building', 'land', 'furniture', 'fixtures', 'vehicle', 'asset', 'prepaid', 'investment'];

    function classifyAccount(accName) {
        const lower = accName.toLowerCase();
        if (equityKeywords.some(k => lower.includes(k))) return 'equity';
        if (incomeKeywords.some(k => lower.includes(k))) return 'income';
        if (expenseKeywords.some(k => lower.includes(k))) return 'expense';
        if (liabilityKeywords.some(k => lower.includes(k))) return 'liability';
        if (assetKeywords.some(k => lower.includes(k))) return 'asset';
        return 'unclassified';
    }

    let totalIncome = 0;
    let totalExpenses = 0;
    const isIncomeRows = [];
    const isExpenseRows = [];

    const bsAssetRows = [];
    const bsLiabilityRows = [];
    const bsEquityRows = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    Object.entries(accounts).forEach(([acc, { debit, credit }]) => {
        const type = classifyAccount(acc);
        const netDebit = debit - credit;
        const netCredit = credit - debit;

        if (type === 'income') {
            const amt = netCredit > 0 ? netCredit : -netDebit;
            totalIncome += amt;
            isIncomeRows.push({ label: acc, amount: amt });
        } else if (type === 'expense') {
            const amt = netDebit > 0 ? netDebit : -netCredit;
            totalExpenses += amt;
            isExpenseRows.push({ label: acc, amount: amt });
        } else if (type === 'equity') {
            const isDrawing = acc.toLowerCase().includes('drawing');
            const amt = isDrawing ? (netDebit > 0 ? -netDebit : netCredit) : (netCredit > 0 ? netCredit : -netDebit);
            totalEquity += amt;
            bsEquityRows.push({ label: acc, amount: amt });
        } else if (type === 'liability') {
            const amt = netCredit > 0 ? netCredit : -netDebit;
            if (amt !== 0) {
                totalLiabilities += amt;
                bsLiabilityRows.push({ label: acc, amount: amt });
            }
        } else if (type === 'asset') {
            const amt = netDebit > 0 ? netDebit : -netCredit;
            if (amt !== 0) {
                totalAssets += amt;
                bsAssetRows.push({ label: acc, amount: amt });
            }
        } else {
            // Unclassified: default based on normal balance
            if (netDebit > 0) {
                totalAssets += netDebit;
                bsAssetRows.push({ label: acc, amount: netDebit });
            } else if (netCredit > 0) {
                totalLiabilities += netCredit;
                bsLiabilityRows.push({ label: acc, amount: netCredit });
            }
        }
    });

    // 2. Render Income Statement
    const isTbody = document.querySelector('#is-table tbody');
    if (isTbody) {
        let isHtml = `
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>Revenues / Income</strong></td></tr>
        `;
        if (isIncomeRows.length === 0) {
            isHtml += `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);">No revenue entries</td></tr>`;
        } else {
            isIncomeRows.forEach(r => {
                isHtml += `<tr><td style="padding-left:1.5rem;">${r.label}</td><td style="text-align:right;">${fmt(r.amount)}</td></tr>`;
            });
        }
        isHtml += `<tr><td><strong>Total Revenue</strong></td><td style="text-align:right;"><strong>${fmt(totalIncome)}</strong></td></tr>`;

        isHtml += `
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>Operating Expenses</strong></td></tr>
        `;
        if (isExpenseRows.length === 0) {
            isHtml += `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);">No expense entries</td></tr>`;
        } else {
            isExpenseRows.forEach(r => {
                isHtml += `<tr><td style="padding-left:1.5rem;">${r.label}</td><td style="text-align:right;">${fmt(r.amount)}</td></tr>`;
            });
        }
        isHtml += `<tr><td><strong>Total Expenses</strong></td><td style="text-align:right;"><strong>${fmt(totalExpenses)}</strong></td></tr>`;

        isTbody.innerHTML = isHtml;
    }

    const netPL = totalIncome - totalExpenses;
    const isResult = document.getElementById('is-result');
    if (isResult) {
        isResult.style.background = netPL >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
        isResult.style.color = netPL >= 0 ? 'var(--success)' : 'var(--danger)';
        isResult.textContent = `Net ${netPL >= 0 ? 'Profit' : 'Loss'}: ${fmt(Math.abs(netPL))}`;
    }

    // 3. Render Balance Sheet
    const bsTbody = document.querySelector('#bs-table tbody');
    if (bsTbody) {
        let bsHtml = `
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>ASSETS</strong></td></tr>
        `;
        if (bsAssetRows.length === 0) {
            bsHtml += `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);">No asset entries</td></tr>`;
        } else {
            bsAssetRows.forEach(r => {
                bsHtml += `<tr><td style="padding-left:1.5rem;">${r.label}</td><td style="text-align:right;">${fmt(r.amount)}</td></tr>`;
            });
        }
        bsHtml += `<tr style="border-top:1px solid var(--border);"><td><strong>Total Assets</strong></td><td style="text-align:right;color:var(--accent);"><strong>${fmt(totalAssets)}</strong></td></tr>`;

        bsHtml += `
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>LIABILITIES</strong></td></tr>
        `;
        if (bsLiabilityRows.length === 0) {
            bsHtml += `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);">No liability entries</td></tr>`;
        } else {
            bsLiabilityRows.forEach(r => {
                bsHtml += `<tr><td style="padding-left:1.5rem;">${r.label}</td><td style="text-align:right;">${fmt(r.amount)}</td></tr>`;
            });
        }
        bsHtml += `<tr style="border-top:1px solid var(--border);"><td><strong>Total Liabilities</strong></td><td style="text-align:right;"><strong>${fmt(totalLiabilities)}</strong></td></tr>`;

        bsHtml += `
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>OWNER'S EQUITY</strong></td></tr>
        `;
        if (bsEquityRows.length === 0 && netPL === 0) {
            bsHtml += `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);">No equity entries</td></tr>`;
        } else {
            bsEquityRows.forEach(r => {
                bsHtml += `<tr><td style="padding-left:1.5rem;">${r.label}</td><td style="text-align:right;">${fmt(r.amount)}</td></tr>`;
            });
            bsHtml += `<tr><td style="padding-left:1.5rem;">Retained Earnings (Net Income)</td><td style="text-align:right;">${fmt(netPL)}</td></tr>`;
        }
        const totalEquityAndEarnings = totalEquity + netPL;
        bsHtml += `<tr style="border-top:1px solid var(--border);"><td><strong>Total Equity</strong></td><td style="text-align:right;"><strong>${fmt(totalEquityAndEarnings)}</strong></td></tr>`;

        const totalLiabAndEquity = totalLiabilities + totalEquityAndEarnings;
        bsHtml += `
            <tr style="background:rgba(59,130,246,0.15);border-top:2px solid var(--accent);font-weight:bold;">
                <td><strong>TOTAL LIABILITIES & EQUITY</strong></td>
                <td style="text-align:right;color:var(--accent);"><strong>${fmt(totalLiabAndEquity)}</strong></td>
            </tr>
        `;

        bsTbody.innerHTML = bsHtml;
    }

    const totalLiabAndEquity = totalLiabilities + totalEquity + netPL;
    const bsResult = document.getElementById('bs-result');
    if (bsResult) {
        const isBalanced = Math.abs(totalAssets - totalLiabAndEquity) < 0.01;
        bsResult.style.display = 'flex';
        bsResult.style.justifyContent = 'space-between';
        bsResult.style.alignItems = 'center';
        bsResult.style.background = isBalanced ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
        bsResult.style.color = isBalanced ? 'var(--success)' : 'var(--danger)';
        bsResult.innerHTML = `
            <span>Total Assets: <strong>${fmt(totalAssets)}</strong></span>
            <span>${isBalanced ? '✓ Balanced' : '⚠ Difference: ' + fmt(Math.abs(totalAssets - totalLiabAndEquity))}</span>
            <span>Total Liab & Equity: <strong>${fmt(totalLiabAndEquity)}</strong></span>
        `;
    }
}

// =============================================
// SETTINGS
// =============================================
function initSettingsView() {
    document.getElementById('gh-pat').value = settings.pat || '';
    document.getElementById('gh-owner').value = settings.owner || '';
    document.getElementById('gh-repo').value = settings.repo || '';
    document.getElementById('gh-path').value = settings.path || 'data.json';

    document.getElementById('save-settings-btn').addEventListener('click', () => {
        settings = {
            pat: document.getElementById('gh-pat').value.trim(),
            owner: document.getElementById('gh-owner').value.trim() || 'Tanmay201010',
            repo: document.getElementById('gh-repo').value.trim() || 'udaan',
            path: document.getElementById('gh-path').value.trim() || 'data.json',
        };
        localStorage.setItem('udaanSettings', JSON.stringify(settings));
        const msgEl = document.getElementById('settings-msg');
        if (msgEl) {
            msgEl.innerHTML = '<p style="color:var(--success);">Settings saved! Testing connection...</p>';
        }
        testGitHubConnection();
    });
}

// =============================================
// GITHUB SYNC
// =============================================
function updateSyncStatus(msg, type) {
    const text = document.getElementById('sync-status-text');
    const indicator = document.querySelector('.sync-status .status-indicator');
    if (text) text.textContent = msg;
    if (indicator) {
        indicator.className = 'status-indicator';
        if (type === 'ok') indicator.style.background = 'var(--success)';
        else if (type === 'warning') indicator.style.background = '#f59e0b';
        else if (type === 'error') indicator.style.background = 'var(--danger)';
        else indicator.style.background = 'var(--text-secondary)';
    }
}

async function fetchFromGitHub() {
    if (!settings.pat || !settings.owner || !settings.repo) return;
    updateSyncStatus('Syncing...', 'warning');
    try {
        const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path || 'data.json'}`;
        const res = await fetch(url, { headers: { Authorization: `token ${settings.pat}`, Accept: 'application/vnd.github.v3+json' } });
        if (!res.ok) {
            if (res.status === 404) {
                updateSyncStatus('File not found on GitHub — will create on next save.', 'warning');
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        currentSha = json.sha;
        const decoded = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
        const data = JSON.parse(decoded);
        appData = { inventory: data.inventory || [], pos: data.pos || [], journal: data.journal || [], nextInvoice: data.nextInvoice || 1 };
        ensureIds();
        saveLocal();
        updateSyncStatus('Synced from GitHub', 'ok');
        // Refresh current view
        const hash = location.hash.replace('#', '') || 'dashboard';
        navigateTo(hash, false);
    } catch (err) {
        updateSyncStatus('Sync error: ' + err.message, 'error');
    }
}

async function syncData() {
    if (!settings.pat || !settings.owner || !settings.repo) {
        updateSyncStatus('Not configured', 'warning');
        return;
    }
    updateSyncStatus('Saving...', 'warning');
    try {
        const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path || 'data.json'}`;
        const jsonStr = JSON.stringify(appData, null, 2);
        const content = btoa(unescape(encodeURIComponent(jsonStr)));
        const body = { message: 'UdaanPro data update', content };
        if (currentSha) body.sha = currentSha;
        
        let res = await fetch(url, {
            method: 'PUT',
            headers: { Authorization: `token ${settings.pat}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
            body: JSON.stringify(body)
        });

        // If 409 Conflict, re-fetch the latest sha and retry once
        if (res.status === 409) {
            const getRes = await fetch(url, { headers: { Authorization: `token ${settings.pat}`, Accept: 'application/vnd.github.v3+json' } });
            if (getRes.ok) {
                const getJson = await getRes.json();
                currentSha = getJson.sha;
                body.sha = currentSha;
                res = await fetch(url, {
                    method: 'PUT',
                    headers: { Authorization: `token ${settings.pat}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
                    body: JSON.stringify(body)
                });
            }
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        currentSha = json.content ? json.content.sha : json.sha;
        updateSyncStatus('Saved to GitHub ✓', 'ok');
    } catch (err) {
        updateSyncStatus('Save error: ' + err.message, 'error');
    }
}

async function testGitHubConnection() {
    await fetchFromGitHub();
    const msgEl = document.getElementById('settings-msg');
    if (msgEl) {
        const statusText = document.getElementById('sync-status-text');
        const msg = statusText ? statusText.textContent : '';
        if (msg.includes('Synced') || msg.includes('not found')) {
            msgEl.innerHTML = '<p style="color:var(--success);">✓ Connection successful! Settings saved.</p>';
        } else {
            msgEl.innerHTML = `<p style="color:var(--danger);">Connection issue: ${msg}</p>`;
        }
    }
}

// =============================================
// BOOT
// =============================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
