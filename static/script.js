// --- GLOBAL STATE ---
let inventory = [];
let orderDraftItems = [];
let currentStaffOrder = null;
let staffOrdersList = []; // Added to store and filter staff orders

// --- MOBILE SIDEBAR TOGGLE ---
const body = document.body;
function toggleSidebar() { body.classList.toggle('sidebar-open'); }
document.getElementById('mobileMenuButton')?.addEventListener('click', toggleSidebar);
document.getElementById('sidebarOverlay')?.addEventListener('click', toggleSidebar);

// --- UTILITIES & NAVIGATION ---
function showToast(msg, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    stack.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function switchView(viewId) {
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

    const panel = document.getElementById(`view-${viewId}`);
    if (panel) panel.classList.add('active');

    const navBtn = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (navBtn) navBtn.classList.add('active');

    const pageTitle = document.getElementById('pageTitle');
    if (viewId === 'admin-dashboard') { pageTitle.innerText = 'Dashboard'; fetchDashboard(); }
    if (viewId === 'inventory') { pageTitle.innerText = 'Inventory'; fetchInventory(); }
    if (viewId === 'create-order') { pageTitle.innerText = 'Take Order'; fetchInventoryForDropdown(); }
    if (viewId === 'staff-orders') { pageTitle.innerText = 'Orders Queue'; fetchStaffOrders(); }
    if (viewId === 'staff-checking') { pageTitle.innerText = 'Stock Checking'; }

    if (window.innerWidth <= 760) body.classList.remove('sidebar-open');
}

document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => switchView(e.currentTarget.getAttribute('data-view')));
});
document.querySelectorAll('[data-go-view]').forEach(btn => {
    btn.addEventListener('click', (e) => switchView(e.currentTarget.getAttribute('data-go-view')));
});

const dateSpan = document.getElementById('topbarDate');
if (dateSpan) dateSpan.innerText = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });


// --- 1. ADMIN INVENTORY LOGIC ---
async function fetchInventory() {
    if (window.APP_MODE !== 'admin') return;
    try {
        const res = await fetch('/api/parts');
        inventory = await res.json();
        renderInventory(inventory);
    } catch (e) { showToast('Failed to load inventory', 'error'); }
}

function renderInventory(data) {
    const tbody = document.getElementById('inventoryBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    document.getElementById('inventoryCount').innerText = `${data.length} items`;
    if (data.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No inventory items found.</td></tr>`;
        return;
    }

    data.forEach(part => {
        const stockStyle = part.quantity <= 5 ? 'color: var(--red); font-weight: 800;' : 'font-weight: 700;';
        tbody.innerHTML += `
            <tr>
                <td><strong>${part.part_code}</strong></td>
                <td>${part.name}</td>
                <td style="${stockStyle}">${part.quantity}</td>
                <td>₹${part.price.toFixed(2)}</td>
                <td style="display:flex; gap: 8px;">
                    <button class="ghost-button" style="padding: 5px 10px; min-height:0;" onclick='editItem(${JSON.stringify(part).replace(/'/g, "&apos;")})'>Edit</button>
                    <button class="ghost-button" style="padding: 5px 10px; min-height:0; color:var(--red); border-color:var(--red-soft);" onclick='deleteItem(${part.id})'>Del</button>
                </td>
            </tr>
        `;
    });
}

function generatePartCode() {
    return 'PRT-' + Math.random().toString(36).substring(2, 6).toUpperCase() + Math.floor(100 + Math.random() * 900);
}

const itemModal = 'itemModalBackdrop';
document.getElementById('openAddItemButton')?.addEventListener('click', () => {
    document.getElementById('itemForm').reset();
    document.getElementById('itemId').value = '';
    document.getElementById('itemPartCode').value = generatePartCode();
    document.getElementById('itemModalTitle').innerText = 'Add Item';
    openModal(itemModal);
});
document.getElementById('closeItemModalButton')?.addEventListener('click', () => closeModal(itemModal));
document.getElementById('cancelItemButton')?.addEventListener('click', () => closeModal(itemModal));
document.getElementById('refreshInventoryButton')?.addEventListener('click', fetchInventory);

document.getElementById('inventorySearch')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderInventory(inventory.filter(p => p.name.toLowerCase().includes(q) || p.part_code.toLowerCase().includes(q)));
});

function editItem(part) {
    document.getElementById('itemId').value = part.id;
    document.getElementById('itemPartCode').value = part.part_code;
    document.getElementById('itemName').value = part.name;
    document.getElementById('itemQuantity').value = part.quantity;
    document.getElementById('itemPrice').value = part.price;
    document.getElementById('itemModalTitle').innerText = 'Edit Item';
    openModal(itemModal);
}

document.getElementById('itemForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('itemId').value;
    const payload = {
        part_code: document.getElementById('itemPartCode').value,
        name: document.getElementById('itemName').value,
        quantity: document.getElementById('itemQuantity').value,
        price: document.getElementById('itemPrice').value
    };

    try {
        const res = await fetch(id ? `/api/parts/${id}` : '/api/parts', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            showToast('Item saved successfully!');
            closeModal(itemModal);
            fetchInventory();
            fetchDashboard();
        } else { showToast(json.error || 'Failed to save', 'error'); }
    } catch (err) { showToast('Network Error', 'error'); }
});

async function deleteItem(id) {
    if (!confirm("Delete this part entirely?")) return;
    const res = await fetch(`/api/parts/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { showToast('Item deleted.'); fetchInventory(); }
}


// --- 2. ADMIN ORDER CREATION (SEARCHABLE DROPDOWN) ---
async function fetchInventoryForDropdown() {
    if (inventory.length === 0) {
        const res = await fetch('/api/parts');
        inventory = await res.json();
    }
    document.getElementById('partSearchInput').value = '';
    document.getElementById('selectedPartId').value = '';
    orderDraftItems = [];
    renderDraft();
}

function renderPartSearchMenu(items) {
    const menu = document.getElementById('partSearchMenu');
    if (!menu) return;
    menu.innerHTML = '';

    if (items.length === 0) {
        menu.innerHTML = '<div class="searchable-item-empty">No parts found</div>';
        return;
    }

    items.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'searchable-item-option';
        btn.innerHTML = `<strong>${p.name}</strong><small>Stock: ${p.quantity} | ₹${p.price.toFixed(2)}</small>`;
        btn.onclick = () => {
            document.getElementById('partSearchInput').value = p.name;
            document.getElementById('selectedPartId').value = p.id;
            document.getElementById('partSearchContainer').classList.remove('open');
        };
        menu.appendChild(btn);
    });
}

const searchInput = document.getElementById('partSearchInput');
const searchContainer = document.getElementById('partSearchContainer');

if (searchInput && searchContainer) {
    searchInput.addEventListener('focus', () => {
        searchContainer.classList.add('open');
        renderPartSearchMenu(inventory);
    });

    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.getElementById('selectedPartId').value = '';

        const filtered = inventory.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.part_code.toLowerCase().includes(q)
        );
        renderPartSearchMenu(filtered);
        searchContainer.classList.add('open');
    });

    document.addEventListener('click', (e) => {
        if (!searchContainer.contains(e.target)) {
            searchContainer.classList.remove('open');
        }
    });
}

document.getElementById('addOrderLineButton')?.addEventListener('click', () => {
    const partId = document.getElementById('selectedPartId').value;
    const reqQty = parseInt(document.getElementById('requestedQty').value);

    if (!partId) return showToast('Please search and select a part from the list', 'error');
    if (isNaN(reqQty) || reqQty < 1) return showToast('Enter a valid quantity', 'error');
    if (orderDraftItems.find(i => i.part_id == partId)) return showToast('Part already in list', 'error');

    const part = inventory.find(p => p.id == partId);

    if (reqQty > part.quantity) {
        return showToast(`Cannot add ${reqQty}. Only ${part.quantity} available in stock.`, 'error');
    }

    orderDraftItems.push({
        part_id: part.id,
        part_code: part.part_code,
        name: part.name,
        requested_qty: reqQty,
        price: part.price,
        discount: 0
    });

    document.getElementById('partSearchInput').value = '';
    document.getElementById('selectedPartId').value = '';
    document.getElementById('requestedQty').value = '1';

    renderDraft();
});

function removeDraftLine(idx) { orderDraftItems.splice(idx, 1); renderDraft(); }

function updateDiscount(idx, val) {
    let discount = parseFloat(val);
    if (isNaN(discount) || discount < 0) discount = 0;
    orderDraftItems[idx].discount = discount;
    renderDraft();
}

function renderDraft() {
    const tbody = document.getElementById('orderDraftBody');
    const orderTotalEl = document.getElementById('orderTotal');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (orderDraftItems.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No parts added yet.</td></tr>`;
        if (orderTotalEl) orderTotalEl.innerText = '₹0.00';
        return;
    }

    let grandTotal = 0;

    orderDraftItems.forEach((i, idx) => {
        const lineTotal = Math.max(0, (i.requested_qty * i.price) - i.discount);
        grandTotal += lineTotal;
        tbody.innerHTML += `
            <tr>
                <td><strong>${i.name}</strong></td>
                <td>₹${i.price.toFixed(2)}</td>
                <td>${i.requested_qty}</td>
                <td>
                    <input type="number" class="searchable-item-input" style="width: 80px; padding: 0 8px; height: 32px;" min="0" value="${i.discount}" onchange="updateDiscount(${idx}, this.value)">
                </td>
                <td><strong>₹${lineTotal.toFixed(2)}</strong></td>
                <td><button type="button" class="ghost-button" style="color:var(--red); padding:5px; min-height:0;" onclick="removeDraftLine(${idx})">X</button></td>
            </tr>
        `;
    });

    if (orderTotalEl) orderTotalEl.innerText = `₹${grandTotal.toFixed(2)}`;
}

document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (orderDraftItems.length === 0) return showToast('Add at least one item.', 'error');

    const payload = {
        customer_name: document.getElementById('orderCustomerName').value,
        items: orderDraftItems
    };

    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.success) {
        showToast('Order Created successfully!');
        document.getElementById('orderForm').reset();
        orderDraftItems = [];
        renderDraft();
        switchView('admin-dashboard');
    } else { showToast(json.error, 'error'); }
});


// --- 3. ADMIN DASHBOARD METRICS ---
async function fetchDashboard() {
    if (window.APP_MODE !== 'admin') return;
    try {
        const partsRes = await fetch('/api/parts');
        const parts = await partsRes.json();
        const ordersRes = await fetch('/api/orders');
        const orders = await ordersRes.json();

        let totalItems = parts.length;
        let totalStock = parts.reduce((sum, p) => sum + p.quantity, 0);
        let pending = orders.filter(o => o.status === 'Pending').length;
        let completed = orders.filter(o => o.status === 'Completed').length;

        document.getElementById('statTotalItems').innerText = totalItems;
        document.getElementById('statTotalStock').innerText = totalStock;
        document.getElementById('statPendingOrders').innerText = pending;
        document.getElementById('statCompletedOrders').innerText = completed;

        const tbody = document.getElementById('dashboardOrdersBody');
        tbody.innerHTML = '';
        if (orders.length === 0) tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No recent orders</td></tr>`;

        orders.slice(0, 5).forEach(o => {
            const badgeClass = o.status === 'Pending' ? 'pending' : (o.status === 'Completed' ? 'completed' : 'checked');
            tbody.innerHTML += `
                <tr>
                    <td><strong>#${o.id}</strong></td>
                    <td>${o.customer_name}</td>
                    <td>${new Date(o.created_at).toLocaleDateString()}</td>
                    <td><span class="status-badge ${badgeClass}">${o.status}</span></td>
                </tr>
            `;
        });
    } catch (e) { }
}


// --- 4. STAFF WORKFLOW ---
async function fetchStaffOrders() {
    try {
        const endpoint = window.APP_MODE === 'staff' ? `/api/staff/${window.SHOP_SLUG}/orders` : `/api/orders`;
        const res = await fetch(endpoint);
        staffOrdersList = await res.json();
        renderStaffOrders(staffOrdersList);
    } catch (e) { }
}

function renderStaffOrders(orders) {
    const tbody = document.getElementById('staffOrdersBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (orders.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="3">No orders found.</td></tr>`;
        return;
    }

    orders.forEach(o => {
        const badgeClass = o.status === 'Pending' ? 'pending' : (o.status === 'Completed' ? 'completed' : 'checked');
        const actionBtn = (o.status === 'Pending' && window.APP_MODE === 'staff')
            ? `<button class="primary-button" style="padding: 6px 12px; min-height: 0;" onclick='openStaffOrder(${JSON.stringify(o).replace(/'/g, "&apos;")})'>Check Stock</button>`
            : `<button class="secondary-button" style="padding: 6px 12px; min-height: 0;" onclick='openStaffOrder(${JSON.stringify(o).replace(/'/g, "&apos;")})'>View</button>`;

        tbody.innerHTML += `
            <tr>
                <td><strong>${o.customer_name}</strong></td>
                <td><span class="status-badge ${badgeClass}">${o.status}</span></td>
                <td>${actionBtn}</td>
            </tr>
        `;
    });
}

document.getElementById('refreshStaffOrdersButton')?.addEventListener('click', fetchStaffOrders);

document.getElementById('staffOrderSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = staffOrdersList.filter(o =>
        o.customer_name.toLowerCase().includes(q) ||
        o.id.toString().includes(q)
    );
    renderStaffOrders(filtered);
});

function openStaffOrder(order) {
    currentStaffOrder = order;
    switchView('staff-checking');

    document.getElementById('staffCheckingEmpty').classList.add('hidden');
    document.getElementById('staffCheckingForm').classList.remove('hidden');

    document.getElementById('staffOrderDetailTitle').innerText = `Order #${order.id}`;
    document.getElementById('staffOrderDetailParty').innerText = order.customer_name;

    const badge = document.getElementById('staffOrderDetailStatus');
    badge.className = `status-badge ${order.status === 'Pending' ? 'pending' : 'completed'}`;
    badge.innerText = order.status;

    const isPending = order.status === 'Pending' && window.APP_MODE === 'staff';
    document.getElementById('staffActionButtons').style.display = isPending ? 'flex' : 'none';

    const tbody = document.getElementById('staffOrderItemsBody');
    tbody.innerHTML = '';

    order.items.forEach(i => {
        if (isPending) {
            tbody.innerHTML += `
                <tr data-item-id="${i.id}">
                    <td><strong>${i.part_code}</strong></td>
                    <td>${i.name}</td>
                    <td>${i.requested_qty}</td>
                    <td><input type="number" class="available-quantity-input field-label input" style="height:36px; min-width: 60px; max-width:80px;" min="0" value="${i.requested_qty}" required></td>
                    <td><input type="text" class="item-remark field-label input" style="height:36px; width: 100%; min-width:100px;" placeholder="Remarks"></td>
                </tr>
            `;
        } else {
            tbody.innerHTML += `
                <tr>
                    <td><strong>${i.part_code}</strong></td>
                    <td>${i.name}</td>
                    <td>${i.requested_qty}</td>
                    <td><strong>${i.available_qty}</strong></td>
                    <td>${i.remarks || '-'}</td>
                </tr>
            `;
        }
    });
}

document.getElementById('staffCheckingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentStaffOrder) return;

    const rows = document.querySelectorAll('#staffOrderItemsBody tr');
    const updates = Array.from(rows).map(r => ({
        item_id: r.getAttribute('data-item-id'),
        available_qty: r.querySelector('.available-quantity-input').value,
        remarks: r.querySelector('.item-remark').value
    }));

    try {
        const res = await fetch(`/api/staff/${window.SHOP_SLUG}/orders`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: currentStaffOrder.id, items: updates })
        });
        const json = await res.json();
        if (json.success) {
            showToast('Order completed & stock deducted successfully!');
            switchView('staff-orders');
        } else {
            showToast(json.error, 'error');
        }
    } catch (err) { showToast('Network error', 'error'); }
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    if (window.APP_MODE === 'admin') fetchDashboard();
    else if (window.APP_MODE === 'staff') switchView('staff-orders');
});