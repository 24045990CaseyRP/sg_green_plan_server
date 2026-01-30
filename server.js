const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const fs = require('fs');

const app = express();
const port = 3000;
const cors = require("cors");

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_me';

const allowedOrigins = [
    "http://localhost:3000",
    "https://sg-green-plan-server.onrender.com"
];

app.use(
    cors({
        origin: function (origin, callback) {
            // allow requests with no origin (Postman/server-to-server)
            if (!origin) return callback(null, true);

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error("Not allowed by CORS"));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false,
    })
);
// 1. Create a Connection Pool based on your DBConfig
// This is more efficient than creating a new connection for every request
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
};

// Check if Aiven SSL cert exists
if (fs.existsSync('./ca.pem')) {
    dbConfig.ssl = {
        ca: fs.readFileSync('./ca.pem'),
        rejectUnauthorized: false
    };
    console.log('SSL Certificate found and loaded.');
} else {
    // Fallback for local development or if SSL not strictly enforced/provided differently
    // Aiven REQUIRES SSL, so this might fail if file is missing.
    // However, we set a default empty object or just don't set ssl key if not found.
    // For Aiven, usually just having ssl: { rejectUnauthorized: false } works if CA isn't strictly checked,
    // but best practice is to use the CA.
    console.log('Warning: ca.pem not found. Connecting without specific SSL CA config (might fail for Aiven).');

    // Some setups might just need this:
    dbConfig.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(dbConfig);

app.use(express.json());

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Middleware to authorize roles
const authorizeRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied' });
        }
        next();
    };
};

// Register Route
app.post('/register', async (req, res) => {
    const { username, password, confirmPassword, role } = req.body;

    // 1. Basic Validation
    if (!username || !password || !confirmPassword || !role) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ message: 'Passwords do not match' });
    }

    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
    }

    try {
        // 2. Check if username exists
        const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        // 3. Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Insert User
        const [result] = await pool.execute(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role]
        );

        res.status(201).json({ message: 'User registered successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during registration' });
    }
});

// Login Route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        const user = users[0];

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, role: user.role, username: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// 1. Get all drop-off points (with accepted materials)
// User: Can view. Admin: Can view.
app.get('/points', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id, p.name, p.address, p.postal_code, p.latitude, p.longitude, p.status,
                GROUP_CONCAT(m.material_name SEPARATOR ', ') AS accepted_materials
            FROM drop_off_points p
            LEFT JOIN point_materials pm ON p.id = pm.point_id
            LEFT JOIN recyclable_types m ON pm.material_id = m.id
            GROUP BY p.id
        `;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching points' });
    }
});

// 2. Get all recyclable types
app.get('/types', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM recyclable_types');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching types' });
    }
});

// Material Management Routes
app.get('/materials', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM recyclable_types');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching materials' });
    }
});

app.post('/materials', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { material_name, icon_url } = req.body;
    try {
        const [existing] = await pool.query('SELECT id FROM recyclable_types WHERE material_name = ?', [material_name]);
        if (existing.length > 0) return res.status(400).json({ message: 'Material already exists' });

        const [result] = await pool.execute(
            'INSERT INTO recyclable_types (material_name, icon_url) VALUES (?, ?)',
            [material_name, icon_url]
        );
        res.status(201).json({ message: 'Material added successfully', id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error adding material' });
    }
});

app.put('/materials/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params;
    const { material_name, icon_url } = req.body;
    try {
        const [result] = await pool.execute(
            'UPDATE recyclable_types SET material_name=?, icon_url=? WHERE id=?',
            [material_name, icon_url, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Material not found' });
        res.json({ message: 'Material updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error updating material' });
    }
});

app.delete('/materials/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await pool.execute('DELETE FROM recyclable_types WHERE id=?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Material not found' });
        res.json({ message: 'Material deleted successfully' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ message: 'Cannot delete material that is in use' });
        }
        console.error(err);
        res.status(500).json({ message: 'Server error deleting material' });
    }
});

// 3. Add a new drop-off point (Admin only)
app.post('/points', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { name, address, postal_code, latitude, longitude } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO drop_off_points (name, address, postal_code, latitude, longitude) VALUES (?, ?, ?, ?, ?)',
            [name, address, postal_code, latitude, longitude]
        );
        res.status(201).json({ message: `Point ${name} added successfully`, id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not add point' });
    }
});

// 3b. Update a drop-off point (Admin only)
app.put('/points/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params;
    const { name, address, postal_code, latitude, longitude } = req.body;
    try {
        const [result] = await pool.execute(
            'UPDATE drop_off_points SET name=?, address=?, postal_code=?, latitude=?, longitude=? WHERE id=?',
            [name, address, postal_code, latitude, longitude, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Point not found' });
        }

        res.json({ message: `Point ${name} updated successfully` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not update point' });
    }
});

// 3c. Delete a drop-off point (Admin only)
app.delete('/points/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await pool.execute(
            'DELETE FROM drop_off_points WHERE id=?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Point not found' });
        }

        res.json({ message: 'Point deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not delete point' });
    }
});

// 5. Get recent logs (optional, helpful for frontend)
app.get('/logs', authenticateToken, async (req, res) => {
    try {
        let query = `
            SELECT l.id, l.weight_kg, l.logged_at, 
                   l.material_id, l.point_id,
                   m.material_name, p.name as point_name, u.username
            FROM recycling_logs l
            JOIN recyclable_types m ON l.material_id = m.id
            JOIN drop_off_points p ON l.point_id = p.id
            JOIN users u ON l.user_id = u.id
        `;

        // If user is not admin, only show their own logs? 
        // Or show all but only allow edit of own? 
        // Use user_id filter if needed. For now, showing all to all authenticated users (community feed).

        query += ` ORDER BY l.logged_at DESC LIMIT 50`;

        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching logs' });
    }
});

app.get('/logs/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT l.id, l.weight_kg, l.logged_at, 
                   l.material_id, l.point_id,
                   m.material_name, p.name as point_name, u.username
            FROM recycling_logs l
            JOIN recyclable_types m ON l.material_id = m.id
            JOIN drop_off_points p ON l.point_id = p.id
            JOIN users u ON l.user_id = u.id
            WHERE l.id = ?
        `;
        const [rows] = await pool.query(query, [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Log not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching log' });
    }
});




// 4. Submit a recycling log
app.post('/logs', authenticateToken, async (req, res) => {
    const { point_id, material_id, weight_kg } = req.body;
    const user_id = req.user.id; // Get from token
    try {
        await pool.execute(
            'INSERT INTO recycling_logs (point_id, material_id, weight_kg, user_id) VALUES (?, ?, ?, ?)',
            [point_id, material_id, weight_kg, user_id]
        );
        res.status(201).json({ message: 'Recycling log added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not add log' });
    }
});

// 4b. Update a recycling log
app.put('/logs/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { point_id, material_id, weight_kg } = req.body;
    const user = req.user;

    try {
        // Check ownership or admin
        const [logs] = await pool.query('SELECT user_id FROM recycling_logs WHERE id = ?', [id]);
        if (logs.length === 0) return res.status(404).json({ message: 'Log not found' });

        if (user.role !== 'admin' && logs[0].user_id !== user.id) {
            return res.status(403).json({ message: 'Not authorized to update this log' });
        }

        const [result] = await pool.execute(
            'UPDATE recycling_logs SET point_id=?, material_id=?, weight_kg=? WHERE id=?',
            [point_id, material_id, weight_kg, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Log not found' });
        }

        res.json({ message: 'Log updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not update log' });
    }
});

// 4c. Delete a recycling log
app.delete('/logs/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const user = req.user;

    try {
        // Check ownership or admin
        const [logs] = await pool.query('SELECT user_id FROM recycling_logs WHERE id = ?', [id]);
        if (logs.length === 0) return res.status(404).json({ message: 'Log not found' });

        if (user.role !== 'admin' && logs[0].user_id !== user.id) {
            return res.status(403).json({ message: 'Not authorized to delete this log' });
        }

        const [result] = await pool.execute(
            'DELETE FROM recycling_logs WHERE id=?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Log not found' });
        }

        res.json({ message: 'Log deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not delete log' });
    }
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});