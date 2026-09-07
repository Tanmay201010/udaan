// =============================================
// UdaanPro - Accounting Web App
// =============================================

// --- State ---
let currentRole = localStorage.getItem('udaanRole') || null;
let settings = JSON.parse(localStorage.getItem('udaanSettings') || '{}');
let appData = { inventory: [], pos: [], journal: [], nextInvoice: 1 };
let currentSha = null;
let journalListenersAttached = false;
let autoSyncTimer = null;

// --- Account Classifier Engine ---
const incomeKeywords = ['sales', 'sales a/c', 'revenue', 'income', 'gain', 'interest received', 'commission', 'commission a/c', 'commission received', 'commission paid by consignor', 'markup', 'discount received'];
const expenseKeywords = ['rent', 'salary', 'salaries', 'wages', 'expense', 'expenses', 'utilities', 'electricity', 'purchase', 'purchases', 'cost', 'loss', 'depreciation', 'freight', 'carriage', 'advertising', 'stationery', 'telephone', 'water', 'tax', 'discount allowed', 'rapido', 'zepto', 'swiggy', 'zomato', 'delivery', 'courier', 'travel', 'conveyance', 'transport', 'logistics', 'printing', 'banner', 'banners', 'packaging', 'refreshments', 'food', 'snacks', 'tea', 'coffee', 'supplies', 'maintenance'];
const equityKeywords = ['capital', 'equity', 'drawing', 'drawings', 'share capital', 'retained earnings'];
const liabilityKeywords = ['payable', 'consignor payable', 'creditor', 'creditors', 'loan', 'borrowing', 'overdraft', 'liability', 'liabilities', 'duty', 'duties', 'tax payable', 'outstanding', 'unearned'];
const assetKeywords = ['cash', 'cash a/c', 'bank', 'receivable', 'debtor', 'debtors', 'inventory', 'stock', 'equipment', 'machinery', 'building', 'land', 'furniture', 'fixtures', 'vehicle', 'asset', 'prepaid', 'investment'];

function classifyAccount(accName) {
    if (!accName) return 'unclassified';
    const lower = accName.toLowerCase().trim();
    if (equityKeywords.some(k => lower.includes(k))) return 'equity';
    if (incomeKeywords.some(k => lower.includes(k))) return 'income';
    if (expenseKeywords.some(k => lower.includes(k))) return 'expense';
    if (liabilityKeywords.some(k => lower.includes(k))) return 'liability';
    if (assetKeywords.some(k => lower.includes(k))) return 'asset';
    return 'unclassified';
}

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

function getBillTime(bill) {
    if (bill.time) return bill.time;
    if (bill.createdAt) {
        try {
            return new Date(bill.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        } catch(e) {}
    }
    if (bill.id && bill.id.length >= 8) {
        try {
            const ts = parseInt(bill.id.slice(0, 8), 36);
            if (ts > 1000000000000 && ts < 2500000000000) {
                return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            }
        } catch(e) {}
    }
    return '—';
}

function getSafeNextInvoice() {
    let maxNum = 0;
    if (appData.pos) {
        appData.pos.forEach(b => {
            const m = (b.invoiceNo || '').match(/#(\d+)/);
            if (m) {
                const num = parseInt(m[1]);
                if (num > maxNum) maxNum = num;
            }
        });
    }
    const nextNum = Math.max(maxNum + 1, appData.nextInvoice || 1);
    appData.nextInvoice = nextNum;
    return '#' + String(nextNum).padStart(6, '0');
}

function calculateBillSplit(bill) {
    let gross = 0;
    let comm = 0;
    let salesCost = 0;

    (bill.items || []).forEach(item => {
        const qty = parseInt(item.qty) || 1;
        const salePrice = parseFloat(item.salePrice) || 0;
        let costPrice = item.costPrice !== undefined ? parseFloat(item.costPrice) : null;
        if (costPrice === null || isNaN(costPrice)) {
            const inv = appData.inventory.find(i => i.id === item.id || i.name === item.name);
            costPrice = inv ? parseFloat(inv.price) || 0 : salePrice;
        }

        const subtotal = salePrice * qty;
        gross += subtotal;

        if (Math.abs(salePrice - costPrice) < 0.001) {
            // Price unchanged: 20% commission, sales = 80% (price after reduction of 20%)
            const c = subtotal * 0.20;
            comm += c;
            salesCost += (subtotal - c);
        } else {
            // Price changed: sales = cost price, commission = rest of total
            const markup = (salePrice - costPrice) * qty;
            comm += markup;
            salesCost += (costPrice * qty);
        }
    });

    return {
        gross: Math.round(gross * 100) / 100,
        salesCost: Math.round(salesCost * 100) / 100,
        commissionEarned: Math.round(comm * 100) / 100
    };
}

function createCompoundSaleJournalEntry(bill) {
    const { gross, salesCost, commissionEarned } = calculateBillSplit(bill);
    const customer = bill.customer || 'Walk-in Customer';
    const note = bill.note || 'Cash';

    return {
        id: bill.id + '_j',
        date: bill.date || today(),
        desc: `Sale - Invoice ${bill.invoiceNo} to ${customer} [${note}]`,
        debitAcc: 'Cash A/c',
        debitAmt: gross,
        creditAcc: 'Sales A/c / Commission A/c',
        creditAmt: gross,
        isCompound: true,
        entries: [
            { type: 'Dr', account: 'Cash A/c', amount: gross },
            { type: 'Cr', account: 'Sales A/c', amount: salesCost },
            { type: 'Cr', account: 'Commission A/c', amount: commissionEarned }
        ]
    };
}

function ensureIds() {
    if (appData.journal) appData.journal.forEach(e => { if (!e.id) e.id = uid(); });
    if (appData.pos) appData.pos.forEach(b => { if (!b.id) b.id = uid(); });
    if (appData.inventory) appData.inventory.forEach(i => { if (!i.id) i.id = uid(); });
}

function reconcileMissingJournalEntries() {
    if (!appData.pos || !appData.journal) return;
    const posMap = new Map();
    appData.pos.forEach(b => { if (b.invoiceNo) posMap.set(b.invoiceNo, b); });

    const journalInvoices = new Set();
    appData.journal.forEach(j => {
        const m = (j.desc || '').match(/#(\d+)/);
        if (m) journalInvoices.add('#' + m[1].padStart(6, '0'));
    });

    let added = 0;
    appData.pos.forEach(b => {
        if (b.invoiceNo && !journalInvoices.has(b.invoiceNo)) {
            appData.journal.push(createCompoundSaleJournalEntry(b));
            journalInvoices.add(b.invoiceNo);
            added++;
        }
    });

    if (added > 0) {
        saveLocal();
    }
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
    reconcileMissingJournalEntries();
}

async function fetchDefaultData() {
    try {
        const res = await fetch('data.json?t=' + Date.now());
        if (res.ok) {
            const data = await res.json();
            if (data && (data.inventory || data.pos || data.journal)) {
                if (!appData.pos || appData.pos.length < (data.pos ? data.pos.length : 0)) {
                    appData = mergeAppData(data);
                    ensureIds();
                    saveLocal();
                    refreshDashboardStats();
                }
            }
        }
    } catch(e) {
        console.warn('Could not fetch data.json fallback', e);
    }
}

function mergeAppData(remoteData) {
    const posMap = new Map();
    (appData.pos || []).forEach(b => posMap.set(b.id || b.invoiceNo, b));
    (remoteData.pos || []).forEach(b => posMap.set(b.id || b.invoiceNo, b));

    const jMap = new Map();
    (appData.journal || []).forEach(j => jMap.set(j.id, j));
    (remoteData.journal || []).forEach(j => jMap.set(j.id, j));

    const merged = {
        inventory: remoteData.inventory || appData.inventory || [],
        pos: Array.from(posMap.values()),
        journal: Array.from(jMap.values()),
        nextInvoice: Math.max(appData.nextInvoice || 1, remoteData.nextInvoice || 1)
    };
    return merged;
}

// --- Dynamic Reactivity ---
function refreshDashboardStats() {
    let cashBalance = 0;
    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                const acc = (e.account || '').toLowerCase();
                if (acc.includes('cash') || acc.includes('bank')) {
                    if (e.type === 'Dr') cashBalance += parseFloat(e.amount) || 0;
                    if (e.type === 'Cr') cashBalance -= parseFloat(e.amount) || 0;
                }
            });
        } else {
            const d = (j.debitAcc || '').toLowerCase();
            const c = (j.creditAcc || '').toLowerCase();
            if (d.includes('cash') || d.includes('bank')) cashBalance += parseFloat(j.debitAmt) || 0;
            if (c.includes('cash') || c.includes('bank')) cashBalance -= parseFloat(j.creditAmt) || 0;
        }
    });

    const totalBills = appData.pos ? appData.pos.length : 0;

    let expenses = 0;
    const accBalances = {};
    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                const acc = e.account;
                const amt = parseFloat(e.amount) || 0;
                if (e.type === 'Dr') accBalances[acc] = (accBalances[acc] || 0) + amt;
                if (e.type === 'Cr') accBalances[acc] = (accBalances[acc] || 0) - amt;
            });
        } else {
            if (j.debitAcc) accBalances[j.debitAcc] = (accBalances[j.debitAcc] || 0) + (parseFloat(j.debitAmt) || 0);
            if (j.creditAcc) accBalances[j.creditAcc] = (accBalances[j.creditAcc] || 0) - (parseFloat(j.creditAmt) || 0);
        }
    });

    Object.entries(accBalances).forEach(([acc, netDr]) => {
        if (classifyAccount(acc) === 'expense' && netDr > 0) {
            expenses += netDr;
        }
    });

    const totalJournal = appData.journal ? appData.journal.length : 0;

    const cashEl = document.getElementById('dash-cash-balance');
    if (cashEl) cashEl.textContent = fmt(cashBalance);

    const billsEl = document.getElementById('dash-bills-count');
    if (billsEl) billsEl.textContent = totalBills;

    const expEl = document.getElementById('dash-expenses');
    if (expEl) expEl.textContent = fmt(expenses);

    const jEl = document.getElementById('dash-journal-count');
    if (jEl) jEl.textContent = totalJournal;
}

function notifyDataChanged() {
    saveLocal();
    syncData();
    refreshDashboardStats();
}

// =============================================
// INIT APP
// =============================================
function initApp() {
    loadLocal();
    fetchDefaultData();
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

    if (user === 'admin' && (pass === 'sales' || pass === 'finance')) {
        currentRole = pass;
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

    document.querySelectorAll('#app li[data-role]').forEach(li => {
        const role = li.getAttribute('data-role');
        if (role === 'all' || role === currentRole) {
            li.style.display = '';
        } else {
            li.style.display = 'none';
        }
    });

    document.getElementById('logout-btn').addEventListener('click', e => {
        e.preventDefault();
        localStorage.removeItem('udaanRole');
        currentRole = null;
        location.reload();
    });

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

    document.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const target = link.getAttribute('data-target');
            navigateTo(target);
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    });

    document.getElementById('force-sync-btn').addEventListener('click', () => {
        syncData();
    });

    if (settings.pat && settings.owner && settings.repo) {
        fetchFromGitHub();
        startAutoSyncPolling();
    } else {
        updateSyncStatus('Not configured', 'warning');
    }

    const hash = location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);

    window.addEventListener('popstate', () => {
        const h = location.hash.replace('#', '') || 'dashboard';
        navigateTo(h, false);
    });
}

function startAutoSyncPolling() {
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = setInterval(() => {
        if (settings.pat && settings.owner && settings.repo) {
            fetchFromGitHub();
        }
    }, 10000);
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
    refreshDashboardStats();

    const tbody = document.querySelector('#dash-recent-table tbody');
    if (tbody) {
        const recent = [...appData.journal].reverse().slice(0, 10);
        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);">No transactions yet.</td></tr>';
        } else {
            tbody.innerHTML = recent.map(j => {
                let accStr = `${j.debitAcc || ''} / ${j.creditAcc || ''}`;
                if (j.entries && j.entries.length > 0) {
                    const drs = j.entries.filter(e => e.type === 'Dr').map(e => e.account).join(', ');
                    const crs = j.entries.filter(e => e.type === 'Cr').map(e => e.account).join(', ');
                    accStr = `${drs} / ${crs}`;
                }
                const amt = j.debitAmt || j.creditAmt || (j.entries && j.entries[0] ? j.entries[0].amount : 0);
                return `
                    <tr>
                        <td>${j.date || ''}</td>
                        <td>${j.desc || ''}</td>
                        <td>${accStr}</td>
                        <td>${fmt(amt)}</td>
                    </tr>
                `;
            }).join('');
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

        notifyDataChanged();
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
            notifyDataChanged();
            renderInventoryTable();
        });
    });
}

// =============================================
// POS / BILLING COUNTER
// =============================================
function initPOS() {
    let posItems = [];

    const invoiceNo = getSafeNextInvoice();
    const posNoEl = document.getElementById('pos-no');
    const posDateEl = document.getElementById('pos-date');
    if (posNoEl) posNoEl.value = invoiceNo;
    if (posDateEl) posDateEl.value = today();

    const searchInput = document.getElementById('pos-product-input');
    const dropdownEl = document.getElementById('pos-product-dropdown');
    const qtyInput = document.getElementById('pos-qty');
    const priceInput = document.getElementById('pos-sale-price');
    let selectedInvItem = null;

    function renderDropdown(filterText = '') {
        if (!dropdownEl) return;
        const q = filterText.toLowerCase().trim();
        const available = appData.inventory.filter(item => {
            if (item.qty <= 0) return false;
            if (!q) return true;
            return item.name.toLowerCase().includes(q) || (item.consignor && item.consignor.toLowerCase().includes(q));
        });

        if (available.length === 0) {
            dropdownEl.innerHTML = '<div style="padding:0.65rem; color:var(--text-secondary); text-align:center;">No matching available products</div>';
            dropdownEl.style.display = 'block';
            return;
        }

        dropdownEl.innerHTML = available.map(item => `
            <div class="pos-dropdown-item" data-id="${item.id}">
                <div>
                    <div class="pos-item-title">${item.name}</div>
                    <div class="pos-item-sub">${item.consignor ? 'Consignor: ' + item.consignor + ' · ' : ''}Base Price: ${fmt(item.price)}</div>
                </div>
                <div style="text-align:right;">
                    <span class="pos-item-badge ${item.qty <= 5 ? 'low' : ''}">Stock: ${item.qty}</span>
                </div>
            </div>
        `).join('');

        dropdownEl.style.display = 'block';

        dropdownEl.querySelectorAll('.pos-dropdown-item').forEach(itemEl => {
            itemEl.addEventListener('click', () => {
                const id = itemEl.getAttribute('data-id');
                const inv = appData.inventory.find(i => String(i.id) === String(id));
                if (inv) selectInventoryItem(inv);
            });
        });
    }

    function selectInventoryItem(inv) {
        selectedInvItem = inv;
        if (searchInput) searchInput.value = inv.name;
        if (priceInput) priceInput.value = inv.price;
        if (qtyInput) {
            qtyInput.value = 1;
            qtyInput.max = inv.qty;
        }
        if (dropdownEl) dropdownEl.style.display = 'none';
    }

    if (searchInput) {
        searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
        searchInput.addEventListener('input', () => renderDropdown(searchInput.value));
    }

    document.addEventListener('click', (e) => {
        if (dropdownEl && searchInput && !searchInput.contains(e.target) && !dropdownEl.contains(e.target)) {
            dropdownEl.style.display = 'none';
        }
    });

    const addBtn = document.getElementById('pos-add-item-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            const val = searchInput ? searchInput.value.trim() : '';
            let inv = selectedInvItem;
            if (!inv && val) {
                inv = appData.inventory.find(i => i.qty > 0 && (i.name.toLowerCase() === val.toLowerCase() || i.name.toLowerCase().includes(val.toLowerCase())));
            }

            if (!inv) {
                alert('Please select an available product from the inventory list.');
                return;
            }

            const qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;
            const salePrice = parseFloat(priceInput ? priceInput.value : inv.price);

            if (qty <= 0) { alert('Quantity must be at least 1.'); return; }
            if (qty > inv.qty) { alert(`Only ${inv.qty} units available in stock for ${inv.name}.`); return; }
            if (isNaN(salePrice) || salePrice <= 0) { alert('Please enter a valid sale price.'); return; }

            const existing = posItems.find(i => String(i.id) === String(inv.id));
            if (existing) {
                if (existing.qty + qty > inv.qty) {
                    alert(`Cannot add more than available stock (${inv.qty}).`);
                    return;
                }
                existing.qty += qty;
                existing.salePrice = salePrice;
            } else {
                posItems.push({
                    id: inv.id,
                    name: inv.name,
                    consignor: inv.consignor || '',
                    costPrice: inv.price,
                    salePrice: salePrice,
                    qty: qty
                });
            }

            selectedInvItem = null;
            if (searchInput) searchInput.value = '';
            if (priceInput) priceInput.value = '';
            if (qtyInput) qtyInput.value = '1';
            renderPosItems();
        };
    }

    function renderPosItems() {
        const container = document.getElementById('pos-items-container');
        if (!container) return;
        if (posItems.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:1rem;">No items added yet.</p>';
            return;
        }
        let total = 0;
        posItems.forEach(i => total += i.salePrice * i.qty);
        container.innerHTML = `
            <table class="data-table" style="margin-bottom:0.5rem;">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th style="text-align:right;">Base Price</th>
                        <th style="text-align:right;">Sale Price</th>
                        <th style="text-align:center;">Qty</th>
                        <th style="text-align:right;">Subtotal</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${posItems.map((item, idx) => `
                        <tr>
                            <td>${item.name}</td>
                            <td style="text-align:right;">${fmt(item.costPrice)}</td>
                            <td style="text-align:right;">${fmt(item.salePrice)}</td>
                            <td style="text-align:center;">
                                <div class="qty-control">
                                    <button class="qty-btn pos-qty-minus" data-idx="${idx}">-</button>
                                    <span style="font-weight:600;min-width:20px;display:inline-block;">${item.qty}</span>
                                    <button class="qty-btn pos-qty-plus" data-idx="${idx}">+</button>
                                </div>
                            </td>
                            <td style="text-align:right;">${fmt(item.salePrice * item.qty)}</td>
                            <td><button class="btn btn-sm btn-secondary pos-rm-btn" data-idx="${idx}">✕</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="text-align:right;font-weight:bold;font-size:1.1rem;margin-top:0.5rem;">Total Amount: ${fmt(total)}</p>
        `;

        container.querySelectorAll('.pos-qty-minus').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-idx'));
                if (posItems[idx].qty > 1) {
                    posItems[idx].qty -= 1;
                } else {
                    posItems.splice(idx, 1);
                }
                renderPosItems();
            });
        });

        container.querySelectorAll('.pos-qty-plus').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-idx'));
                const inv = appData.inventory.find(i => String(i.id) === String(posItems[idx].id));
                if (inv && posItems[idx].qty >= inv.qty) {
                    alert(`Maximum stock reached (${inv.qty}).`);
                    return;
                }
                posItems[idx].qty += 1;
                renderPosItems();
            });
        });

        container.querySelectorAll('.pos-rm-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                posItems.splice(parseInt(btn.getAttribute('data-idx')), 1);
                renderPosItems();
            });
        });
    }

    function saveBill(withPrint) {
        const customer = (document.getElementById('pos-customer').value || '').trim() || 'Walk-in Customer';
        const note = document.getElementById('pos-note').value;
        if (posItems.length === 0) { alert('Add at least one item.'); return; }
        const total = posItems.reduce((s, i) => s + i.salePrice * i.qty, 0);

        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        const bill = {
            id: uid(),
            invoiceNo: getSafeNextInvoice(),
            date: document.getElementById('pos-date').value || today(),
            time: timeStr,
            createdAt: now.toISOString(),
            customer,
            items: posItems.map(i => ({...i})),
            total,
            note
        };

        appData.pos.push(bill);

        posItems.forEach(pi => {
            const inv = appData.inventory.find(i => String(i.id) === String(pi.id));
            if (inv) inv.qty = Math.max(0, inv.qty - pi.qty);
        });

        // Add Compound Journal Entry with exact account names: Cash A/c, Sales A/c, Commission A/c
        appData.journal.push(createCompoundSaleJournalEntry(bill));

        notifyDataChanged();

        if (withPrint) generateAndPrintBill(bill);

        posItems = [];
        document.getElementById('pos-customer').value = '';
        document.getElementById('pos-no').value = getSafeNextInvoice();
        renderPosItems();
    }

    const genBtn = document.getElementById('generate-bill-btn');
    if (genBtn) genBtn.onclick = () => saveBill(true);

    const saveBtn = document.getElementById('save-history-btn');
    if (saveBtn) saveBtn.onclick = () => saveBill(false);
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

    const timeStr = getBillTime(bill);
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
            <p><strong>Date & Time Issued:</strong></p>
            <p>${dateStr} ${timeStr !== '—' ? '· ' + timeStr : ''}</p>
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
// BILL HISTORY & EDIT BILL
// =============================================
function initBillHistory() {
    let filtered = [...appData.pos].reverse();

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
            const timeStr = getBillTime(bill);
            return `
                <tr>
                    <td><strong>${bill.invoiceNo || '—'}</strong></td>
                    <td>
                        <div><strong>${bill.date || '—'}</strong></div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);">${timeStr}</div>
                    </td>
                    <td>${bill.customer || 'Walk-in'}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${itemSummary}">${itemSummary || '—'}</td>
                    <td>${bill.note || 'Cash'}</td>
                    <td style="text-align:right;font-weight:600;">${fmt(bill.total)}</td>
                    <td style="display:flex;gap:0.4rem;">
                        <button class="btn btn-sm btn-secondary edit-bill-btn" data-id="${bill.id}">
                            <i data-lucide="edit-3"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-secondary reprint-btn" data-id="${bill.id}">
                            <i data-lucide="printer"></i> Reprint
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        lucide.createIcons();

        tbody.querySelectorAll('.reprint-btn').forEach(btn => {
            btn.onclick = () => {
                const id = btn.getAttribute('data-id');
                const bill = appData.pos.find(b => String(b.id) === String(id));
                if (bill) generateAndPrintBill(bill);
            };
        });

        tbody.querySelectorAll('.edit-bill-btn').forEach(btn => {
            btn.onclick = () => {
                const id = btn.getAttribute('data-id');
                openEditBillModal(id);
            };
        });
    }

    render(filtered);

    const searchInput = document.getElementById('bill-search');
    if (searchInput) {
        searchInput.oninput = () => {
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
        };
    }

    const exportBtn = document.getElementById('export-bills-btn');
    if (exportBtn) {
        exportBtn.onclick = () => {
            if (appData.pos.length === 0) { alert('No bills to export.'); return; }
            const header = 'Invoice No,Date,Time,Customer,Items,Payment,Total\n';
            const rows = [...appData.pos].reverse().map(b => {
                const items = (b.items || []).map(i => `${i.name}x${i.qty}`).join(' | ');
                return [b.invoiceNo, b.date, getBillTime(b), `"${b.customer}"`, `"${items}"`, b.note, b.total].join(',');
            }).join('\n');
            const blob = new Blob([header + rows], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'bill_history.csv';
            a.click();
        };
    }

    const syncFileBtn = document.getElementById('sync-bills-file-btn');
    const syncFileInput = document.getElementById('sync-file-input');
    if (syncFileBtn && syncFileInput) {
        syncFileBtn.onclick = () => syncFileInput.click();
        syncFileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const remote = JSON.parse(evt.target.result);
                    appData = mergeAppData(remote);
                    notifyDataChanged();
                    alert('Successfully merged device sync file!');
                    initBillHistory();
                } catch(err) {
                    alert('Error reading sync file: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
    }
}

function openEditBillModal(billId) {
    const bill = appData.pos.find(b => String(b.id) === String(billId));
    if (!bill) return;

    const modal = document.getElementById('edit-bill-modal');
    if (!modal) return;

    modal.style.display = 'block';
    document.getElementById('edit-bill-id').value = bill.id;
    document.getElementById('edit-bill-no').value = bill.invoiceNo || '';
    document.getElementById('edit-bill-date').value = bill.date || today();
    document.getElementById('edit-bill-time').value = getBillTime(bill);
    document.getElementById('edit-bill-customer').value = bill.customer || '';
    document.getElementById('edit-bill-note').value = bill.note || 'Cash';

    let draftItems = JSON.parse(JSON.stringify(bill.items || []));

    function renderDraftItems() {
        const listEl = document.getElementById('edit-bill-items-list');
        if (!listEl) return;

        let total = 0;
        draftItems.forEach(i => total += (i.salePrice * i.qty));
        document.getElementById('edit-bill-total-lbl').textContent = fmt(total);

        if (draftItems.length === 0) {
            listEl.innerHTML = '<p style="color:var(--text-secondary);text-align:center;">No items in bill.</p>';
            return;
        }

        listEl.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Product</th>
                        <th style="text-align:right;">Sale Price</th>
                        <th style="text-align:center;">Qty</th>
                        <th style="text-align:right;">Subtotal</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${draftItems.map((item, idx) => `
                        <tr>
                            <td>${item.name}</td>
                            <td style="text-align:right;">
                                <input type="number" class="edit-item-price-inp" data-idx="${idx}" value="${item.salePrice}" style="width:80px;padding:0.25rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;text-align:right;">
                            </td>
                            <td style="text-align:center;">
                                <input type="number" class="edit-item-qty-inp" data-idx="${idx}" min="1" value="${item.qty}" style="width:60px;padding:0.25rem;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;text-align:center;">
                            </td>
                            <td style="text-align:right;">${fmt(item.salePrice * item.qty)}</td>
                            <td><button class="btn btn-sm btn-secondary edit-item-rm-btn" data-idx="${idx}">✕</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        listEl.querySelectorAll('.edit-item-price-inp').forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.getAttribute('data-idx'));
                draftItems[idx].salePrice = parseFloat(inp.value) || 0;
                renderDraftItems();
            };
        });

        listEl.querySelectorAll('.edit-item-qty-inp').forEach(inp => {
            inp.onchange = () => {
                const idx = parseInt(inp.getAttribute('data-idx'));
                draftItems[idx].qty = Math.max(1, parseInt(inp.value) || 1);
                renderDraftItems();
            };
        });

        listEl.querySelectorAll('.edit-item-rm-btn').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.getAttribute('data-idx'));
                draftItems.splice(idx, 1);
                renderDraftItems();
            };
        });
    }

    renderDraftItems();

    document.getElementById('edit-bill-close-btn').onclick = () => modal.style.display = 'none';
    document.getElementById('edit-bill-cancel-btn').onclick = () => modal.style.display = 'none';

    document.getElementById('edit-bill-save-btn').onclick = () => {
        if (draftItems.length === 0) { alert('Bill must contain at least one item.'); return; }

        const newDate = document.getElementById('edit-bill-date').value || today();
        const newTime = document.getElementById('edit-bill-time').value.trim();
        const newCustomer = document.getElementById('edit-bill-customer').value.trim() || 'Walk-in Customer';
        const newNote = document.getElementById('edit-bill-note').value;

        (bill.items || []).forEach(oldItem => {
            const inv = appData.inventory.find(i => String(i.id) === String(oldItem.id) || i.name === oldItem.name);
            if (inv) inv.qty += oldItem.qty;
        });

        draftItems.forEach(newItem => {
            const inv = appData.inventory.find(i => String(i.id) === String(newItem.id) || i.name === newItem.name);
            if (inv) inv.qty = Math.max(0, inv.qty - newItem.qty);
        });

        const newTotal = draftItems.reduce((s, i) => s + (i.salePrice * i.qty), 0);

        bill.date = newDate;
        bill.time = newTime;
        bill.customer = newCustomer;
        bill.note = newNote;
        bill.items = draftItems;
        bill.total = newTotal;

        // Update matching compound journal entry
        const jIdx = appData.journal.findIndex(j => (j.desc || '').includes(bill.invoiceNo) || String(j.id) === String(bill.id + '_j'));
        if (jIdx >= 0) {
            appData.journal[jIdx] = createCompoundSaleJournalEntry(bill);
        } else {
            appData.journal.push(createCompoundSaleJournalEntry(bill));
        }

        notifyDataChanged();
        modal.style.display = 'none';
        initBillHistory();
    };
}

// =============================================
// JOURNAL VIEW (COMPOUND JOURNAL ENTRIES)
// =============================================
function initJournal() {
    const filterSelect = document.getElementById('journal-date-filter');
    const dates = new Set();
    appData.journal.forEach(j => { if (j.date) dates.add(j.date); });
    const sortedDates = [...dates].sort().reverse();

    if (filterSelect) {
        const cur = filterSelect.value || 'all';
        filterSelect.innerHTML = '<option value="all">All Dates</option>';
        sortedDates.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            filterSelect.appendChild(opt);
        });
        filterSelect.value = cur;
        filterSelect.onchange = () => renderJournalTable(filterSelect.value);
    }

    renderJournalTable(filterSelect ? filterSelect.value : 'all');

    if (!journalListenersAttached) {
        journalListenersAttached = true;

        document.addEventListener('click', e => {
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

            if (e.target.closest('#j-cancel-btn')) {
                const modal = document.getElementById('journal-modal');
                if (modal) modal.style.display = 'none';
            }

            if (e.target.closest('#j-save-btn')) {
                const editId = document.getElementById('j-edit-id').value;
                const dAcc = document.getElementById('j-debit-acc').value.trim();
                const dAmt = parseFloat(document.getElementById('j-debit-amt').value) || 0;
                const cAcc = document.getElementById('j-credit-acc').value.trim();
                const cAmt = parseFloat(document.getElementById('j-credit-amt').value) || 0;

                if (!document.getElementById('j-desc').value.trim() || !dAcc || !cAcc) {
                    alert('Please fill in description, debit account, and credit account.');
                    return;
                }

                const entry = {
                    id: editId || uid(),
                    date: document.getElementById('j-date').value || today(),
                    desc: document.getElementById('j-desc').value.trim(),
                    debitAcc: dAcc,
                    debitAmt: dAmt,
                    creditAcc: cAcc,
                    creditAmt: cAmt,
                    isCompound: false,
                    entries: [
                        { type: 'Dr', account: dAcc, amount: dAmt },
                        { type: 'Cr', account: cAcc, amount: cAmt }
                    ]
                };

                if (editId) {
                    const idx = appData.journal.findIndex(j => String(j.id) === String(editId));
                    if (idx >= 0) appData.journal[idx] = entry;
                } else {
                    appData.journal.push(entry);
                }
                notifyDataChanged();
                const modal = document.getElementById('journal-modal');
                if (modal) modal.style.display = 'none';
                initJournal();
            }

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
                document.getElementById('j-debit-acc').value = entry.debitAcc || (entry.entries && entry.entries[0] ? entry.entries[0].account : '');
                document.getElementById('j-debit-amt').value = entry.debitAmt || (entry.entries && entry.entries[0] ? entry.entries[0].amount : '');
                document.getElementById('j-credit-acc').value = entry.creditAcc || (entry.entries && entry.entries[1] ? entry.entries[1].account : '');
                document.getElementById('j-credit-amt').value = entry.creditAmt || (entry.entries && entry.entries[1] ? entry.entries[1].amount : '');
            }

            const delBtn = e.target.closest('.j-del-btn');
            if (delBtn) {
                const id = delBtn.getAttribute('data-id');
                if (!confirm('Delete this entry?')) return;
                appData.journal = appData.journal.filter(j => String(j.id) !== String(id));
                notifyDataChanged();
                initJournal();
            }
        });
    }

    const exportBtn = document.getElementById('export-journal-btn');
    if (exportBtn) {
        exportBtn.onclick = exportJournalCSV;
    }
}

function renderJournalTable(filterDate = 'all') {
    const tbody = document.querySelector('#journal-table tbody');
    if (!tbody) return;

    const filtered = filterDate === 'all'
        ? [...appData.journal]
        : appData.journal.filter(j => j.date === filterDate);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);">No journal entries found for selected period.</td></tr>';
        return;
    }

    filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    tbody.innerHTML = filtered.map(j => {
        let accHTML = '';
        let drTotal = 0;
        let crTotal = 0;

        if (j.entries && j.entries.length > 0) {
            accHTML = j.entries.map(e => {
                if (e.type === 'Dr') {
                    drTotal += parseFloat(e.amount) || 0;
                    return `<div style="color:var(--success);font-weight:600;">Dr: ${e.account} (${fmt(e.amount)})</div>`;
                } else {
                    crTotal += parseFloat(e.amount) || 0;
                    const isComm = e.account.toLowerCase().includes('commission');
                    return `<div style="padding-left:1.25rem;color:${isComm ? 'var(--success)' : 'var(--accent)'};font-size:0.85rem;">To ${e.account} (${fmt(e.amount)})</div>`;
                }
            }).join('');
        } else {
            drTotal = parseFloat(j.debitAmt) || 0;
            crTotal = parseFloat(j.creditAmt) || 0;
            accHTML = `<div style="color:var(--success);font-weight:600;">Dr: ${j.debitAcc}</div><div style="padding-left:1.25rem;color:var(--accent);font-size:0.85rem;">To ${j.creditAcc}</div>`;
        }

        return `
            <tr>
                <td><strong>${j.date || ''}</strong></td>
                <td>${accHTML}</td>
                <td>${j.desc || ''}</td>
                <td><strong>${fmt(drTotal)}</strong></td>
                <td><strong>${fmt(crTotal)}</strong></td>
                <td style="display:flex;gap:0.5rem;">
                    <button class="btn btn-sm btn-secondary j-edit-btn" data-id="${j.id}">Edit</button>
                    <button class="btn btn-sm btn-secondary j-del-btn" data-id="${j.id}" style="color:var(--danger);">Del</button>
                </td>
            </tr>
        `;
    }).join('');
}

function exportJournalCSV() {
    if (appData.journal.length === 0) { alert('No entries to export.'); return; }
    const header = 'Date,Description,Debit Account,Debit Amount,Credit Account,Credit Amount\n';
    const rows = appData.journal.map(j => {
        let dAcc = j.debitAcc || '';
        let dAmt = j.debitAmt || '';
        let cAcc = j.creditAcc || '';
        let cAmt = j.creditAmt || '';
        if (j.entries && j.entries.length > 0) {
            const drs = j.entries.filter(e => e.type === 'Dr');
            const crs = j.entries.filter(e => e.type === 'Cr');
            dAcc = drs.map(e => e.account + ' (' + e.amount + ')').join(' | ');
            cAcc = crs.map(e => e.account + ' (' + e.amount + ')').join(' | ');
            dAmt = drs.reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
            cAmt = crs.reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
        }
        return [j.date, `"${j.desc}"`, `"${dAcc}"`, dAmt, `"${cAcc}"`, cAmt].join(',');
    }).join('\n');

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

    const accounts = new Set();
    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => { if (e.account) accounts.add(e.account); });
        } else {
            if (j.debitAcc) accounts.add(j.debitAcc);
            if (j.creditAcc) accounts.add(j.creditAcc);
        }
    });

    select.innerHTML = '<option value="">Select Account...</option>';
    [...accounts].sort().forEach(acc => {
        const type = classifyAccount(acc);
        const opt = document.createElement('option');
        opt.value = acc;
        opt.textContent = `${acc} (${type.toUpperCase()})`;
        select.appendChild(opt);
    });

    select.onchange = () => renderLedger(select.value);
}

function renderLedger(account) {
    const tbody = document.querySelector('#ledger-table tbody');
    if (!tbody) return;

    if (!account) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">Select an account to view its ledger.</td></tr>';
        return;
    }

    const matchedEntries = [];
    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            const hasAcc = j.entries.some(e => e.account === account);
            if (hasAcc) matchedEntries.push(j);
        } else {
            if (j.debitAcc === account || j.creditAcc === account) matchedEntries.push(j);
        }
    });

    matchedEntries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (matchedEntries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">No transactions for this account.</td></tr>';
        return;
    }

    let balance = 0;
    tbody.innerHTML = matchedEntries.map(j => {
        let debit = 0, credit = 0, particulars = '';

        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                if (e.account === account) {
                    if (e.type === 'Dr') debit += parseFloat(e.amount) || 0;
                    if (e.type === 'Cr') credit += parseFloat(e.amount) || 0;
                }
            });
            const counterAccs = j.entries.filter(e => e.account !== account).map(e => `${e.type === 'Dr' ? 'By' : 'To'} ${e.account}`).join(', ');
            particulars = counterAccs;
        } else {
            if (j.debitAcc === account) {
                debit = parseFloat(j.debitAmt) || 0;
                particulars = `By ${j.creditAcc}`;
            }
            if (j.creditAcc === account) {
                credit = parseFloat(j.creditAmt) || 0;
                particulars = `To ${j.debitAcc}`;
            }
        }

        balance += debit - credit;
        const balStr = (balance >= 0 ? '' : '-') + '₹ ' + Math.abs(balance).toFixed(2) + (balance >= 0 ? ' Dr' : ' Cr');
        return `
            <tr>
                <td>${j.date || ''}</td>
                <td>${j.desc || ''}<br><small style="color:var(--text-secondary);">${particulars}</small></td>
                <td>${debit ? fmt(debit) : '—'}</td>
                <td>${credit ? fmt(credit) : '—'}</td>
                <td><strong>${balStr}</strong></td>
            </tr>
        `;
    }).join('');
}

// =============================================
// TRIAL BALANCE
// =============================================
function initTrialBalance() {
    const accounts = {};

    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                const acc = e.account;
                const amt = parseFloat(e.amount) || 0;
                if (!accounts[acc]) accounts[acc] = { debit: 0, credit: 0 };
                if (e.type === 'Dr') accounts[acc].debit += amt;
                if (e.type === 'Cr') accounts[acc].credit += amt;
            });
        } else {
            if (j.debitAcc) {
                if (!accounts[j.debitAcc]) accounts[j.debitAcc] = { debit: 0, credit: 0 };
                accounts[j.debitAcc].debit += parseFloat(j.debitAmt) || 0;
            }
            if (j.creditAcc) {
                if (!accounts[j.creditAcc]) accounts[j.creditAcc] = { debit: 0, credit: 0 };
                accounts[j.creditAcc].credit += parseFloat(j.creditAmt) || 0;
            }
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
            const type = classifyAccount(acc);
            const netDebit = Math.max(0, debit - credit);
            const netCredit = Math.max(0, credit - debit);
            totalDebit += netDebit;
            totalCredit += netCredit;
            return `
                <tr>
                    <td>
                        <strong>${acc}</strong>
                        <span style="margin-left:0.5rem;font-size:0.75rem;padding:0.15rem 0.4rem;border-radius:4px;background:var(--bg-tertiary);color:var(--text-secondary);">${type.toUpperCase()}</span>
                    </td>
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
    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                const acc = (e.account || '').toLowerCase();
                if (acc.includes('cash') || acc.includes('bank')) {
                    if (e.type === 'Dr') cashEntries.push({ date: j.date, particulars: j.desc, receipts: parseFloat(e.amount) || 0, payments: 0 });
                    if (e.type === 'Cr') cashEntries.push({ date: j.date, particulars: j.desc, receipts: 0, payments: parseFloat(e.amount) || 0 });
                }
            });
        } else {
            const d = (j.debitAcc || '').toLowerCase();
            const c = (j.creditAcc || '').toLowerCase();
            if (d.includes('cash') || d.includes('bank')) {
                cashEntries.push({ date: j.date, particulars: j.desc + ` (from ${j.creditAcc})`, receipts: parseFloat(j.debitAmt) || 0, payments: 0 });
            }
            if (c.includes('cash') || c.includes('bank')) {
                cashEntries.push({ date: j.date, particulars: j.desc + ` (to ${j.debitAcc})`, receipts: 0, payments: parseFloat(j.creditAmt) || 0 });
            }
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
                <td><strong>${balStr}</strong></td>
            </tr>
        `;
    }).join('');
}

// =============================================
// FINANCIAL STATEMENTS (P&L + BALANCE SHEET)
// =============================================
function initFinancialStatements() {
    const filterSelect = document.getElementById('fs-date-filter');
    const dates = new Set();
    appData.pos.forEach(b => { if (b.date) dates.add(b.date); });
    appData.journal.forEach(j => { if (j.date) dates.add(j.date); });
    const sortedDates = [...dates].sort().reverse();

    if (filterSelect) {
        const cur = filterSelect.value || 'all';
        filterSelect.innerHTML = '<option value="all">All Dates (Cumulative)</option>';
        sortedDates.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            filterSelect.appendChild(opt);
        });
        filterSelect.value = cur;
        filterSelect.onchange = () => renderFinancialStatements(filterSelect.value);
    }

    renderFinancialStatements(filterSelect ? filterSelect.value : 'all');
}

function renderFinancialStatements(selectedDate = 'all') {
    const filteredBills = selectedDate === 'all' 
        ? appData.pos 
        : appData.pos.filter(b => b.date === selectedDate);

    const filteredJournal = selectedDate === 'all'
        ? appData.journal
        : appData.journal.filter(j => j.date === selectedDate);

    let grossSales = 0;
    let standardSales = 0;
    let standardCommission = 0;
    let customMarkup = 0;
    let salesCostTotal = 0;

    filteredBills.forEach(bill => {
        (bill.items || []).forEach(item => {
            const qty = parseInt(item.qty) || 1;
            const salePrice = parseFloat(item.salePrice) || 0;
            let costPrice = item.costPrice !== undefined ? parseFloat(item.costPrice) : null;
            if (costPrice === null || isNaN(costPrice)) {
                const inv = appData.inventory.find(i => i.id === item.id || i.name === item.name);
                costPrice = inv ? parseFloat(inv.price) || 0 : salePrice;
            }

            const subtotal = salePrice * qty;
            grossSales += subtotal;

            if (Math.abs(salePrice - costPrice) < 0.001) {
                const comm = subtotal * 0.20;
                standardSales += subtotal;
                standardCommission += comm;
                salesCostTotal += (subtotal - comm);
            } else {
                const markup = (salePrice - costPrice) * qty;
                customMarkup += markup;
                salesCostTotal += (costPrice * qty);
            }
        });
    });

    const netTradingIncome = standardCommission + customMarkup;

    const expenseRows = [];
    let totalExpenses = 0;
    const accTotals = {};

    filteredJournal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                const acc = e.account;
                const amt = parseFloat(e.amount) || 0;
                if (e.type === 'Dr') accTotals[acc] = (accTotals[acc] || 0) + amt;
                if (e.type === 'Cr') accTotals[acc] = (accTotals[acc] || 0) - amt;
            });
        } else {
            if (j.debitAcc) accTotals[j.debitAcc] = (accTotals[j.debitAcc] || 0) + (parseFloat(j.debitAmt) || 0);
            if (j.creditAcc) accTotals[j.creditAcc] = (accTotals[j.creditAcc] || 0) - (parseFloat(j.creditAmt) || 0);
        }
    });

    Object.entries(accTotals).forEach(([acc, netDr]) => {
        if (classifyAccount(acc) === 'expense' && netDr > 0) {
            totalExpenses += netDr;
            expenseRows.push({ label: acc, amount: netDr });
        }
    });

    const isTbody = document.querySelector('#is-table tbody');
    if (isTbody) {
        let html = `
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>Consignment Revenue & Commission Income</strong></td></tr>
            <tr><td style="padding-left:1.5rem;">Gross Cash Received (Cash A/c)</td><td style="text-align:right;">${fmt(grossSales)}</td></tr>
            <tr><td style="padding-left:1.5rem;color:var(--text-secondary);">Less: Cost Price / Price after 20% reduction (Sales A/c)</td><td style="text-align:right;color:var(--text-secondary);">- ${fmt(salesCostTotal)}</td></tr>
            <tr style="border-top:1px dashed var(--border);"><td style="padding-left:1.5rem;color:var(--success);">Standard 20% Commission (Unchanged Prices)</td><td style="text-align:right;color:var(--success);">${fmt(standardCommission)}</td></tr>
            <tr><td style="padding-left:1.5rem;color:var(--success);">Price Markup Margin (Custom Sold Price - Inventory Price)</td><td style="text-align:right;color:var(--success);">${fmt(customMarkup)}</td></tr>
            <tr style="border-top:1px solid var(--border);"><td><strong>Total Commission Earned (Commission A/c)</strong></td><td style="text-align:right;color:var(--success);"><strong>${fmt(netTradingIncome)}</strong></td></tr>
            
            <tr style="background:var(--bg-tertiary);"><td colspan="2"><strong>Operating Expenses</strong></td></tr>
        `;

        if (expenseRows.length === 0) {
            html += `<tr><td colspan="2" style="text-align:center;color:var(--text-secondary);">No operating expense entries for this period</td></tr>`;
        } else {
            expenseRows.forEach(r => {
                html += `<tr><td style="padding-left:1.5rem;">${r.label}</td><td style="text-align:right;color:var(--danger);">${fmt(r.amount)}</td></tr>`;
            });
        }
        html += `<tr style="border-top:1px solid var(--border);"><td><strong>Total Operating Expenses</strong></td><td style="text-align:right;color:var(--danger);"><strong>${fmt(totalExpenses)}</strong></td></tr>`;

        isTbody.innerHTML = html;
    }

    const netPL = netTradingIncome - totalExpenses;
    const isResult = document.getElementById('is-result');
    if (isResult) {
        isResult.style.background = netPL >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
        isResult.style.color = netPL >= 0 ? 'var(--success)' : 'var(--danger)';
        isResult.textContent = `Net ${netPL >= 0 ? 'Profit' : 'Loss'}: ${fmt(Math.abs(netPL))}`;
    }

    renderBalanceSheet(netPL);
}

function renderBalanceSheet(netPL = 0) {
    const accounts = {};
    appData.journal.forEach(j => {
        if (j.entries && j.entries.length > 0) {
            j.entries.forEach(e => {
                const acc = e.account;
                const amt = parseFloat(e.amount) || 0;
                if (!accounts[acc]) accounts[acc] = { debit: 0, credit: 0 };
                if (e.type === 'Dr') accounts[acc].debit += amt;
                if (e.type === 'Cr') accounts[acc].credit += amt;
            });
        } else {
            if (j.debitAcc) {
                if (!accounts[j.debitAcc]) accounts[j.debitAcc] = { debit: 0, credit: 0 };
                accounts[j.debitAcc].debit += parseFloat(j.debitAmt) || 0;
            }
            if (j.creditAcc) {
                if (!accounts[j.creditAcc]) accounts[j.creditAcc] = { debit: 0, credit: 0 };
                accounts[j.creditAcc].credit += parseFloat(j.creditAmt) || 0;
            }
        }
    });

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

        if (type === 'equity') {
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
        }
    });

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
            bsHtml += `<tr><td style="padding-left:1.5rem;">Retained Earnings (Net Profit)</td><td style="text-align:right;">${fmt(netPL)}</td></tr>`;
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
        bsResult.style.background = isBalanced ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
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
        appData = mergeAppData(data);
        ensureIds();
        saveLocal();
        updateSyncStatus('Synced from GitHub', 'ok');
        refreshDashboardStats();
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
