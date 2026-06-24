// Core State
let appState = {
    bills: [],
    journal: []
};

// Local settings
let settings = JSON.parse(localStorage.getItem('accopro_settings') || '{"pat":"","owner":"","repo":"","path":"data.json"}');
let currentSha = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initRouter();
    initSettingsView();
    initBillBook();
    initJournal();
    
    if (settings.pat && settings.owner && settings.repo) {
        fetchData();
    } else {
        updateSyncStatus('Not configured', 'error');
        window.location.hash = '#settings';
    }

    document.getElementById('force-sync-btn').addEventListener('click', () => {
        if (settings.pat) fetchData();
    });
});

// --- GitHub Sync Logic ---
async function fetchData() {
    updateSyncStatus('Syncing...', 'syncing');
    try {
        const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path}`;
        const res = await fetch(url, {
            headers: { 'Authorization': `token ${settings.pat}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        
        if (res.status === 404) {
            // File doesn't exist, we will create it on first save
            updateSyncStatus('New Repository (No data yet)', 'synced');
            return;
        }

        if (!res.ok) throw new Error('Failed to fetch data');

        const data = await res.json();
        currentSha = data.sha;
        
        // Decode base64
        const content = decodeURIComponent(escape(atob(data.content)));
        appState = JSON.parse(content);
        
        updateSyncStatus('Synced', 'synced');
        refreshCurrentView();
    } catch (e) {
        console.error(e);
        updateSyncStatus('Sync Error', 'error');
    }
}

async function saveData() {
    if (!settings.pat) return;
    updateSyncStatus('Saving...', 'syncing');
    try {
        const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path}`;
        
        // Encode state to base64 safely
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(appState, null, 2))));
        
        const body = {
            message: `Update accounting data - ${new Date().toISOString()}`,
            content: content
        };
        if (currentSha) body.sha = currentSha;

        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${settings.pat}`, 'Accept': 'application/vnd.github.v3+json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) throw new Error('Failed to save data');
        
        const data = await res.json();
        currentSha = data.content.sha;
        updateSyncStatus('Synced', 'synced');
        refreshCurrentView();
    } catch (e) {
        console.error(e);
        updateSyncStatus('Save Error', 'error');
        alert("Failed to save to GitHub. Check settings or internet.");
    }
}

function updateSyncStatus(text, state) {
    document.getElementById('sync-status-text').innerText = text;
    const indicator = document.querySelector('.status-indicator');
    indicator.className = 'status-indicator';
    if (state === 'synced') indicator.classList.add('synced');
    if (state === 'syncing') indicator.classList.add('syncing');
}

// --- Router Logic ---
function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute(); // Load initial route
}

function handleRoute() {
    const hash = window.location.hash || '#dashboard';
    const target = hash.substring(1);
    
    // Update nav links
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-item[data-target="${target}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    // Update title
    document.getElementById('page-title').innerText = activeLink ? activeLink.innerText : 'AccoPro';
    
    // Render view
    const container = document.getElementById('view-container');
    const tpl = document.getElementById(`tpl-${target}`);
    
    if (tpl) {
        container.innerHTML = '';
        container.appendChild(tpl.content.cloneNode(true));
        
        // Initialize view specific logic
        if (target === 'settings') initSettingsView();
        if (target === 'dashboard') renderDashboard();
        if (target === 'bill-book') setupBillBookLogic();
        if (target === 'journal') renderJournal();
        if (target === 'ledger') renderLedger();
        if (target === 'trial-balance') renderTrialBalance();
        if (target === 'cash-book') renderCashBook();
        if (target === 'financial-statements') renderFinancialStatements();
        
        lucide.createIcons();
    } else {
        container.innerHTML = '<div class="card"><h2>404 - View Not Found</h2></div>';
    }
}

function refreshCurrentView() {
    handleRoute(); // Re-render current route
}

// --- View: Settings ---
function initSettingsView() {
    const patInput = document.getElementById('gh-pat');
    if (!patInput) return; // Not in DOM
    
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

// --- View: Bill Book ---
let billItems = [];
function initBillBook() {
    // Basic setup done on DOM load, event delegation or re-binding in setupBillBookLogic
}

function setupBillBookLogic() {
    billItems = [{ desc: '', qty: 1, price: 0 }];
    renderBillItemsForm();
    updateBillPreview();

    document.getElementById('bill-date').addEventListener('change', updateBillPreview);
    document.getElementById('bill-no').addEventListener('input', updateBillPreview);
    document.getElementById('bill-customer').addEventListener('input', updateBillPreview);
    document.getElementById('bill-note').addEventListener('input', updateBillPreview);
    
    document.getElementById('add-bill-item-btn').addEventListener('click', () => {
        billItems.push({ desc: '', qty: 1, price: 0 });
        renderBillItemsForm();
        updateBillPreview();
    });

    document.getElementById('generate-bill-btn').addEventListener('click', () => {
        const bill = {
            id: Date.now(),
            date: document.getElementById('bill-date').value,
            invoiceNo: document.getElementById('bill-no').value,
            customer: document.getElementById('bill-customer').value,
            items: [...billItems],
            note: document.getElementById('bill-note').value,
            total: billItems.reduce((sum, item) => sum + (item.qty * item.price), 0)
        };
        appState.bills.push(bill);
        
        // Create an automatic journal entry for this sale
        appState.journal.push({
            id: Date.now(),
            date: bill.date,
            desc: `Sales Invoice ${bill.invoiceNo} - ${bill.customer}`,
            debitAcc: 'Accounts Receivable',
            debitAmt: bill.total,
            creditAcc: 'Sales',
            creditAmt: bill.total
        });

        saveData();
        alert('Bill generated and saved. Journal entry created.');
    });

    document.getElementById('print-bill-btn').addEventListener('click', () => {
        window.print();
    });
}

function renderBillItemsForm() {
    const container = document.getElementById('bill-items-container');
    if(!container) return;
    container.innerHTML = '';
    billItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.gap = '0.5rem';
        div.style.marginBottom = '0.5rem';
        div.innerHTML = `
            <input type="text" placeholder="Description" value="${item.desc}" onchange="updateBillItem(${index}, 'desc', this.value)" style="flex: 2; padding: 0.5rem;">
            <input type="number" placeholder="Qty" value="${item.qty}" min="1" onchange="updateBillItem(${index}, 'qty', this.value)" style="flex: 1; padding: 0.5rem;">
            <input type="number" placeholder="Price" value="${item.price}" onchange="updateBillItem(${index}, 'price', this.value)" style="flex: 1; padding: 0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="removeBillItem(${index})"><i data-lucide="trash"></i></button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

window.updateBillItem = function(index, field, value) {
    billItems[index][field] = field === 'desc' ? value : Number(value);
    updateBillPreview();
}

window.removeBillItem = function(index) {
    billItems.splice(index, 1);
    renderBillItemsForm();
    updateBillPreview();
}

function updateBillPreview() {
    const date = document.getElementById('bill-date')?.value || new Date().toISOString().split('T')[0];
    const invoiceNo = document.getElementById('bill-no')?.value || '#000001';
    const customer = document.getElementById('bill-customer')?.value || '';
    const note = document.getElementById('bill-note')?.value || '';

    const elDate = document.getElementById('prev-date');
    if(elDate) elDate.innerText = date;
    
    const elInv = document.getElementById('prev-invoice-no');
    if(elInv) elInv.innerText = invoiceNo;
    
    const elCust = document.getElementById('prev-customer');
    if(elCust) elCust.innerText = customer;
    
    const elNote = document.getElementById('prev-note');
    if(elNote) elNote.innerText = note;

    const tbody = document.querySelector('#prev-items-table tbody');
    if(tbody) {
        tbody.innerHTML = '';
        let grandTotal = 0;
        billItems.forEach((item, idx) => {
            const subtotal = item.qty * item.price;
            grandTotal += subtotal;
            tbody.innerHTML += `
                <tr>
                    <td style="padding: 1rem;">${idx + 1}</td>
                    <td style="padding: 1rem;">${item.desc}</td>
                    <td style="padding: 1rem; text-align: right;">${item.qty}</td>
                    <td style="padding: 1rem; text-align: right;">$ ${item.price.toFixed(2)}</td>
                    <td style="padding: 1rem; text-align: right;">$ ${subtotal.toFixed(2)}</td>
                </tr>
            `;
        });
        document.getElementById('prev-grand-total').innerText = `$ ${grandTotal.toFixed(2)}`;
    }
}

// --- View: Dashboard ---
function renderDashboard() {
    let totalCash = 0;
    let totalExpenses = 0;
    
    // Naive cash calculation: sum all debits to Cash minus credits to Cash
    appState.journal.forEach(entry => {
        if (entry.debitAcc.toLowerCase() === 'cash') totalCash += entry.debitAmt;
        if (entry.creditAcc.toLowerCase() === 'cash') totalCash -= entry.creditAmt;
        
        // Expenses rough calculation (any account having 'expense' or 'purchases')
        if (entry.debitAcc.toLowerCase().includes('expense') || entry.debitAcc.toLowerCase().includes('purchases')) {
            totalExpenses += entry.debitAmt;
        }
    });

    const elCash = document.getElementById('dash-cash-balance');
    if(elCash) elCash.innerText = `$ ${totalCash.toFixed(2)}`;
    
    const elBills = document.getElementById('dash-bills-count');
    if(elBills) elBills.innerText = appState.bills.length;
    
    const elExp = document.getElementById('dash-expenses');
    if(elExp) elExp.innerText = `$ ${totalExpenses.toFixed(2)}`;
    
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
                    <td>$ ${entry.debitAmt.toFixed(2)}</td>
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
}

function renderJournal() {
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
                <td>$ ${entry.debitAmt.toFixed(2)}</td>
                <td></td>
            </tr>
            <tr>
                <td style="padding-left: 2rem;"><em>To ${entry.creditAcc}</em></td>
                <td></td>
                <td></td>
                <td>$ ${entry.creditAmt.toFixed(2)}</td>
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
        alert("Please fill all required fields");
        return;
    }
    
    if (debitAmt !== creditAmt) {
        alert("Debit and Credit amounts must be equal in double-entry accounting.");
        return;
    }

    appState.journal.push({
        id: Date.now(), date, desc, debitAcc, debitAmt, creditAcc, creditAmt
    });

    document.getElementById('journal-modal').style.display = 'none';
    renderJournal();
    saveData();
}

// --- Shared: Get Unique Accounts ---
function getUniqueAccounts() {
    const accounts = new Set();
    appState.journal.forEach(e => {
        accounts.add(e.debitAcc);
        accounts.add(e.creditAcc);
    });
    return Array.from(accounts).sort();
}

// --- View: Ledger ---
function renderLedger() {
    const select = document.getElementById('ledger-acc-select');
    if(!select) return;
    
    const accounts = getUniqueAccounts();
    const currentVal = select.value;
    
    select.innerHTML = '<option value="">Select Account...</option>';
    accounts.forEach(acc => {
        select.innerHTML += `<option value="${acc}">${acc}</option>`;
    });
    
    if (accounts.includes(currentVal)) select.value = currentVal;

    select.addEventListener('change', () => {
        renderLedgerTable(select.value);
    });
    
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
                    <td>$ ${entry.debitAmt.toFixed(2)}</td>
                    <td></td>
                    <td>$ ${balance.toFixed(2)} (Dr)</td>
                </tr>
            `;
        }
        if (entry.creditAcc === accountName) {
            balance -= entry.creditAmt;
            const balStr = balance >= 0 ? `$ ${Math.abs(balance).toFixed(2)} (Dr)` : `$ ${Math.abs(balance).toFixed(2)} (Cr)`;
            tbody.innerHTML += `
                <tr>
                    <td>${entry.date}</td>
                    <td>By ${entry.debitAcc} <small>(${entry.desc})</small></td>
                    <td></td>
                    <td>$ ${entry.creditAmt.toFixed(2)}</td>
                    <td>${balStr}</td>
                </tr>
            `;
        }
    });
}

// --- View: Cash Book ---
function renderCashBook() {
    const tbody = document.querySelector('#cash-book-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    let balance = 0;
    const sorted = [...appState.journal].sort((a,b) => new Date(a.date) - new Date(b.date));
    
    sorted.forEach(entry => {
        let isCash = false;
        let receipt = 0;
        let payment = 0;
        let particular = '';

        if (entry.debitAcc.toLowerCase() === 'cash') {
            isCash = true;
            receipt = entry.debitAmt;
            particular = `To ${entry.creditAcc}`;
            balance += receipt;
        } else if (entry.creditAcc.toLowerCase() === 'cash') {
            isCash = true;
            payment = entry.creditAmt;
            particular = `By ${entry.debitAcc}`;
            balance -= payment;
        }

        if (isCash) {
            tbody.innerHTML += `
                <tr>
                    <td>${entry.date}</td>
                    <td>${particular}</td>
                    <td>${receipt ? '$ '+receipt.toFixed(2) : ''}</td>
                    <td>${payment ? '$ '+payment.toFixed(2) : ''}</td>
                    <td>$ ${balance.toFixed(2)}</td>
                </tr>
            `;
        }
    });
}

// --- View: Trial Balance ---
function getAccountBalances() {
    const balances = {};
    appState.journal.forEach(entry => {
        if (!balances[entry.debitAcc]) balances[entry.debitAcc] = 0;
        if (!balances[entry.creditAcc]) balances[entry.creditAcc] = 0;
        
        balances[entry.debitAcc] += entry.debitAmt;
        balances[entry.creditAcc] -= entry.creditAmt;
    });
    return balances;
}

function renderTrialBalance() {
    const tbody = document.querySelector('#tb-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const balances = getAccountBalances();
    let totalDr = 0;
    let totalCr = 0;

    Object.keys(balances).sort().forEach(acc => {
        const bal = balances[acc];
        if (Math.abs(bal) > 0.001) { // ignore floating point zero
            if (bal > 0) {
                totalDr += bal;
                tbody.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">$ ${bal.toFixed(2)}</td><td></td></tr>`;
            } else {
                totalCr += Math.abs(bal);
                tbody.innerHTML += `<tr><td>${acc}</td><td></td><td style="text-align:right;">$ ${Math.abs(bal).toFixed(2)}</td></tr>`;
            }
        }
    });

    document.getElementById('tb-total-debit').innerText = `$ ${totalDr.toFixed(2)}`;
    document.getElementById('tb-total-credit').innerText = `$ ${totalCr.toFixed(2)}`;
}

// --- View: Financial Statements ---
function renderFinancialStatements() {
    const balances = getAccountBalances();
    
    // Heuristics for account types (in a real app, user would classify them)
    // Income: Sales, Revenue, Interest Received
    // Expense: Expense, Purchases, Rent, Salary, Tax
    // Asset: Cash, Bank, Receivable, Equipment, Inventory
    // Liability: Payable, Loan, Capital (Equity)

    let totalIncome = 0;
    let totalExpense = 0;
    let totalAssets = 0;
    let totalLiabEq = 0;

    const isTable = document.querySelector('#is-table tbody');
    const bsTable = document.querySelector('#bs-table tbody');
    if(!isTable || !bsTable) return;
    
    isTable.innerHTML = '';
    bsTable.innerHTML = '';

    isTable.innerHTML += `<tr><th colspan="2">Revenues</th></tr>`;
    Object.keys(balances).forEach(acc => {
        const lower = acc.toLowerCase();
        if (lower.includes('sales') || lower.includes('revenue') || lower.includes('income')) {
            const val = Math.abs(balances[acc]); // Credit bal
            totalIncome += val;
            isTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">$ ${val.toFixed(2)}</td></tr>`;
        }
    });

    isTable.innerHTML += `<tr><th colspan="2">Expenses</th></tr>`;
    Object.keys(balances).forEach(acc => {
        const lower = acc.toLowerCase();
        if (lower.includes('expense') || lower.includes('purchases') || lower.includes('rent') || lower.includes('salary')) {
            const val = balances[acc]; // Debit bal
            totalExpense += val;
            isTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">$ ${val.toFixed(2)}</td></tr>`;
        }
    });

    const netIncome = totalIncome - totalExpense;
    const isRes = document.getElementById('is-result');
    isRes.innerText = netIncome >= 0 ? `Net Profit: $ ${netIncome.toFixed(2)}` : `Net Loss: $ ${Math.abs(netIncome).toFixed(2)}`;
    isRes.style.color = netIncome >= 0 ? 'var(--success)' : 'var(--danger)';

    // Balance Sheet
    bsTable.innerHTML += `<tr><th colspan="2">Assets</th></tr>`;
    Object.keys(balances).forEach(acc => {
        const lower = acc.toLowerCase();
        if (lower.includes('cash') || lower.includes('bank') || lower.includes('receivable') || lower.includes('equipment')) {
            const val = balances[acc]; 
            totalAssets += val;
            bsTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">$ ${val.toFixed(2)}</td></tr>`;
        }
    });

    bsTable.innerHTML += `<tr><th colspan="2">Liabilities & Equity</th></tr>`;
    Object.keys(balances).forEach(acc => {
        const lower = acc.toLowerCase();
        if (lower.includes('payable') || lower.includes('loan') || lower.includes('capital') || lower.includes('equity')) {
            const val = Math.abs(balances[acc]); 
            totalLiabEq += val;
            bsTable.innerHTML += `<tr><td>${acc}</td><td style="text-align:right;">$ ${val.toFixed(2)}</td></tr>`;
        }
    });
    
    // Add Net Income to Equity
    totalLiabEq += netIncome;
    bsTable.innerHTML += `<tr><td>Retained Earnings (Net Income)</td><td style="text-align:right;">$ ${netIncome.toFixed(2)}</td></tr>`;

    document.getElementById('bs-result').innerHTML = `
        <div style="display:flex; justify-content: space-between; padding: 0 1rem;">
            <span>Total Assets: $ ${totalAssets.toFixed(2)}</span>
            <span>Total Liab & Equity: $ ${totalLiabEq.toFixed(2)}</span>
        </div>
    `;
}
