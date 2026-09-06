const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { generateOrderId } = require('../utils/numberGenerator');
const { generateModernInvoicePDF } = require('../utils/modernPdfGenerator');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  allowExitOnIdle: true,
});

exports.getCustomers = async (req, res) => {
  try {
    const gbQuery = `
      SELECT id, customer_name, customer_name AS name, address, mobile_number, email, customer_type, district, state, 'gbcustomers' AS source
      FROM public.gbcustomers
    `;
    const gbResult = await pool.query(gbQuery);

    const usersQuery = `
      SELECT id, username AS customer_name, username AS name, companyname, address, mobile_number, email, 'User' AS customer_type, district, state, 'users' AS source
      FROM public.users
    `;
    const usersResult = await pool.query(usersQuery);

    const allCustomers = [...gbResult.rows, ...usersResult.rows];
    res.status(200).json(allCustomers);
  } catch (err) {
    console.error('Failed to fetch customers:', err);
    res.status(500).json({ message: 'Failed to fetch customers' });
  }
};

exports.getProductTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT product_type FROM public.products');
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch product types' });
  }
};

exports.getProductsByType = async (req, res) => {
  try {
    const productType = 'gift_box_dealers';
    const tableName = productType.toLowerCase().replace(/\s+/g, '_');
    const query = `
      SELECT id, serial_number, productname, price, per, discount, image, status, $1 AS product_type
      FROM public.${tableName}
      WHERE status = 'on'
    `;
    const result = await pool.query(query, [productType]);
    
    const products = result.rows.map(row => ({
      id: row.id,
      product_type: row.product_type,
      serial_number: row.serial_number,
      productname: row.productname,
      price: parseFloat(row.price),
      per: row.per,
      discount: parseFloat(row.discount),
      image: row.image,
      status: row.status
    }));
    
    res.status(200).json(products);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch products', error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, payment_method, amount_paid, admin_id, extra_charges } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) return res.status(400).json({ message: 'Products array is required and must not be empty' });
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });
    if (payment_method && !['cash', 'bank'].includes(payment_method)) return res.status(400).json({ message: 'Invalid payment method' });
    if (payment_method && (!amount_paid || amount_paid <= 0)) return res.status(400).json({ message: 'Amount paid must be a positive number when payment method is provided' });
    if (payment_method && !admin_id) return res.status(400).json({ message: 'Admin ID is required when payment method is provided' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };

    if (customer_id) {
      let customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) {
        customerCheck = await pool.query(
          'SELECT id, username AS customer_name, companyname, address, mobile_number, email, district, state, \'User\' AS customer_type FROM public.users WHERE id = $1',
          [customer_id]
        );
      }
      if (customerCheck.rows.length > 0) {
        const row = customerCheck.rows[0];
        finalCustomerType = customer_type || row.customer_type || 'User';
        customerDetails = {
          customer_name: row.customer_name,
          address: row.address || customerDetails.address,
          mobile_number: row.mobile_number || customerDetails.mobile_number,
          email: row.email || customerDetails.email,
          district: row.district || customerDetails.district,
          state: row.state || customerDetails.state,
        };
      }
    } else {
      if (!customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!address) return res.status(400).json({ message: 'Address is required' });
      if (!district) return res.status(400).json({ message: 'District is required' });
      if (!state) return res.status(400).json({ message: 'State is required' });
      if (!mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
    }

    // Validate products and check stock availability
    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(`SELECT id, stock FROM public.${tableName} WHERE id = $1 AND status = 'on'`, [id]);
      if (productCheck.rows.length === 0) return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      if (quantity > productCheck.rows[0].stock) return res.status(400).json({ message: `Insufficient stock for product ${id} of type ${product_type}` });
    }

    // Generate year-based sequential order ID: e.g. 2026ORD1
    const order_id = await generateOrderId(pool);

    // Start transaction to ensure consistency
    await pool.query('BEGIN');

    // Update stock for each product
    for (const product of products) {
      const { id, product_type, quantity } = product;
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      await pool.query(`UPDATE public.${tableName} SET stock = stock - $1 WHERE id = $2`, [quantity, id]);
    }

    const pdfResult = await generateModernInvoicePDF(
      { order_id, customer_type: finalCustomerType, total, created_at: new Date() },
      customerDetails,
      products,
      extra_charges || {}
    );

    const bookingQuery = `
      INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, payment_method, amount_paid, admin_id, extra_charges)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, $17)
      RETURNING id, created_at, customer_type, pdf, order_id
    `;
    const bookingValues = [
      customer_id || null, order_id, JSON.stringify(products), parseFloat(total),
      customerDetails.address || null, customerDetails.mobile_number || null,
      customerDetails.customer_name || null, customerDetails.email || null,
      customerDetails.district || null, customerDetails.state || null,
      finalCustomerType, 'booked', pdfResult.pdfPath, payment_method || null, parseFloat(amount_paid) || 0, admin_id || null,
      JSON.stringify(extra_charges || {})
    ];
    const bookingResult = await pool.query(bookingQuery, bookingValues);

    if (payment_method && amount_paid) {
      const transactionQuery = `
        INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `;
      const transactionValues = [bookingResult.rows[0].id, parseFloat(amount_paid), payment_method, admin_id];
      await pool.query(transactionQuery, transactionValues);
    }

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Booking created successfully',
      id: bookingResult.rows[0].id,
      created_at: bookingResult.rows[0].created_at,
      customer_type: bookingResult.rows[0].customer_type,
      pdf_path: bookingResult.rows[0].pdf,
      order_id: bookingResult.rows[0].order_id
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error in Direct createBooking:', err);
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    let { order_id } = req.params;

    if (order_id.endsWith('.pdf')) {
      order_id = order_id.replace(/\.pdf$/, '');
    }

    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) {
      return res.status(400).json({
        message: 'Invalid order_id format',
        details: 'Order ID must contain alphanumeric characters, hyphens, or underscores'
      });
    }

    let bookingQuery = await pool.query(
      'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id, extra_charges, created_at FROM public.dbooking WHERE order_id = $1',
      [order_id]
    );

    if (bookingQuery.rows.length === 0 && order_id.startsWith('DORD')) {
      const parts = order_id.split('-');
      if (parts.length > 1) {
        const possibleOrderId = parts.slice(1).join('-');
        bookingQuery = await pool.query(
          'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id, extra_charges, created_at FROM public.dbooking WHERE order_id = $1',
          [`DORD-${possibleOrderId}`]
        );
      }
    }

    if (bookingQuery.rows.length === 0) {
      return res.status(404).json({
        message: 'Invoice not found',
        details: `No booking found for order_id '${order_id}'.`
      });
    }

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id: foundOrderId, extra_charges, created_at } = bookingQuery.rows[0];

    let currentPdfPath = pdf;
    if (!currentPdfPath || !fs.existsSync(currentPdfPath)) {
      let parsedProducts = [];
      try {
        parsedProducts = typeof products === 'string' ? JSON.parse(products) : products;
      } catch {
        parsedProducts = [];
      }

      let parsedExtras = {};
      try {
        parsedExtras = typeof extra_charges === 'string' ? JSON.parse(extra_charges) : (extra_charges || {});
      } catch {
        parsedExtras = {};
      }

      const regenerated = await generateModernInvoicePDF(
        { order_id: foundOrderId, customer_type, total, created_at },
        { customer_name, address, mobile_number, email, district, state },
        parsedProducts,
        parsedExtras
      );
      currentPdfPath = regenerated.pdfPath;
      await pool.query('UPDATE public.dbooking SET pdf = $1 WHERE order_id = $2', [currentPdfPath, foundOrderId]);
    }

    const safeCustomerName = (customer_name || 'customer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${safeCustomerName}-${foundOrderId}.pdf`);
    fs.createReadStream(currentPdfPath).pipe(res);
  } catch (err) {
    console.error('Error in Direct getInvoice:', err);
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
  }
};