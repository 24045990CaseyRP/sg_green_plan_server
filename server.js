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
            if (!origin) return callback(null, true); // Allow requests with no origin (e.g., Postman)
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

if (fs.existsSync('./ca.pem')) {
    dbConfig.ssl = {
        ca: fs.readFileSync('./ca.pem'),
        rejectUnauthorized: false
    };
    console.log('SSL Certificate found and loaded.');
} else {
    console.log('Warning: ca.pem not found. Connecting without specific SSL CA config (might fail for Aiven).');
    dbConfig.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(dbConfig);

app.use(express.json());

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401); // No token, unauthorized

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error("JWT verification failed:", err); // Log any errors
            return res.sendStatus(403); // Invalid token, forbidden
        }
        req.user = user; // Attach user info from token to the request object
        next();
    });
};

// Middleware to authorize roles
const authorizeRole = (roles) => {
    return (req, res, next) => {
        console.log("User Role:", req.user?.role);  // Log the user's role for debugging
        if (!roles.includes(req.user.role)) {
            console.log("Access denied: User does not have the required role");
            return res.status(403).json({ message: 'Access denied' });
        }
        next();
    };
};

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
        console.error("Error during login:", err);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// Register Route
app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        // Check if user already exists
        const [existingUsers] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const userRole = (role && ['user', 'admin'].includes(role)) ? role : 'user';

        // Insert new user
        const [result] = await pool.execute(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, userRole]
        );

        res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
    } catch (err) {
        console.error("Error during registration:", err);
        res.status(500).json({ message: 'Server error during registration' });
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

// Import and use routes
const pointsRoutes = require('./routes/points');
const logsRoutes = require('./routes/logs');

app.use('/points', pointsRoutes(pool, authenticateToken, authorizeRole));
app.use('/logs', logsRoutes(pool, authenticateToken));

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});