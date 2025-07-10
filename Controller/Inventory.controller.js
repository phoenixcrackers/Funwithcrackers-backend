const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

exports.addProduct = async (req, res) => {
  try {
    const { serial_number, productname, price, per, discount, product_type, imageBase64 } = req.body;

    if (!serial_number || !productname || !price || !per || !discount || !product_type) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (!['pieces', 'box', 'pkt'].includes(per)) {
      return res.status(400).json({ message: 'Valid per value (pieces, box, or pkt) is required' });
    }

    if (imageBase64 && !imageBase64.match(/^data:image\/(png|jpeg|jpg);base64,/)) {
      return res.status(400).json({ message: 'Invalid Base64 image format. Must be PNG or JPEG.' });
    }

    const tableName = product_type.toLowerCase().replace(/\s+/g, '_');

    const typeCheck = await pool.query(
      'SELECT product_type FROM public.products WHERE product_type = $1',
      [product_type]
    );

    if (typeCheck.rows.length === 0) {
      await pool.query(
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
          image TEXT,
          status VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (status IN ('on', 'off')),
          fast_running BOOLEAN DEFAULT false
        )
      `;
      await pool.query(tableSchema);
    }

    const duplicateCheck = await pool.query(
      `SELECT id FROM public.${tableName} 
       WHERE serial_number = $1 OR productname = $2`,
      [serial_number, productname]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Product already exists' });
    }

    const query = `
      INSERT INTO public.${tableName} (serial_number, productname, price, per, discount, image, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;
    const values = [serial_number, productname, parseFloat(price), per, parseFloat(discount), imageBase64 || null, 'off'];

    const result = await pool.query(query, values);
    res.status(201).json({ message: 'Product saved successfully', id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save product' });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const { serial_number, productname, price, per, discount, status, imageBase64 } = req.body;

    if (!serial_number || !productname || !price || !per || !discount) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    if (!['pieces', 'box', 'pkt'].includes(per)) {
      return res.status(400).json({ message: 'Valid per value (pieces, box, or pkt) is required' });
    }

    if (imageBase64 && !imageBase64.match(/^data:image\/(png|jpeg|jpg);base64,/)) {
      return res.status(400).json({ message: 'Invalid Base64 image format. Must be PNG or JPEG.' });
    }

    let query = `
      UPDATE public.${tableName} 
      SET serial_number = $1, productname = $2, price = $3, per = $4, discount = $5
    `;
    const values = [serial_number, productname, parseFloat(price), per, parseFloat(discount)];
    let paramIndex = 6;

    if (imageBase64 !== undefined) {
      query += `, image = $${paramIndex}`;
      values.push(imageBase64 || null);
      paramIndex++;
    }

    if (status && ['on', 'off'].includes(status)) {
      query += `, status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    query += ` WHERE id = $${paramIndex} RETURNING id`;
    values.push(id);

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update product' });
  }
};

exports.toggleFastRunning = async (req, res) => {
  try {
    const { tableName, id } = req.params;

    const result = await pool.query(
      `SELECT fast_running FROM public.${tableName} WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const current = result.rows[0].fast_running;
    const updated = !current;

    await pool.query(
      `UPDATE public.${tableName} SET fast_running = $1 WHERE id = $2`,
      [updated, id]
    );

    res.status(200).json({ message: 'Fast running status updated', fast_running: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update fast running status' });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const typeResult = await pool.query('SELECT product_type FROM public.products WHERE product_type != $1', ['gift_box_dealers']);
    const productTypes = typeResult.rows.map(row => row.product_type);

    let allProducts = [];

    for (const productType of productTypes) {
      const tableName = productType.toLowerCase().replace(/\s+/g, '_');
      const query = `
        SELECT id, serial_number, productname, price, per, discount, image, status, fast_running
        FROM public.${tableName}
      `;
      const result = await pool.query(query);
      const products = result.rows.map(row => ({
        id: row.id,
        product_type: productType,
        serial_number: row.serial_number,
        productname: row.productname,
        price: row.price,
        per: row.per,
        discount: row.discount,
        image: row.image,
        status: row.status,
        fast_running: row.fast_running
      }));
      allProducts = [...allProducts, ...products];
    }

    res.status(200).json(allProducts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
};

exports.addProductType = async (req, res) => {
  try {
    const { product_type } = req.body;

    if (!product_type) {
      return res.status(400).json({ message: 'Product type is required' });
    }

    if (product_type.toLowerCase().replace(/\s+/g, '_') === 'gift_box_dealers') {
      return res.status(400).json({ message: 'Cannot create gift_box_dealers product type through this endpoint' });
    }

    const formattedProductType = product_type.toLowerCase().replace(/\s+/g, '_');

    const typeCheck = await pool.query(
      'SELECT product_type FROM public.products WHERE product_type = $1',
      [formattedProductType]
    );

    if (typeCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Product type already exists' });
    }

    await pool.query(
      'INSERT INTO public.products (product_type) VALUES ($1)',
      [formattedProductType]
    );

    const tableName = formattedProductType;
    const tableSchema = `
      CREATE TABLE IF NOT EXISTS public.${tableName} (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(50) NOT NULL,
        productname VARCHAR(100) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        per VARCHAR(10) NOT NULL CHECK (per IN ('pieces', 'box', 'pkt')),
        discount NUMERIC(5,2) NOT NULL,
        image TEXT,
        status VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (status IN ('on', 'off')),
        fast_running BOOLEAN DEFAULT false
      )
    `;
    await pool.query(tableSchema);

    res.status(201).json({ message: 'Product type created successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create product type' });
  }
};

exports.getProductTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT product_type FROM public.products WHERE product_type != $1', ['gift_box_dealers']);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch product types' });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params;
    if (tableName === 'gift_box_dealers') {
      return res.status(400).json({ message: 'Cannot delete gift_box_dealers products through this endpoint' });
    }
    const query = `DELETE FROM public.${tableName} WHERE id = $1 RETURNING id`;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete product' });
  }
};

exports.toggleProductStatus = async (req, res) => {
  try {
    const { tableName, id } = req.params;
    if (tableName === 'gift_box_dealers') {
      return res.status(400).json({ message: 'Cannot toggle status for gift_box_dealers through this endpoint' });
    }

    const currentStatusQuery = `SELECT status FROM public.${tableName} WHERE id = $1`;
    const currentStatusResult = await pool.query(currentStatusQuery, [id]);

    if (currentStatusResult.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const currentStatus = currentStatusResult.rows[0].status;
    const newStatus = currentStatus === 'on' ? 'off' : 'on';

    const updateQuery = `UPDATE public.${tableName} SET status = $1 WHERE id = $2 RETURNING id, status`;
    const updateResult = await pool.query(updateQuery, [newStatus, id]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ message: 'Status toggled successfully', status: newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to toggle status' });
  }
};