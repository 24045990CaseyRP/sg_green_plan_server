const express = require('express');
const router = express.Router();

module.exports = (pool, authenticateToken, authorizeRole) => {

    // Get all drop-off points
    router.get('/', authenticateToken, async (req, res) => {
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
    router.post('/', authenticateToken, authorizeRole(['admin']), async (req, res) => {
        const { name, address, postal_code, latitude, longitude, status } = req.body;
        try {
            const [result] = await pool.execute(
                'INSERT INTO drop_off_points (name, address, postal_code, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, ?)',
                [name, address, postal_code, latitude, longitude, status || 'Active']
            );
            res.status(201).json({ message: `Point ${name} added successfully`, id: result.insertId });
        } catch (err) {
            console.error("Error adding drop-off point:", err);
            res.status(500).json({ message: 'Server error - could not add point' });
        }
    });

    // Update a drop-off point (Admin only)
    router.put('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
        const { id } = req.params;
        const { name, address, postal_code, latitude, longitude, status } = req.body;
        try {
            const [result] = await pool.execute(
                'UPDATE drop_off_points SET name=?, address=?, postal_code=?, latitude=?, longitude=?, status=? WHERE id=?',
                [name, address, postal_code, latitude, longitude, status, id]
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

    // Delete a drop-off point (Admin only)
    router.delete('/:id', authenticateToken, authorizeRole(['admin']), async (req, res) => {
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

    return router;
};
