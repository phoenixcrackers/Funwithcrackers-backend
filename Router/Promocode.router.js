const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const isRemoteDb = process.env.PGHOST && !['localhost', '127.0.0.1'].includes(process.env.PGHOST);

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  max: 20,               // lower from 30 — Render free/hobby tiers have low connection limits
  connectionTimeoutMillis: 5000,   // fail fast if can't connect
  idleTimeoutMillis: 10000,        // release connections after 10s idle
  allowExitOnIdle: true,           // helps in some node-postgres versions
  ssl: isRemoteDb ? { rejectUnauthorized: false } : false
});

// Auto-migrate: ensure 'exceptions' column exists in promocodes table
pool.query('ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS exceptions TEXT')
  .then(() => {
    console.log('Verified promocodes exceptions column.');
  })
  .catch((err) => {
    console.log('Notice: promocodes exceptions column check:', err.message);
  });

const formatPromoRow = (row) => {
  if (!row) return row;
  let parsedExceptions = [];
  if (row.exceptions) {
    if (Array.isArray(row.exceptions)) {
      parsedExceptions = row.exceptions;
    } else if (typeof row.exceptions === 'string') {
      const trimmed = row.exceptions.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) parsedExceptions = parsed;
        } catch (e) {
          parsedExceptions = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
        }
      } else {
        parsedExceptions = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
  }
  return {
    ...row,
    exceptions: parsedExceptions,
  };
};

// GET all promocodes
router.get('/promocodes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM promocodes ORDER BY id DESC');
    res.json(result.rows.map(formatPromoRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET unique product types, excluding 'gift_box_dealers'
router.get('/product-types', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT product_type FROM public.products WHERE product_type != 'gift_box_dealers' ORDER BY product_type"
    );
    res.json(result.rows.map((row) => row.product_type));
  } catch (err) {
    console.error('Failed to fetch product types:', err.message);
    res.status(500).json({ message: 'Failed to fetch product types', error: err.message });
  }
});

// POST create promocode
router.post('/promocodes', async (req, res) => {
  const { code, discount, min_amount, end_date, product_type, exceptions } = req.body;
  const formattedExceptions = Array.isArray(exceptions)
    ? JSON.stringify(exceptions)
    : (typeof exceptions === 'string' ? exceptions : null);

  try {
    const result = await pool.query(
      'INSERT INTO promocodes (code, discount, min_amount, end_date, product_type, exceptions) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [code, discount, min_amount || null, end_date || null, product_type || null, formattedExceptions]
    );
    res.json(formatPromoRow(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update promocode
router.put('/promocodes/:id', async (req, res) => {
  const { id } = req.params;
  const { code, discount, min_amount, end_date, product_type, exceptions } = req.body;
  const formattedExceptions = Array.isArray(exceptions)
    ? JSON.stringify(exceptions)
    : (typeof exceptions === 'string' ? exceptions : null);

  try {
    const result = await pool.query(
      'UPDATE promocodes SET code = $1, discount = $2, min_amount = $3, end_date = $4, product_type = $5, exceptions = $6 WHERE id = $7 RETURNING *',
      [code, discount, min_amount || null, end_date || null, product_type || null, formattedExceptions, id]
    );
    res.json(formatPromoRow(result.rows[0]));
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