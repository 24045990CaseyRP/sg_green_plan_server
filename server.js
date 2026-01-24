const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const port = 3000;
const cors = require("cors");

const allowedOrigins = [
    "http://localhost:3000",

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
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10, // Adjusted to a safer limit for most free-tier DBs
    queueLimit: 0,
});

app.use(express.json());

// 1. Get all drop-off points (with accepted materials)
app.get('/points', async (req, res) => {
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
app.get('/types', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM recyclable_types');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching types' });
    }
});

// 3. Add a new drop-off point
app.post('/points', async (req, res) => {
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

// 3b. Update a drop-off point
app.put('/points/:id', async (req, res) => {
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

// 3c. Delete a drop-off point
app.delete('/points/:id', async (req, res) => {
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

// 4. Submit a recycling log
app.post('/logs', async (req, res) => {
    const { user_id, point_id, material_id, weight_kg } = req.body;
    try {
        await pool.execute(
            'INSERT INTO recycling_logs (user_id, point_id, material_id, weight_kg) VALUES (?, ?, ?, ?)',
            [user_id, point_id, material_id, weight_kg]
        );
        res.status(201).json({ message: 'Recycling log added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error - could not add log' });
    }
});

// 4b. Update a recycling log (Fix typos)
app.put('/logs/:id', async (req, res) => {
    const { id } = req.params;
    const { point_id, material_id, weight_kg } = req.body;
    try {
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
app.delete('/logs/:id', async (req, res) => {
    const { id } = req.params;
    try {
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

// 5. Get recent logs (optional, helpful for frontend)
app.get('/logs', async (req, res) => {
    try {
        const query = `
            SELECT l.id, l.weight_kg, l.logged_at, 
                   m.material_name, p.name as point_name
            FROM recycling_logs l
            JOIN recyclable_types m ON l.material_id = m.id
            JOIN drop_off_points p ON l.point_id = p.id
            ORDER BY l.logged_at DESC
            LIMIT 50
        `;
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching logs' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});