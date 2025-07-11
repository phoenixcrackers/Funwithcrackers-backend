const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'Uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: './Uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

router.post('/banners/upload', upload.array('images', 10), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const results = [];
    for (const file of files) {
      const imagePath = `/Uploads/${file.filename}`;
      const insertQuery = `
        INSERT INTO banners (image_url, is_active)
        VALUES ($1, $2)
        RETURNING *;
      `;
      const { rows } = await pool.query(insertQuery, [imagePath, false]);
      results.push(rows[0]);
    }

    res.status(201).json(results);
  } catch (err) {
    console.error('Error uploading banners:', err.message);
    res.status(500).json({ error: 'Failed to upload banners' });
  }
});

router.get('/banners', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM banners ORDER BY uploaded_at DESC');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});
router.delete('/banners/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query('SELECT image_url FROM banners WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    const imagePath = path.join(__dirname, '..', rows[0].image_url);

    await pool.query('DELETE FROM banners WHERE id = $1', [id]);

    fs.unlink(imagePath, (err) => {
      if (err) {
        console.warn('File deletion failed:', err.message);
      }
    });

    res.json({ message: 'Banner deleted successfully' });
  } catch (err) {
    console.error('Delete banner failed:', err.message);
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

router.patch('/banners/:id', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE banners SET is_active = $1 WHERE id = $2 RETURNING *',
      [is_active, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Failed to update banner status' });
  }
});

module.exports = router;