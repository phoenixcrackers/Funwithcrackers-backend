const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  max: 20,               // ← lower from 30 — Render free/hobby tiers have low connection limits
  connectionTimeoutMillis: 5000,   // fail fast if can't connect
  idleTimeoutMillis: 10000,        // release connections after 10s idle
  allowExitOnIdle: true,           // helps in some node-postgres versions
  // Very important on Render — forces SSL
  ssl: {
    rejectUnauthorized: false     // Render uses self-signed certs
  }
});

exports.getAgents = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, customer_name AS name FROM public.customers WHERE customer_type = 'Agent'"
    );
    console.log('Agents fetched:', result.rows);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agents:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};