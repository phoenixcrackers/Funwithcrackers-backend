const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Database connection
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

// Configure Multer to use memory (fixes Vercel crash)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Make 'upload' available in all your route files
app.locals.upload = upload;

// Remove this line completely (it caused the crash):
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes (exactly the same as before)
app.use('/api', require('./Router/Inventory.router'));
app.use('/api', require('./Router/Admin.router'));
app.use('/api/locations', require('./Router/Location.router'));
app.use('/api/directcust', require('./Router/Directcust.router'));
app.use('/api/direct', require('./Router/Direct.router'));
app.use('/api/tracking', require('./Router/Tracking.router'));
app.use('/api', require('./Router/Banner.router'));
app.use('/api', require('./Router/Promocode.router'));
app.use('/api', require('./Router/SalesAnalysis.router'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.stack || err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

// For Vercel serverless function
module.exports = app;

// Local development only
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port 5000");
  });
}
