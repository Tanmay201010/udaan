// Core State
let appState = {
    bills: [],
    journal: [],
    inventory: [] // Added for Sales Team
};

// Local settings & auth
let settings = JSON.parse(localStorage.getItem('accopro_settings') || '{"pat":"","owner":"","repo":"","path":"data.json"}');
let currentRole = null; // Removed localStorage persistence so it asks for login on every refresh
let currentSha = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    
    // Auth Check
    if (!currentRole) {
        document.getElementById('login-overlay').style.display = 'flex';
        initLogin();
    } else {
        startApp();
    }
});

function initLogin() {
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');
    btn.addEventListener('click', () => {
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();
        
        if (user === 'admin' && pass === 'sales') {
            currentRole = 'sales';
            finishLogin();
        } else if (user === 'admin' && pass === 'finance') {
            currentRole = 'finance';
            finishLogin();
        } else {
            err.style.display = 'block';
        }
    });
}

function finishLogin() {
    // No longer saving to localStorage
    document.getElementById('login-overlay').style.display = 'none';
    startApp();
}

function startApp() {
    document.getElementById('app').style.display = 'flex';
    document.getElementById('logged-in-role').innerText = currentRole.toUpperCase();
    
    // Setup Sidebar based on role
    document.querySelectorAll('.nav-links li').forEach(li => {
        const role = li.getAttribute('data-role');
        if (role === 'all' || role === currentRole) {
            li.style.display = 'block';
        } else {
            li.style.display = 'none';
        }
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('accopro_role');
        window.location.reload();
    });

    initRouter();
    
    if (settings.pat && settings.owner && settings.repo) {
        fetchData();
    } else {
        updateSyncStatus('Not configured', 'error');
        window.location.hash = '#settings';
    }

    document.getElementById('force-sync-btn').addEventListener('click', () => {
        if (settings.pat) fetchData();
    });

    // Mobile Sidebar Toggle
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const menuBtn = document.getElementById('mobile-menu-btn');

    menuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        overlay.classList.add('open');
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
    });

    // Close sidebar on navigation click
    document.querySelectorAll('.nav-links a').forEach(a => {
        a.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        });
    });
}

// --- GitHub Sync Logic ---
async function fetchData() {
    updateSyncStatus('Syncing...', 'syncing');
    try {
        const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path}`;
        const res = await fetch(url, {
            headers: { 'Authorization': `token ${settings.pat}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        
        if (res.status === 404) {
            updateSyncStatus('New Repository (No data yet)', 'synced');
            return;
        }

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to fetch data');
        }

        const data = await res.json();
        currentSha = data.sha;
        
        const content = decodeURIComponent(escape(atob(data.content)));
        const loadedState = JSON.parse(content);
        // Merge state to handle missing arrays (e.g. inventory)
        appState = { ...appState, ...loadedState };
        if(!appState.inventory) appState.inventory = [];
        
        updateSyncStatus('Synced', 'synced');
        refreshCurrentView();
    } catch (e) {
        console.error("Fetch Data Error:", e);
        updateSyncStatus('Sync Error', 'error');
        alert(`GitHub Fetch Error: ${e.message}\n\nPlease check your configuration in the Settings tab.`);
    }
}

async function saveData() {
    if (!settings.pat) return;
    updateSyncStatus('Saving...', 'syncing');
    try {
        const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path}`;
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(appState, null, 2))));
        
        const body = { message: `Update accounting data`, content: content };
        if (currentSha) body.sha = currentSha;

        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${settings.pat}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to save data');
        }
        const data = await res.json();
        currentSha = data.content.sha;
        updateSyncStatus('Synced', 'synced');
        refreshCurrentView();
    } catch (e) {
        console.error("Save Data Error:", e);
        updateSyncStatus('Save Error', 'error');
        alert(`GitHub Sync Error: ${e.message}\n\nPlease check your Settings:\n1. Your PAT is valid and has 'repo' or 'contents: write' permissions.\n2. The Repository Owner and Name are correct.\n3. The repository is not completely empty (it must have at least one branch/commit, e.g. initialize it with a README).`);
    }
}

function updateSyncStatus(text, state) {
    const textEl = document.getElementById('sync-status-text');
    if(textEl) textEl.innerText = text;
    const indicator = document.querySelector('.status-indicator');
    if(indicator) {
        indicator.className = 'status-indicator';
        if (state === 'synced') indicator.classList.add('synced');
        if (state === 'syncing') indicator.classList.add('syncing');
    }
}

// --- Router Logic ---
function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute(); 
}

function handleRoute() {
    const hash = window.location.hash || '#dashboard';
    const target = hash.substring(1);
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-item[data-target="${target}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
        document.getElementById('page-title').innerText = activeLink.innerText;
    }
    
    const container = document.getElementById('view-container');
    const tpl = document.getElementById(`tpl-${target}`);
    
    if (tpl) {
        container.innerHTML = '';
        container.appendChild(tpl.content.cloneNode(true));
        
        if (target === 'settings') initSettingsView();
        if (target === 'dashboard') renderDashboard();
        if (target === 'inventory') initInventory();
        if (target === 'pos') initPOS();
        if (target === 'journal') initJournal();
        if (target === 'ledger') renderLedger();
        if (target === 'trial-balance') renderTrialBalance();
        if (target === 'cash-book') renderCashBook();
        if (target === 'financial-statements') renderFinancialStatements();
        
        lucide.createIcons();
    }
}

function refreshCurrentView() {
    handleRoute(); 
}

// --- View: Settings ---
function initSettingsView() {
    const patInput = document.getElementById('gh-pat');
    if (!patInput) return;
    
    patInput.value = settings.pat;
    document.getElementById('gh-owner').value = settings.owner;
    document.getElementById('gh-repo').value = settings.repo;
    document.getElementById('gh-path').value = settings.path;

    document.getElementById('save-settings-btn').addEventListener('click', () => {
        settings = {
            pat: document.getElementById('gh-pat').value,
            owner: document.getElementById('gh-owner').value,
            repo: document.getElementById('gh-repo').value,
            path: document.getElementById('gh-path').value || 'data.json'
        };
        localStorage.setItem('accopro_settings', JSON.stringify(settings));
        
        const msg = document.getElementById('settings-msg');
        msg.innerHTML = '<span style="color:var(--success);">Settings saved! Testing connection...</span>';
        
        fetchData().then(() => {
            msg.innerHTML = '<span style="color:var(--success);">Connected successfully!</span>';
        });
    });
}

// --- View: Inventory ---
function initInventory() {
    renderInventoryTable();
    
    document.getElementById('new-item-btn').addEventListener('click', () => {
        document.getElementById('inventory-modal').style.display = 'block';
    });
    
    document.getElementById('inv-cancel-btn').addEventListener('click', () => {
        document.getElementById('inventory-modal').style.display = 'none';
    });
    
    document.getElementById('inv-save-btn').addEventListener('click', () => {
        const name = document.getElementById('inv-name').value.trim();
        const price = Number(document.getElementById('inv-price').value);
        if (!name || !price) { alert("Fill all fields"); return; }
        
        appState.inventory.push({ id: Date.now().toString(), name, price });
        document.getElementById('inventory-modal').style.display = 'none';
        document.getElementById('inv-name').value = '';
        document.getElementById('inv-price').value = '';
        renderInventoryTable();
        saveData();
    });
}

function renderInventoryTable() {
    const tbody = document.querySelector('#inventory-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    appState.inventory.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td>${item.id}</td>
                <td><strong>${item.name}</strong></td>
                <td>₹ ${item.price.toFixed(2)}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="deleteInventoryItem('${item.id}')"><i data-lucide="trash"></i></button></td>
            </tr>
        `;
    });
    lucide.createIcons();
}

window.deleteInventoryItem = function(id) {
    if(confirm('Delete product?')) {
        appState.inventory = appState.inventory.filter(i => i.id !== id);
        renderInventoryTable();
        saveData();
    }
}

// --- View: POS / Billing Counter ---
let posItems = [];
function initPOS() {
    posItems = [];
    
    // Populate dropdown
    const select = document.getElementById('pos-product-select');
    appState.inventory.forEach(item => {
        select.innerHTML += `<option value="${item.id}">${item.name} - ₹${item.price}</option>`;
    });

    // Date default
    document.getElementById('pos-date').value = new Date().toISOString().split('T')[0];

    // Listeners for preview
    ['pos-date', 'pos-no', 'pos-customer', 'pos-note'].forEach(id => {
        document.getElementById(id).addEventListener('input', updatePOSPreview);
        document.getElementById(id).addEventListener('change', updatePOSPreview);
    });

    document.getElementById('pos-add-item-btn').addEventListener('click', () => {
        const selId = select.value;
        if (!selId) return;
        const invItem = appState.inventory.find(i => i.id === selId);
        
        posItems.push({ id: Date.now(), desc: invItem.name, qty: 1, price: invItem.price });
        renderPOSItems();
        updatePOSPreview();
    });

    function saveBillData() {
        if(posItems.length === 0) { alert('Add items to bill'); return false; }
        const billDate = document.getElementById('pos-date').value;
        const total = posItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
        const invNo = document.getElementById('pos-no').value;
        
        appState.bills.push({
            date: billDate,
            invoiceNo: invNo,
            customer: document.getElementById('pos-customer').value,
            items: [...posItems],
            total: total
        });
        
        // Auto Journal (POS Sale)
        appState.journal.push({
            id: Date.now(),
            date: billDate,
            desc: `POS Sale ${invNo}`,
            debitAcc: 'Accounts Receivable',
            debitAmt: total,
            creditAcc: 'Sales',
            creditAmt: total
        });
        
        saveData();
        return true;
    }

    function resetPOS() {
        posItems = [];
        document.getElementById('pos-customer').value = '';
        
        // Increment invoice number slightly intelligently
        let currentInv = document.getElementById('pos-no').value;
        let numMatch = currentInv.match(/\d+$/);
        if (numMatch) {
            let nextNum = parseInt(numMatch[0]) + 1;
            let nextNumStr = nextNum.toString().padStart(numMatch[0].length, '0');
            document.getElementById('pos-no').value = currentInv.replace(/\d+$/, nextNumStr);
        }
        
        renderPOSItems();
        updatePOSPreview();
    }

    document.getElementById('generate-bill-btn').addEventListener('click', () => {
        if(saveBillData()) {
            window.print();
            resetPOS();
        }
    });

    const historyBtn = document.getElementById('save-history-btn');
    if (historyBtn) {
        historyBtn.addEventListener('click', () => {
            if(saveBillData()) {
                alert('Bill saved to history and journal recorded!');
                resetPOS();
            }
        });
    }

    updatePOSPreview();
}

function renderPOSItems() {
    const container = document.getElementById('pos-items-container');
    container.innerHTML = '';
    posItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.style.display = 'flex'; div.style.gap = '0.5rem'; div.style.marginBottom = '0.5rem';
        div.innerHTML = `
            <input type="text" value="${item.desc}" disabled style="flex: 2; padding: 0.5rem; background: var(--bg-tertiary);">
            <input type="number" value="${item.qty}" min="1" onchange="updatePOSItem(${index}, 'qty', this.value)" style="flex: 1; padding: 0.5rem;">
            <input type="number" value="${item.price}" onchange="updatePOSItem(${index}, 'price', this.value)" style="flex: 1; padding: 0.5rem;" title="Override Price">
            <button class="btn btn-secondary btn-sm" onclick="removePOSItem(${index})"><i data-lucide="trash"></i></button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

window.updatePOSItem = function(index, field, value) {
    posItems[index][field] = Number(value);
    updatePOSPreview();
}

window.removePOSItem = function(index) {
    posItems.splice(index, 1);
    renderPOSItems();
    updatePOSPreview();
}

function updatePOSPreview() {
    const date = document.getElementById('pos-date')?.value || new Date().toISOString().split('T')[0];
    const invoiceNo = document.getElementById('pos-no')?.value || '#000001';
    
    document.getElementById('prev-date').innerText = date;
    document.getElementById('prev-invoice-no').innerText = invoiceNo;
    document.getElementById('prev-customer').innerText = document.getElementById('pos-customer')?.value || '';
    document.getElementById('prev-note').innerText = document.getElementById('pos-note')?.value || '';

    const tbody = document.querySelector('#prev-items-table tbody');
    if(tbody) {
        tbody.innerHTML = '';
        let grandTotal = 0;
        posItems.forEach((item, idx) => {
            const subtotal = item.qty * item.price;
            grandTotal += subtotal;
            tbody.innerHTML += `
                <tr>
                    <td style="padding: 1rem;">${idx + 1}</td>
                    <td style="padding: 1rem;">${item.desc}</td>
                    <td style="padding: 1rem; text-align: right;">${item.qty}</td>
                    <td style="padding: 1rem; text-align: right;">₹ ${item.price.toFixed(2)}</td>
                    <td style="padding: 1rem; text-align: right;">₹ ${subtotal.toFixed(2)}</td>
                </tr>
            `;
        });
        document.getElementById('prev-grand-total').innerText = `₹ ${grandTotal.toFixed(2)}`;
    }
}

// --- View: Dashboard ---
function renderDashboard() {
    let totalCash = 0;
    let totalExpenses = 0;
    
    appState.journal.forEach(entry => {
        if (entry.debitAcc.toLowerCase() === 'cash') totalCash += entry.debitAmt;
        if (entry.creditAcc.toLowerCase() === 'cash') totalCash -= entry.creditAmt;
        if (entry.debitAcc.toLowerCase().includes('expense') || entry.debitAcc.toLowerCase().includes('purchases')) {
            totalExpenses += entry.debitAmt;
        }
    });

    const elCash = document.getElementById('dash-cash-balance');
    if(elCash) elCash.innerText = `₹ ${totalCash.toFixed(2)}`;
    
    const elBills = document.getElementById('dash-bills-count');
    if(elBills) elBills.innerText = appState.bills.length;
    
    const elExp = document.getElementById('dash-expenses');
    if(elExp) elExp.innerText = `₹ ${totalExpenses.toFixed(2)}`;
    
    const elJourn = document.getElementById('dash-journal-count');
    if(elJourn) elJourn.innerText = appState.journal.length;

    const tbody = document.querySelector('#dash-recent-table tbody');
    if(tbody) {
        tbody.innerHTML = '';
        const recent = [...appState.journal].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        recent.forEach(entry => {
            tbody.innerHTML += `
                <tr>
                    <td>${entry.date}</td>
                    <td>${entry.desc}</td>
                    <td>${entry.debitAcc} / ${entry.creditAcc}</td>
                    <td>₹ ${entry.debitAmt.toFixed(2)}</td>
                </tr>
            `;
        });
    }
}

// --- View: Journal ---
function initJournal() {
    document.addEventListener('click', e => {
        if (e.target.closest('#new-journal-btn')) {
            document.getElementById('journal-modal').style.display = 'block';
            document.getElementById('j-date').value = new Date().toISOString().split('T')[0];
        }
        if (e.target.closest('#j-cancel-btn')) {
            document.getElementById('journal-modal').style.display = 'none';
        }
        if (e.target.closest('#j-save-btn')) {
            saveJournalEntry();
        }
    });
    renderJournalTable();
}

function renderJournalTable() {
    const tbody = document.querySelector('#journal-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const sorted = [...appState.journal].sort((a,b) => new Date(a.date) - new Date(b.date));
    
    sorted.forEach(entry => {
        tbody.innerHTML += `
            <tr>
                <td rowspan="2">${entry.date}</td>
                <td><strong>${entry.debitAcc}</strong></td>
                <td>${entry.desc}</td>
                <td>₹ ${entry.debitAmt.toFixed(2)}</td>
                <td></td>
            </tr>
            <tr>
                <td style="padding-left: 2rem;"><em>To ${entry.creditAcc}</em></td>
                <td></td>
                <td></td>
                <td>₹ ${entry.creditAmt.toFixed(2)}</td>
            </tr>
        `;
    });
}

function saveJournalEntry() {
    const date = document.getElementById('j-date').value;
    const desc = document.getElementById('j-desc').value;
    const debitAcc = document.getElementById('j-debit-acc').value.trim();
    const debitAmt = Number(document.getElementById('j-debit-amt').value);
    const creditAcc = document.getElementById('j-credit-acc').value.trim();
    const creditAmt = Number(document.getElementById('j-credit-amt').value);

    if (!date || !debitAcc || !creditAcc || !debitAmt || !creditAmt) {
        alert("Please fill all fields"); return;
    }
    if (debitAmt !== creditAmt) {
        alert("Debit and Credit amounts must be equal."); return;
    }

    appState.journal.push({ id: Date.now(), date, desc, debitAcc, debitAmt, creditAcc, creditAmt });
    document.getElementById('journal-modal').style.display = 'none';
    renderJournalTable();
    saveData();
}

function getUniqueAccounts() {
    const accounts = new Set();
    appState.journal.forEach(e => { accounts.add(e.debitAcc); accounts.add(e.creditAcc); });
    return Array.from(accounts).sort();
}

// --- View: Ledger ---
function renderLedger() {
    const select = document.getElementById('ledger-acc-select');
    if(!select) return;
    
    const accounts = getUniqueAccounts();
    const currentVal = select.value;
    
    select.innerHTML = '<option value="">Select Account...</option>';
    accounts.forEach(acc => { select.innerHTML += `<option value="${acc}">${acc}</option>`; });
    if (accounts.includes(currentVal)) select.value = currentVal;

    select.addEventListener('change', () => renderLedgerTable(select.value));
    if(select.value) renderLedgerTable(select.value);
}

function renderLedgerTable(accountName) {
    const tbody = document.querySelector('#ledger-table tbody');
    if(!tbody || !accountName) return;
    tbody.innerHTML = '';
    
    let balance = 0;
    const sorted = [...appState.journal].sort((a,b) => new Date(a.date) - new Date(b.date));
    
    sorted.forEach(entry => {
        if (entry.debitAcc === accountName) {
            balance += entry.debitAmt;
            tbody.innerHTML += `
                <tr>
                    <td>${entry.date}</td>
                    <td>To ${entry.creditAcc} <small>(${entry.desc})</small></td>
                    <td>₹ ${entry.debitAmt.toFixed(2)}</td>
                    <td></td>
                    <td>₹ ${balance.toFixed(2)} (Dr)</td>
                </tr>
            `;
        }
        if (entry.creditAcc === accountName) {
            balance -= entry.creditAmt;
            const balStr = balance >= 0 ? `₹ ${Math.abs(balance).toFixed(2)} (Dr)` : `₹ ${Math.abs(balance).toFixed(2)} (Cr)`;
            tbody.innerHTML += `
                <tr>
                    <td>${entry.date}</td>
                    <td>By ${entry.debitAcc} <small>(${entry.desc})</small></td>
                    <td></td>
                    <td>₹ ${entry.creditAmt.toFixed(2)}</td>
                    <td>${balStr}</td>
                </tr>
            `;
        }
    });
}

// --- View: Trial Balance & Cash Book & Statements ---
function renderTrialBalance() {
    const tbody = document.querySelector('#tb-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const balances = {};
    appState.journal.forEach(e => {
        balances[e.debitAcc] = (balances[e.debitAcc] || 0) + e.debitAmt;
        balances[e.creditAcc] = (balances[e.creditAcc] || 0) - e.creditAmt;
    });

    let totalDr = 0, totalCr = 0;
    Object.keys(balances).sort().forEach(acc => {
        const bal = balances[acc];
        if (Math.abs(bal) > 0.001) {
            if (bal > 0) {
                totalDr += bal;
                tbody.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">₹ ${bal.toFixed(2)}</td><td></td></tr>`;
            } else {
                totalCr += Math.abs(bal);
                tbody.innerHTML += `<tr><td>${acc}</td><td></td><td style="text-align:right;">₹ ${Math.abs(bal).toFixed(2)}</td></tr>`;
            }
        }
    });
    document.getElementById('tb-total-debit').innerText = `₹ ${totalDr.toFixed(2)}`;
    document.getElementById('tb-total-credit').innerText = `₹ ${totalCr.toFixed(2)}`;
}

function renderCashBook() {
    const tbody = document.querySelector('#cash-book-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    let balance = 0;
    [...appState.journal].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(entry => {
        let isCash = false, receipt = 0, payment = 0, particular = '';
        if (entry.debitAcc.toLowerCase() === 'cash') {
            isCash = true; receipt = entry.debitAmt; particular = `To ${entry.creditAcc}`; balance += receipt;
        } else if (entry.creditAcc.toLowerCase() === 'cash') {
            isCash = true; payment = entry.creditAmt; particular = `By ${entry.debitAcc}`; balance -= payment;
        }
        if (isCash) {
            tbody.innerHTML += `
                <tr>
                    <td>${entry.date}</td>
                    <td>${particular}</td>
                    <td>${receipt ? '₹ '+receipt.toFixed(2) : ''}</td>
                    <td>${payment ? '₹ '+payment.toFixed(2) : ''}</td>
                    <td>₹ ${balance.toFixed(2)}</td>
                </tr>
            `;
        }
    });
}

function renderFinancialStatements() {
    const balances = {};
    appState.journal.forEach(e => {
        balances[e.debitAcc] = (balances[e.debitAcc] || 0) + e.debitAmt;
        balances[e.creditAcc] = (balances[e.creditAcc] || 0) - e.creditAmt;
    });

    let totalIncome = 0, totalExpense = 0, totalAssets = 0, totalLiabEq = 0;
    const isTable = document.querySelector('#is-table tbody');
    const bsTable = document.querySelector('#bs-table tbody');
    if(!isTable || !bsTable) return;
    
    isTable.innerHTML = `<tr><th colspan="2">Revenues</th></tr>`;
    bsTable.innerHTML = `<tr><th colspan="2">Assets</th></tr>`;

    Object.keys(balances).forEach(acc => {
        const lower = acc.toLowerCase();
        const val = balances[acc];
        
        if (lower.includes('sales') || lower.includes('revenue') || lower.includes('income')) {
            totalIncome += Math.abs(val);
            isTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">₹ ${Math.abs(val).toFixed(2)}</td></tr>`;
        } else if (lower.includes('expense') || lower.includes('purchases') || lower.includes('rent') || lower.includes('salary')) {
            totalExpense += val;
            isTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">₹ ${val.toFixed(2)}</td></tr>`;
        } else if (lower.includes('cash') || lower.includes('bank') || lower.includes('receivable') || lower.includes('equipment')) {
            totalAssets += val;
            bsTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">₹ ${val.toFixed(2)}</td></tr>`;
        } else if (lower.includes('payable') || lower.includes('loan') || lower.includes('capital') || lower.includes('equity')) {
            totalLiabEq += Math.abs(val);
            bsTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">₹ ${Math.abs(val).toFixed(2)}</td></tr>`;
        }
    });

    const netIncome = totalIncome - totalExpense;
    const isRes = document.getElementById('is-result');
    isRes.innerText = netIncome >= 0 ? `Net Profit: ₹ ${netIncome.toFixed(2)}` : `Net Loss: ₹ ${Math.abs(netIncome).toFixed(2)}`;
    isRes.style.color = netIncome >= 0 ? 'var(--success)' : 'var(--danger)';

    bsTable.innerHTML += `<tr><th colspan="2">Liabilities & Equity</th></tr>`;
    Object.keys(balances).forEach(acc => {
        const lower = acc.toLowerCase();
        const val = balances[acc];
        if (lower.includes('payable') || lower.includes('loan') || lower.includes('capital') || lower.includes('equity')) {
            bsTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">₹ ${Math.abs(val).toFixed(2)}</td></tr>`;
        }
    });
    
    totalLiabEq += netIncome;
    bsTable.innerHTML += `<tr><td>Retained Earnings (Net Income)</td><td style="text-align:right;">₹ ${netIncome.toFixed(2)}</td></tr>`;

    document.getElementById('bs-result').innerHTML = `
        <div style="display:flex; justify-content: space-between; padding: 0 1rem;">
            <span>Total Assets: ₹ ${totalAssets.toFixed(2)}</span>
            <span>Total Liab & Equity: ₹ ${totalLiabEq.toFixed(2)}</span>
        </div>
    `;
}
