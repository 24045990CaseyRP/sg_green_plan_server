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

// Get all drop-off points
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
        console.error("Error fetching drop-off points:", err);
        res.status(500).json({ message: 'Server error fetching points' });
    }
});

// Add a new drop-off point (Admin only)
app.post('/points', authenticateToken, authorizeRole(['admin']), async (req, res) => {
    const { name, address, postal_code, latitude, longitude } = req.body;
    try {
        const [result] = await pool.execute(
            'INSERT INTO drop_off_points (name, address, postal_code, latitude, longitude) VALUES (?, ?, ?, ?, ?)',
            [name, address, postal_code, latitude, longitude]
        );
        res.status(201).json({ message: `Point ${name} added successfully`, id: result.insertId });
    } catch (err) {
        console.error("Error adding drop-off point:", err);
        res.status(500).json({ message: 'Server error - could not add point' });
    }
});

// Submit a recycling log
app.post('/logs', authenticateToken, async (req, res) => {
    const { point_id, material_id, weight_kg } = req.body;

    console.log("Received data:", { point_id, material_id, weight_kg }); // Log incoming data

    const user_id = req.user.id; // Get user_id from token
    try {
        // Check if point_id exists in the drop_off_points table
        const [pointExists] = await pool.query('SELECT 1 FROM drop_off_points WHERE id = ?', [point_id]);
        if (pointExists.length === 0) {
            return res.status(400).json({ message: "Invalid point_id" });
        }

        // Check if material_id exists in the recyclable_types table
        const [materialExists] = await pool.query('SELECT 1 FROM recyclable_types WHERE id = ?', [material_id]);
        if (materialExists.length === 0) {
            return res.status(400).json({ message: "Invalid material_id" });
        }

        // If both exist, insert the log
        await pool.execute(
            'INSERT INTO recycling_logs (point_id, material_id, weight_kg, user_id) VALUES (?, ?, ?, ?)',
            [point_id, material_id, weight_kg, user_id]
        );
        res.status(201).json({ message: 'Recycling log added successfully' });
    } catch (err) {
        console.error("Error adding log:", err);
        res.status(500).json({ message: 'Server error - could not add log' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});