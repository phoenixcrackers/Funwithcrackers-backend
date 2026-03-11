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

const loginUser = async (req, res) => {
  const { username, password } = req.body;

  try {
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT * FROM public.user WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.status(200).json({ 
      message: 'Login successful',
      username: result.rows[0].username
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  loginUser
};