import os
import sqlite3
from functools import wraps
from flask import Flask, request, session, redirect, url_for, render_template, jsonify, abort
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
# WARNING: Change this secret key in a production environment!
app.secret_key = 'CHANGE_THIS_DEFAULT_SECRET_KEY_BEFORE_DEPLOYMENT'
DATABASE = 'shop.db'

# --- Database Setup & Initialization ---

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        
        cursor.execute('''CREATE TABLE IF NOT EXISTS shops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL
        )''')
        
        cursor.execute('''CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id INTEGER NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            FOREIGN KEY (shop_id) REFERENCES shops (id)
        )''')
        
        cursor.execute('''CREATE TABLE IF NOT EXISTS parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            part_code TEXT NOT NULL,
            category TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity >= 0),
            purchase_price REAL NOT NULL CHECK (purchase_price >= 0),
            selling_price REAL NOT NULL CHECK (selling_price >= 0),
            FOREIGN KEY (shop_id) REFERENCES shops (id),
            UNIQUE(shop_id, part_code)
        )''')
        
        cursor.execute('''CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id INTEGER NOT NULL,
            customer_name TEXT NOT NULL,
            status TEXT DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops (id)
        )''')
        
        cursor.execute('''CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            part_id INTEGER NOT NULL,
            requested_qty INTEGER NOT NULL CHECK (requested_qty > 0),
            available_qty INTEGER DEFAULT 0 CHECK (available_qty >= 0),
            remarks TEXT DEFAULT '',
            FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
            FOREIGN KEY (part_id) REFERENCES parts (id)
        )''')

        cursor.execute("SELECT COUNT(*) FROM shops")
        if cursor.fetchone()[0] == 0:
            shops_data = [
                ('Super Accessories World', 'accessories', 'admin_acc', 'admin123'),
                ('Super EV World', 'ev', 'admin_ev', 'admin123')
            ]
            for name, slug, username, password in shops_data:
                cursor.execute("INSERT INTO shops (name, slug) VALUES (?, ?)", (name, slug))
                shop_id = cursor.lastrowid
                pwd_hash = generate_password_hash(password)
                cursor.execute("INSERT INTO users (shop_id, username, password_hash) VALUES (?, ?, ?)", 
                               (shop_id, username, pwd_hash))
        
        db.commit()
        db.close()

init_db()


# --- Authentication & Authorization ---

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def get_shop_by_slug(slug):
    db = get_db()
    shop = db.execute("SELECT * FROM shops WHERE slug = ?", (slug,)).fetchone()
    db.close()
    return shop


# --- UI Routes ---

@app.route('/', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('admin_dashboard'))
        
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        db = get_db()
        user = db.execute('''
            SELECT u.*, s.name as shop_name 
            FROM users u 
            JOIN shops s ON u.shop_id = s.id 
            WHERE u.username = ?
        ''', (username,)).fetchone()
        db.close()
        
        if user and check_password_hash(user['password_hash'], password):
            session['user_id'] = user['id']
            session['shop_id'] = user['shop_id']
            session['shop_name'] = user['shop_name']
            session['username'] = user['username']
            return redirect(url_for('admin_dashboard'))
        else:
            error = "Invalid credentials. Please try again."
            
    return render_template('index.html', view_mode='login', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/admin')
@login_required
def admin_dashboard():
    return render_template('index.html', view_mode='admin', shop_name=session['shop_name'])

@app.route('/staff/<shop_slug>')
def staff_dashboard(shop_slug):
    shop = get_shop_by_slug(shop_slug)
    if not shop:
        abort(404)
    return render_template('index.html', view_mode='staff', shop_name=shop['name'], shop_slug=shop['slug'])


# --- API Routes (Admin) ---

@app.route('/api/parts', methods=['GET', 'POST'])
@login_required
def api_parts():
    db = get_db()
    shop_id = session['shop_id']
    
    if request.method == 'GET':
        parts = db.execute("SELECT * FROM parts WHERE shop_id = ?", (shop_id,)).fetchall()
        db.close()
        return jsonify([dict(p) for p in parts])
        
    if request.method == 'POST':
        data = request.json
        try:
            db.execute('''
                INSERT INTO parts (shop_id, name, part_code, category, quantity, purchase_price, selling_price)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (shop_id, data['name'], data['part_code'], data['category'], 
                  int(data['quantity']), float(data['purchase_price']), float(data['selling_price'])))
            db.commit()
            return jsonify({'success': True})
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Part code already exists or invalid data'}), 400
        finally:
            db.close()

@app.route('/api/parts/<int:part_id>', methods=['PUT', 'DELETE'])
@login_required
def api_part_detail(part_id):
    db = get_db()
    shop_id = session['shop_id']
    
    part = db.execute("SELECT id FROM parts WHERE id = ? AND shop_id = ?", (part_id, shop_id)).fetchone()
    if not part:
        db.close()
        return jsonify({'error': 'Unauthorized or part not found'}), 403

    if request.method == 'PUT':
        data = request.json
        try:
            db.execute('''
                UPDATE parts SET name=?, part_code=?, category=?, quantity=?, purchase_price=?, selling_price=?
                WHERE id = ? AND shop_id = ?
            ''', (data['name'], data['part_code'], data['category'], 
                  int(data['quantity']), float(data['purchase_price']), float(data['selling_price']), part_id, shop_id))
            db.commit()
            return jsonify({'success': True})
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Part code already exists or invalid data'}), 400
        finally:
            db.close()
            
    if request.method == 'DELETE':
        db.execute("DELETE FROM parts WHERE id = ? AND shop_id = ?", (part_id, shop_id))
        db.commit()
        db.close()
        return jsonify({'success': True})

@app.route('/api/orders', methods=['GET', 'POST'])
@login_required
def api_admin_orders():
    db = get_db()
    shop_id = session['shop_id']
    
    if request.method == 'GET':
        orders = db.execute("SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC", (shop_id,)).fetchall()
        result = []
        for o in orders:
            order_dict = dict(o)
            items = db.execute('''
                SELECT oi.*, p.name, p.part_code 
                FROM order_items oi 
                JOIN parts p ON oi.part_id = p.id 
                WHERE oi.order_id = ?
            ''', (o['id'],)).fetchall()
            order_dict['items'] = [dict(i) for i in items]
            result.append(order_dict)
        db.close()
        return jsonify(result)
        
    if request.method == 'POST':
        data = request.json
        customer_name = data.get('customer_name')
        items = data.get('items', [])
        
        if not customer_name or not items:
            return jsonify({'error': 'Customer name and items are required'}), 400
            
        cursor = db.cursor()
        try:
            cursor.execute("INSERT INTO orders (shop_id, customer_name, status) VALUES (?, ?, 'Pending')", (shop_id, customer_name))
            order_id = cursor.lastrowid
            
            for item in items:
                cursor.execute('''
                    INSERT INTO order_items (order_id, part_id, requested_qty) 
                    VALUES (?, ?, ?)
                ''', (order_id, item['part_id'], int(item['requested_qty'])))
            
            db.commit()
            return jsonify({'success': True})
        except Exception as e:
            db.rollback()
            return jsonify({'error': str(e)}), 400
        finally:
            db.close()

# --- API Routes (Staff Workflow) ---

@app.route('/api/staff/<shop_slug>/orders', methods=['GET', 'PUT'])
def api_staff_orders(shop_slug):
    shop = get_shop_by_slug(shop_slug)
    if not shop:
        return jsonify({'error': 'Shop not found'}), 404
        
    shop_id = shop['id']
    db = get_db()
    
    if request.method == 'GET':
        orders = db.execute("SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC", (shop_id,)).fetchall()
        result = []
        for o in orders:
            order_dict = dict(o)
            items = db.execute('''
                SELECT oi.*, p.name, p.part_code 
                FROM order_items oi 
                JOIN parts p ON oi.part_id = p.id 
                WHERE oi.order_id = ?
            ''', (o['id'],)).fetchall()
            order_dict['items'] = [dict(i) for i in items]
            result.append(order_dict)
        db.close()
        return jsonify(result)
        
    if request.method == 'PUT':
        data = request.json
        order_id = data.get('order_id')
        items_updates = data.get('items', [])
        
        order = db.execute("SELECT id, status FROM orders WHERE id = ? AND shop_id = ?", (order_id, shop_id)).fetchone()
        if not order:
            db.close()
            return jsonify({'error': 'Order not found or unauthorized'}), 403
            
        if order['status'] == 'Completed':
            db.close()
            return jsonify({'error': 'Order is already completed'}), 400
            
        cursor = db.cursor()
        try:
            for item in items_updates:
                avail_qty = int(item['available_qty'])
                item_id = item['item_id']
                
                # Retrieve the specific part ID for stock deduction
                oi = cursor.execute("SELECT part_id FROM order_items WHERE id = ? AND order_id = ?", (item_id, order_id)).fetchone()
                if not oi:
                    continue
                    
                part_id = oi['part_id']
                
                # Update the order line item remarks and quantity
                cursor.execute('''
                    UPDATE order_items 
                    SET available_qty = ?, remarks = ? 
                    WHERE id = ?
                ''', (avail_qty, item.get('remarks', ''), item_id))
                
                # Automatically deduct from inventory stock
                if avail_qty > 0:
                    cursor.execute("UPDATE parts SET quantity = quantity - ? WHERE id = ?", (avail_qty, part_id))
            
            # Change status directly to Completed
            cursor.execute("UPDATE orders SET status = 'Completed' WHERE id = ?", (order_id,))
            db.commit()
            return jsonify({'success': True})
            
        except sqlite3.IntegrityError:
            db.rollback()
            return jsonify({'error': 'Insufficient stock! Deducting these items would cause negative inventory. Please adjust stock levels first.'}), 400
        except Exception as e:
            db.rollback()
            return jsonify({'error': str(e)}), 400
        finally:
            db.close()

if __name__ == '__main__':
    app.run(debug=True, port=5000)