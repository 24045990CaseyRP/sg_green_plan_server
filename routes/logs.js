const express = require('express');
const router = express.Router();

module.exports = (pool, authenticateToken) => {

    // Get recent logs
    router.get('/', authenticateToken, async (req, res) => {
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

    // Get specific log
    router.get('/:id', authenticateToken, async (req, res) => {
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

    // Submit a recycling log
    router.post('/', authenticateToken, async (req, res) => {
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

    // Update a recycling log
    router.put('/:id', authenticateToken, async (req, res) => {
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

    // Delete a recycling log
    router.delete('/:id', authenticateToken, async (req, res) => {
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

    return router;
};
