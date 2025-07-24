const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

router.get('/promocodes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM promocodes ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create promocode
router.post('/promocodes', async (req, res) => {
  const { code, discount, min_amount, end_date } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO promocodes (code, discount, min_amount, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, discount, min_amount, end_date]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update promocode
router.put('/promocodes/:id', async (req, res) => {
  const { id } = req.params;
  const { code, discount, min_amount, end_date } = req.body;
  try {
    const result = await pool.query(
      'UPDATE promocodes SET code = $1, discount = $2, min_amount = $3, end_date = $4 WHERE id = $5 RETURNING *',
      [code, discount, min_amount, end_date, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE promocode
router.delete('/promocodes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM promocodes WHERE id = $1', [id]);
    res.json({ message: 'Promocode deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;