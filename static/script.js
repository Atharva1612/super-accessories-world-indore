// Global State
let inventory = [];
let orderDraftItems = [];

// --- Utilities ---
function showNotification(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.innerText = msg;
    container.appendChild(notif);
    
    // Animate in
    setTimeout(() => notif.classList.add('show'), 10);
    // Remove after 3 seconds
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
    
    if (tabId === 'inventory-tab') fetchInventory();
    if (tabId === 'orders-tab') fetchAdminOrders();
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// --- ADMIN MODE: INVENTORY ---
async function fetchInventory() {
    if (window.APP_MODE !== 'admin') return;
    try {
        const res = await fetch('/api/parts');
        inventory = await res.json();
        renderInventory(inventory);
    } catch (e) {
        showNotification('Error fetching inventory', 'error');
    }
}

function renderInventory(data) {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.forEach(part => {
        tbody.innerHTML += `
            <tr>
                <td>${part.part_code}</td>
                <td>${part.name}</td>
                <td>${part.category}</td>
                <td>${part.quantity}</td>
                <td>$${part.selling_price.toFixed(2)}</td>
                <td>
                    <button class="btn small secondary" onclick='editPart(${JSON.stringify(part).replace(/'/g, "&apos;")})'>Edit</button>
                    <button class="btn small danger" onclick='deletePart(${part.id})'>Delete</button>
                </td>
            </tr>
        `;
    });
}

function filterInventory() {
    const query = document.getElementById('search-inventory').value.toLowerCase();
    const filtered = inventory.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.part_code.toLowerCase().includes(query)
    );
    renderInventory(filtered);
}

function openPartModal() {
    document.getElementById('part-form').reset();
    document.getElementById('part-id').value = '';
    document.getElementById('part-modal-title').innerText = 'Add Part';
    openModal('part-modal');
}

function editPart(part) {
    document.getElementById('part-id').value = part.id;
    document.getElementById('part-code').value = part.part_code;
    document.getElementById('part-name').value = part.name;
    document.getElementById('part-category').value = part.category;
    document.getElementById('part-quantity').value = part.quantity;
    document.getElementById('part-purchase').value = part.purchase_price;
    document.getElementById('part-selling').value = part.selling_price;
    document.getElementById('part-modal-title').innerText = 'Edit Part';
    openModal('part-modal');
}

async function submitPart(e) {
    e.preventDefault();
    const id = document.getElementById('part-id').value;
    const data = {
        part_code: document.getElementById('part-code').value,
        name: document.getElementById('part-name').value,
        category: document.getElementById('part-category').value,
        quantity: document.getElementById('part-quantity').value,
        purchase_price: document.getElementById('part-purchase').value,
        selling_price: document.getElementById('part-selling').value
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/parts/${id}` : '/api/parts';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (result.success) {
            showNotification('Part saved successfully');
            closeModal('part-modal');
            fetchInventory();
        } else {
            showNotification(result.error || 'Failed to save part', 'error');
        }
    } catch (err) {
        showNotification('Network error', 'error');
    }
}

async function deletePart(id) {
    if (!confirm('Are you sure you want to delete this part?')) return;
    try {
        const res = await fetch(`/api/parts/${id}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            showNotification('Part deleted');
            fetchInventory();
        } else {
            showNotification(result.error || 'Failed to delete', 'error');
        }
    } catch (err) {
        showNotification('Network error', 'error');
    }
}

// --- ADMIN MODE: ORDERS ---
function openOrderModal() {
    document.getElementById('order-form').reset();
    orderDraftItems = [];
    renderOrderDraft();
    
    // Populate select
    const select = document.getElementById('part-select');
    select.innerHTML = '<option value="">Select a part...</option>';
    inventory.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.part_code} - ${p.name} (Stock: ${p.quantity})</option>`;
    });
    
    openModal('order-modal');
}

function addPartToOrder() {
    const select = document.getElementById('part-select');
    const partId = select.value;
    const reqQty = parseInt(document.getElementById('requested-qty-input').value);
    
    if (!partId || isNaN(reqQty) || reqQty < 1) {
        showNotification('Select a valid part and quantity > 0', 'error');
        return;
    }
    
    const part = inventory.find(p => p.id == partId);
    if (orderDraftItems.find(i => i.part_id == partId)) {
        showNotification('Part already in order list', 'error');
        return;
    }
    
    orderDraftItems.push({
        part_id: part.id,
        part_code: part.part_code,
        name: part.name,
        requested_qty: reqQty
    });
    
    document.getElementById('requested-qty-input').value = '';
    select.value = '';
    renderOrderDraft();
}

function removeDraftItem(index) {
    orderDraftItems.splice(index, 1);
    renderOrderDraft();
}

function renderOrderDraft() {
    const tbody = document.getElementById('order-draft-body');
    tbody.innerHTML = '';
    orderDraftItems.forEach((item, index) => {
        tbody.innerHTML += `
            <tr>
                <td>${item.part_code}</td>
                <td>${item.name}</td>
                <td>${item.requested_qty}</td>
                <td><button type="button" class="btn small danger" onclick="removeDraftItem(${index})">X</button></td>
            </tr>
        `;
    });
}

async function submitOrder(e) {
    e.preventDefault();
    if (orderDraftItems.length === 0) {
        showNotification('Add at least one item to the order', 'error');
        return;
    }
    
    const data = {
        customer_name: document.getElementById('order-customer').value,
        items: orderDraftItems
    };
    
    try {
        const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (result.success) {
            showNotification('Order created successfully');
            closeModal('order-modal');
            fetchAdminOrders();
        } else {
            showNotification(result.error || 'Failed to create order', 'error');
        }
    } catch (err) {
        showNotification('Network error', 'error');
    }
}

async function fetchAdminOrders() {
    if (window.APP_MODE !== 'admin') return;
    try {
        const res = await fetch('/api/orders');
        const orders = await res.json();
        renderAdminOrders(orders);
    } catch (e) {
        showNotification('Error fetching orders', 'error');
    }
}

function renderAdminOrders(orders) {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = '';
    
    if (orders.length === 0) {
        container.innerHTML = '<p>No orders found.</p>';
        return;
    }
    
    orders.forEach(order => {
        let itemsHtml = order.items.map(i => `
            <tr>
                <td>${i.part_code}</td>
                <td>${i.name}</td>
                <td>${i.requested_qty}</td>
                <td><strong>${order.status !== 'Pending' ? i.available_qty : '-'}</strong></td>
                <td>${i.remarks || '-'}</td>
            </tr>
        `).join('');
        
        let actionBtn = '';
        if (order.status === 'Checked') {
            actionBtn = `<button class="btn primary small" onclick="markOrderCompleted(${order.id})">Mark as Completed</button>`;
        }
        
        container.innerHTML += `
            <div class="order-card status-${order.status}">
                <div class="order-header">
                    <div>
                        <h3>Order #${order.id} - ${order.customer_name}</h3>
                        <div class="order-meta">Created: ${new Date(order.created_at).toLocaleString()}</div>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge ${order.status}">${order.status}</span>
                        <div style="margin-top: 10px;">${actionBtn}</div>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr><th>Code</th><th>Item Name</th><th>Req Qty</th><th>Avail Qty</th><th>Staff Remarks</th></tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
            </div>
        `;
    });
}

async function markOrderCompleted(orderId) {
    if (!confirm('Mark this order as completed? (This implies items were dispatched. Note: Inventory deduction logic is skipped per requirements).')) return;
    try {
        const res = await fetch(`/api/orders/${orderId}/complete`, { method: 'POST' });
        const result = await res.json();
        if (result.success) {
            showNotification('Order completed');
            fetchAdminOrders();
        } else {
            showNotification(result.error || 'Failed to complete', 'error');
        }
    } catch (err) {
        showNotification('Network error', 'error');
    }
}

// --- STAFF MODE ---
async function fetchStaffOrders() {
    if (window.APP_MODE !== 'staff') return;
    try {
        const res = await fetch(`/api/staff/${window.SHOP_SLUG}/orders`);
        const orders = await res.json();
        renderStaffOrders(orders);
    } catch (e) {
        showNotification('Error fetching orders', 'error');
    }
}

function renderStaffOrders(orders) {
    const container = document.getElementById('staff-orders-container');
    container.innerHTML = '';
    
    if (orders.length === 0) {
        container.innerHTML = '<p>No orders found for this shop.</p>';
        return;
    }
    
    orders.forEach(order => {
        let isPending = order.status === 'Pending';
        let itemsHtml = order.items.map(i => {
            if (isPending) {
                // Input mode
                return `
                    <tr data-item-id="${i.id}">
                        <td>${i.part_code}</td>
                        <td>${i.name}</td>
                        <td><strong>${i.requested_qty}</strong></td>
                        <td><input type="number" class="staff-input avail-qty" min="0" value="${i.requested_qty}" required></td>
                        <td><input type="text" class="staff-remarks item-remarks" placeholder="Optional remarks"></td>
                    </tr>
                `;
            } else {
                // Read-only mode
                return `
                    <tr>
                        <td>${i.part_code}</td>
                        <td>${i.name}</td>
                        <td>${i.requested_qty}</td>
                        <td><strong>${i.available_qty}</strong></td>
                        <td>${i.remarks || '-'}</td>
                    </tr>
                `;
            }
        }).join('');
        
        let formWrapperStart = isPending ? `<form onsubmit="submitStaffUpdate(event, ${order.id})">` : '';
        let formWrapperEnd = isPending ? `<div style="margin-top: 1rem; text-align:right;"><button type="submit" class="btn primary">Submit Availability Check</button></div></form>` : '';
        
        container.innerHTML += `
            <div class="order-card status-${order.status}" id="order-card-${order.id}">
                <div class="order-header">
                    <div>
                        <h3>Order #${order.id} - ${order.customer_name}</h3>
                        <div class="order-meta">Created: ${new Date(order.created_at).toLocaleString()}</div>
                    </div>
                    <span class="badge ${order.status}">${order.status}</span>
                </div>
                ${formWrapperStart}
                <table>
                    <thead>
                        <tr><th>Code</th><th>Item Name</th><th>Req Qty</th><th>Avail Qty</th><th>Remarks</th></tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                ${formWrapperEnd}
            </div>
        `;
    });
}

async function submitStaffUpdate(e, orderId) {
    e.preventDefault();
    const card = document.getElementById(`order-card-${orderId}`);
    const rows = card.querySelectorAll('tbody tr');
    
    const updates = Array.from(rows).map(row => {
        return {
            item_id: row.getAttribute('data-item-id'),
            available_qty: row.querySelector('.avail-qty').value,
            remarks: row.querySelector('.item-remarks').value
        };
    });
    
    try {
        const res = await fetch(`/api/staff/${window.SHOP_SLUG}/orders`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, items: updates })
        });
        const result = await res.json();
        
        if (result.success) {
            showNotification('Order successfully checked and updated');
            fetchStaffOrders();
        } else {
            showNotification(result.error || 'Failed to update order', 'error');
        }
    } catch (err) {
        showNotification('Network error', 'error');
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (window.APP_MODE === 'admin') {
        fetchInventory();
    } else if (window.APP_MODE === 'staff') {
        fetchStaffOrders();
    }
});