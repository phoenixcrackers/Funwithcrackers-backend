const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  max: 20,               // ← lower from 30 — Render free/hobby tiers have low connection limits
  connectionTimeoutMillis: 5000,   // fail fast if can't connect
  idleTimeoutMillis: 10000,        // release connections after 10s idle
  allowExitOnIdle: true,
});

exports.addGiftBoxProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const { serial_number, productname, price, per, discount, stock, product_type, existingImages } = req.body;
    const files = req.files || [];

    if (!serial_number || !productname || !price || !per || !discount || !product_type || stock === undefined || stock === null) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (product_type.toLowerCase().replace(/\s+/g, '_') !== 'gift_box_dealers') {
      return res.status(400).json({ message: 'Invalid product type for gift box dealers' });
    }

    if (!['pieces', 'box', 'pkt'].includes(per)) {
      return res.status(400).json({ message: 'Valid per value (pieces, box, or pkt) is required' });
    }

    const priceNum = Number.parseFloat(price);
    const discountNum = Number.parseFloat(discount);
    const stockNum = Number.parseInt(stock);

    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: 'Price must be a valid positive number' });
    }
    if (isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
      return res.status(400).json({ message: 'Discount must be between 0 and 100%' });
    }
    if (isNaN(stockNum) || stockNum < 0) {
      return res.status(400).json({ message: 'Stock cannot be negative' });
    }

    // Parse existingImages if provided
    const finalImages = existingImages
      ? typeof existingImages === 'string'
        ? JSON.parse(existingImages)
        : existingImages
      : [];

    // Add Cloudinary URLs from uploaded files
    finalImages.push(...files.map((file) => file.path));

    const tableName = 'gift_box_dealers';

    const typeCheck = await client.query(
      'SELECT product_type FROM public.products WHERE product_type = $1',
      [product_type]
    );

    if (typeCheck.rows.length === 0) {
      await client.query(
        'INSERT INTO public.products (product_type) VALUES ($1)',
        [product_type]
      );

      const tableSchema = `
        CREATE TABLE IF NOT EXISTS public.${tableName} (
          id SERIAL PRIMARY KEY,
          serial_number VARCHAR(50) NOT NULL,
          productname VARCHAR(100) NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          per VARCHAR(10) NOT NULL CHECK (per IN ('pieces', 'box', 'pkt')),
          discount NUMERIC(5,2) NOT NULL,
          stock INTEGER NOT NULL DEFAULT 0,
          image TEXT,
          status VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (status IN ('on', 'off')),
          fast_running BOOLEAN DEFAULT false
        )
      `;
      await client.query(tableSchema);

      const stockHistorySchema = `
        CREATE TABLE IF NOT EXISTS public.gift_box_dealers_stock_history (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES public.${tableName}(id) ON DELETE CASCADE,
          quantity_added INTEGER NOT NULL CHECK (quantity_added > 0),
          added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await client.query(stockHistorySchema);
    }

    const duplicateCheck = await client.query(
      `SELECT id FROM public.${tableName} 
       WHERE serial_number = $1 OR productname = $2`,
      [serial_number, productname]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Product already exists' });
    }

    const query = `
      INSERT INTO public.${tableName} (serial_number, productname, price, per, discount, stock, image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    const values = [
      serial_number,
      productname,
      priceNum,
      per,
      discountNum,
      stockNum,
      finalImages.length > 0 ? JSON.stringify(finalImages) : null,
      'off',
    ];

    const result = await client.query(query, values);
    res.status(201).json({ message: 'Product saved successfully', id: result.rows[0].id });
  } catch (err) {
    console.error('Error in addGiftBoxProduct:', err);
    res.status(500).json({ message: 'Failed to save product', error: err.message });
  } finally {
    client.release();
  }
};

exports.updateGiftBoxProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { serial_number, productname, price, per, discount, stock, status, existingImages } = req.body;
    const files = req.files || [];

    if (!serial_number || !productname || !price || !per || !discount || stock === undefined || stock === null) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (!['pieces', 'box', 'pkt'].includes(per)) {
      return res.status(400).json({ message: 'Valid per value (pieces, box, or pkt) is required' });
    }

    const priceNum = Number.parseFloat(price);
    const discountNum = Number.parseFloat(discount);
    const stockNum = Number.parseInt(stock);

    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: 'Price must be a valid positive number' });
    }
    if (isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
      return res.status(400).json({ message: 'Discount must be between 0 and 100%' });
    }
    if (isNaN(stockNum) || stockNum < 0) {
      return res.status(400).json({ message: 'Stock cannot be negative' });
    }

    // Parse existingImages if provided
    let finalImages = [];
    if (existingImages) {
      try {
        finalImages = typeof existingImages === 'string' ? JSON.parse(existingImages) : existingImages;
      } catch (e) {
        console.error('Error parsing existing images:', e);
        finalImages = [];
      }
    }

    // Add new Cloudinary URLs from uploaded files
    if (files.length > 0) {
      finalImages = [...finalImages, ...files.map((file) => file.path)];
    }

    // Delete removed images from Cloudinary
    const currentProduct = await client.query(
      `SELECT image FROM public.gift_box_dealers WHERE id = $1`,
      [id]
    );
    if (currentProduct.rows.length > 0 && currentProduct.rows[0].image) {
      const currentImages = JSON.parse(currentProduct.rows[0].image) || [];
      const imagesToDelete = currentImages.filter((url) => !finalImages.includes(url));
      for (const url of imagesToDelete) {
        const publicId = url.match(/\/mnc_products\/(.+?)\./)?.[1];
        if (publicId) {
          await cloudinary.uploader.destroy(`hifi_products/${publicId}`, {
            resource_type: url.includes('/video/') ? 'video' : 'image',
          });
        }
      }
    }

    let query = `
      UPDATE public.gift_box_dealers 
      SET serial_number = $1, productname = $2, price = $3, per = $4, discount = $5, stock = $6
    `;
    const values = [serial_number, productname, priceNum, per, discountNum, stockNum];
    let paramIndex = 7;

    query += `, image = $${paramIndex}`;
    values.push(finalImages.length > 0 ? JSON.stringify(finalImages) : null);
    paramIndex++;

    if (status && ['on', 'off'].includes(status)) {
      query += `, status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    query += ` WHERE id = $${paramIndex} RETURNING id`;
    values.push(id);

    const result = await client.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('Error in updateGiftBoxProduct:', err);
    res.status(500).json({ message: 'Failed to update product', error: err.message });
  } finally {
    client.release();
  }
};

exports.deleteGiftBoxProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    const result = await client.query(
      `SELECT image FROM public.gift_box_dealers WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Delete images from Cloudinary
    if (result.rows[0].image) {
      const images = JSON.parse(result.rows[0].image) || [];
      for (const url of images) {
        const publicId = url.match(/\/mnc_products\/(.+?)\./)?.[1];
        if (publicId) {
          await cloudinary.uploader.destroy(`mnc_products/${publicId}`, {
            resource_type: url.includes('/video/') ? 'video' : 'image',
          });
        }
      }
    }

    const query = `DELETE FROM public.gift_box_dealers WHERE id = $1 RETURNING id`;
    const deleteResult = await client.query(query, [id]);
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error in deleteGiftBoxProduct:', err);
    res.status(500).json({ message: 'Failed to delete product', error: err.message });
  } finally {
    client.release();
  }
};

// Unchanged functions
exports.bookProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Valid quantity is required' });
    }

    const product = await pool.query(
      `SELECT stock FROM public.gift_box_dealers WHERE id = $1`,
      [id]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const currentStock = product.rows[0].stock;
    if (quantity > currentStock) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    const newStock = currentStock - quantity;
    await pool.query(
      `UPDATE public.gift_box_dealers SET stock = $1 WHERE id = $2`,
      [newStock, id]
    );

    res.status(200).json({ message: 'Product booked successfully', newStock });
  } catch (err) {
    console.error('Error in bookProduct:', err);
    res.status(500).json({ message: 'Failed to book product', error: err.message });
  }
};

exports.toggleGiftBoxFastRunning = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT fast_running FROM public.gift_box_dealers WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const current = result.rows[0].fast_running;
    const updated = !current;

    await pool.query(
      `UPDATE public.gift_box_dealers SET fast_running = $1 WHERE id = $2`,
      [updated, id]
    );

    res.status(200).json({ message: 'Fast running status updated', fast_running: updated });
  } catch (err) {
    console.error('Error in toggleGiftBoxFastRunning:', err);
    res.status(500).json({ message: 'Failed to update fast running status', error: err.message });
  }
};

exports.getGiftBoxProducts = async (req, res) => {
  try {
    const query = `
      SELECT id, serial_number, productname, price, per, discount, stock, image, status, fast_running
      FROM public.gift_box_dealers
    `;
    const result = await pool.query(query);
    const products = result.rows.map(row => ({
      id: row.id,
      product_type: 'gift_box_dealers',
      serial_number: row.serial_number,
      productname: row.productname,
      price: row.price,
      per: row.per,
      discount: row.discount,
      stock: row.stock,
      image: row.image,
      status: row.status,
      fast_running: row.fast_running
    }));

    res.status(200).json(products);
  } catch (err) {
    console.error('Error in getGiftBoxProducts:', err);
    res.status(500).json({ message: 'Failed to fetch gift box products', error: err.message });
  }
};

exports.toggleGiftBoxProductStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const currentStatusQuery = `SELECT status FROM public.gift_box_dealers WHERE id = $1`;
    const currentStatusResult = await pool.query(currentStatusQuery, [id]);

    if (currentStatusResult.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const currentStatus = currentStatusResult.rows[0].status;
    const newStatus = currentStatus === 'on' ? 'off' : 'on';

    const updateQuery = `UPDATE public.gift_box_dealers SET status = $1 WHERE id = $2 RETURNING id, status`;
    const updateResult = await pool.query(updateQuery, [newStatus, id]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ message: 'Status toggled successfully', status: newStatus });
  } catch (err) {
    console.error('Error in toggleGiftBoxProductStatus:', err);
    res.status(500).json({ message: 'Failed to toggle status', error: err.message });
  }
};

exports.addStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Valid quantity is required' });
    }

    const product = await pool.query(
      `SELECT stock FROM public.gift_box_dealers WHERE id = $1`,
      [id]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const currentStock = product.rows[0].stock;
    const newStock = currentStock + parseInt(quantity);

    await pool.query('BEGIN');

    await pool.query(
      `UPDATE public.gift_box_dealers SET stock = $1 WHERE id = $2`,
      [newStock, id]
    );

    await pool.query(
      `INSERT INTO public.gift_box_dealers_stock_history (product_id, quantity_added, added_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [id, parseInt(quantity)]
    );

    await pool.query('COMMIT');

    res.status(200).json({ message: 'Stock added successfully', newStock });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error in addStock:', err);
    res.status(500).json({ message: 'Failed to add stock', error: err.message });
  }
};

exports.getStockHistory = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT id, quantity_added, added_at
      FROM public.gift_box_dealers_stock_history
      WHERE product_id = $1
      ORDER BY added_at DESC
    `;
    const result = await pool.query(query, [id]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error in getStockHistory:', err);
    res.status(500).json({ message: 'Failed to fetch stock history', error: err.message });
  }
};