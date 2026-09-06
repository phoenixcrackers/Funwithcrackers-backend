const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const {
  generateQuotationId,
  quotationIdToOrderId,
} = require('../utils/numberGenerator');
const {
  generateModernQuotationPDF,
  generateModernInvoicePDF,
} = require('../utils/modernPdfGenerator');

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

exports.createQuotation = async (req, res) => {
  try {
    const {
      customer_id,
      products,
      total,
      customer_type,
      customer_name,
      address,
      mobile_number,
      email,
      district,
      state,
      extra_charges,
    } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ message: 'Total must be a positive number' });
    }

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };

    if (customer_id) {
      // 1. Check gbcustomers
      let customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );

      // 2. If not found in gbcustomers, check users
      if (customerCheck.rows.length === 0) {
        customerCheck = await pool.query(
          'SELECT id, username AS customer_name, companyname, address, mobile_number, email, district, state, \'User\' AS customer_type FROM public.users WHERE id = $1',
          [customer_id]
        );
      }

      if (customerCheck.rows.length === 0) {
        // Fallback: if customer details were provided directly in body, use them
        if (!customer_name) {
          return res.status(404).json({ message: 'Customer not found' });
        }
      } else {
        const row = customerCheck.rows[0];
        finalCustomerType = customer_type || row.customer_type || 'User';
        customerDetails = {
          customer_name: row.customer_name,
          company_name: row.companyname || '',
          address: row.address,
          mobile_number: row.mobile_number,
          email: row.email,
          district: row.district,
          state: row.state,
        };
      }
    } else {
      if (!customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!address) return res.status(400).json({ message: 'Address is required' });
      if (!district) return res.status(400).json({ message: 'District is required' });
      if (!state) return res.status(400).json({ message: 'State is required' });
      if (!mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
    }

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    // Generate year-based sequential quotation ID: e.g. 2026QUO1
    const est_id = await generateQuotationId(pool);

    const { pdfPath, calculatedTotal } = await generateModernQuotationPDF(
      { est_id, customer_type: finalCustomerType, total, created_at: new Date() },
      customerDetails,
      products,
      extra_charges || {}
    );

    const query = `
      INSERT INTO public.quotations (customer_id, est_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, extra_charges)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14)
      RETURNING id, created_at, customer_type, pdf, est_id
    `;
    const values = [
      customer_id || null,
      est_id,
      JSON.stringify(products),
      calculatedTotal,
      customerDetails.address || null,
      customerDetails.mobile_number || null,
      customerDetails.customer_name || null,
      customerDetails.email || null,
      customerDetails.district || null,
      customerDetails.state || null,
      finalCustomerType,
      'pending',
      pdfPath,
      JSON.stringify(extra_charges || {})
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      message: 'Quotation created successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      est_id: result.rows[0].est_id,
      total: calculatedTotal,
      customer_name: customerDetails.customer_name,
      status: 'pending',
    });
  } catch (err) {
    console.error('Error creating quotation:', err);
    res.status(500).json({ message: 'Failed to create quotation', error: err.message });
  }
};

exports.editQuotation = async (req, res) => {
  try {
    const { est_id } = req.params;
    const { products, total, extra_charges } = req.body;

    if (!est_id || !/^[a-zA-Z0-9-_]+$/.test(est_id)) {
      return res.status(400).json({ message: 'Valid est_id is required' });
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    const quotationQuery = await pool.query(
      'SELECT customer_id, customer_name, address, mobile_number, email, district, state, customer_type, status, products, created_at FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    if (quotationQuery.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Quotation is not in pending status' });
    }

    const { customer_name, address, mobile_number, email, district, state, customer_type, created_at } = quotationQuery.rows[0];

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    const { pdfPath, calculatedTotal } = await generateModernQuotationPDF(
      { est_id, customer_type, total, created_at },
      { customer_name, address, mobile_number, email, district, state },
      products,
      extra_charges || {}
    );

    const query = `
      UPDATE public.quotations
      SET products = $1, total = $2, pdf = $3, extra_charges = $4
      WHERE est_id = $5
      RETURNING id, created_at, customer_type, pdf, est_id
    `;
    const values = [
      JSON.stringify(products),
      calculatedTotal,
      pdfPath,
      JSON.stringify(extra_charges || {}),
      est_id,
    ];
    const result = await pool.query(query, values);

    res.status(200).json({
      message: 'Quotation updated successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      est_id: result.rows[0].est_id,
      total: calculatedTotal,
    });
  } catch (err) {
    console.error('Error in editQuotation:', err);
    res.status(500).json({ message: 'Failed to update quotation', error: err.message });
  }
};

exports.getQuotations = async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM public.quotations
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quotations', error: err.message });
  }
};

exports.getQuotation = async (req, res) => {
  try {
    let { est_id } = req.params;

    if (est_id.endsWith('.pdf')) {
      est_id = est_id.replace(/\.pdf$/, '');
    }

    if (!est_id || !/^[a-zA-Z0-9-_]+$/.test(est_id)) {
      return res.status(400).json({ 
        message: 'Invalid est_id format', 
        details: 'Quotation ID must contain alphanumeric characters, hyphens, or underscores' 
      });
    }

    let quotationQuery = await pool.query(
      'SELECT products, COALESCE(total, 0) AS total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id, extra_charges, created_at FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    // Fallback search for legacy EST- formats
    if (quotationQuery.rows.length === 0 && est_id.startsWith('EST')) {
      const parts = est_id.split('-');
      if (parts.length > 1) {
        const possibleEstId = parts.slice(1).join('-');
        quotationQuery = await pool.query(
          'SELECT products, COALESCE(total, 0) AS total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id, extra_charges, created_at FROM public.quotations WHERE est_id = $1',
          [`EST-${possibleEstId}`]
        );
      }
    }

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Quotation not found', 
        details: `No quotation found for ID '${est_id}'.`
      });
    }

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id: foundEstId, extra_charges, created_at } = quotationQuery.rows[0];

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

    // Always generate modern PDF to guarantee consistent luxury layout
    const generated = await generateModernQuotationPDF(
      { est_id: foundEstId, customer_type, total, created_at },
      { customer_name, address, mobile_number, email, district, state },
      parsedProducts,
      parsedExtras
    );
    const currentPdfPath = generated.pdfPath;
    await pool.query('UPDATE public.quotations SET pdf = $1 WHERE est_id = $2', [currentPdfPath, foundEstId]);

    const safeCustomer = (customer_name || 'customer').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${safeCustomer}-${foundEstId}.pdf`);
    fs.createReadStream(currentPdfPath).pipe(res);
  } catch (err) {
    console.error('Error fetching quotation PDF:', err);
    res.status(500).json({ message: 'Failed to fetch quotation', error: err.message });
  }
};

exports.bookQuotation = async (req, res) => {
  const client = await pool.connect();
  try {
    const { est_id, customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, extra_charges } = req.body;

    if (!est_id || !/^[a-zA-Z0-9-_]+$/.test(est_id)) {
      return res.status(400).json({ message: 'Valid est_id is required' });
    }

    const quotationQuery = await client.query(
      'SELECT customer_id, products, total, customer_name, address, mobile_number, email, district, state, customer_type, status, extra_charges, created_at FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    if (quotationQuery.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Quotation is not in pending status' });
    }

    const dbRow = quotationQuery.rows[0];

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    let finalCustomerType = customer_type || dbRow.customer_type || 'User';
    let customerDetails = {
      customer_name: customer_name || dbRow.customer_name,
      address: address || dbRow.address,
      mobile_number: mobile_number || dbRow.mobile_number,
      email: email || dbRow.email,
      district: district || dbRow.district,
      state: state || dbRow.state,
    };

    let finalCustomerId = customer_id || dbRow.customer_id;

    if (finalCustomerId) {
      let customerCheck = await client.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [finalCustomerId]
      );
      if (customerCheck.rows.length === 0) {
        customerCheck = await client.query(
          'SELECT id, username AS customer_name, companyname, address, mobile_number, email, district, state, \'User\' AS customer_type FROM public.users WHERE id = $1',
          [finalCustomerId]
        );
      }
      if (customerCheck.rows.length > 0) {
        const row = customerCheck.rows[0];
        finalCustomerType = customer_type || row.customer_type || finalCustomerType;
        customerDetails = {
          customer_name: row.customer_name,
          address: row.address || customerDetails.address,
          mobile_number: row.mobile_number || customerDetails.mobile_number,
          email: row.email || customerDetails.email,
          district: row.district || customerDetails.district,
          state: row.state || customerDetails.state,
        };
      }
    }

    // Validate products and check stock availability
    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await client.query(
        `SELECT id, stock FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
      if (quantity > productCheck.rows[0].stock) {
        return res.status(400).json({ message: `Insufficient stock for product ${id} of type ${product_type}` });
      }
    }

    // Exact matching order number: e.g. 2026QUO1 -> 2026ORD1
    const order_id = quotationIdToOrderId(est_id);

    // Start transaction
    await client.query('BEGIN');

    // Update stock for each product
    for (const product of products) {
      const { id, product_type, quantity } = product;
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      await client.query(`UPDATE public.${tableName} SET stock = stock - $1 WHERE id = $2`, [quantity, id]);
    }

    // Generate modern invoice PDF
    const pdfResult = await generateModernInvoicePDF(
      { order_id, customer_type: finalCustomerType, total, est_id, created_at: new Date() },
      customerDetails,
      products,
      extra_charges || (dbRow.extra_charges ? JSON.parse(dbRow.extra_charges) : {})
    );

    const query = `
      INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, extra_charges)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14)
      RETURNING id, created_at, customer_type, pdf, order_id
    `;
    const values = [
      finalCustomerId || null,
      order_id,
      JSON.stringify(products),
      parseFloat(total),
      customerDetails.address || null,
      customerDetails.mobile_number || null,
      customerDetails.customer_name || null,
      customerDetails.email || null,
      customerDetails.district || null,
      customerDetails.state || null,
      finalCustomerType,
      'booked',
      pdfResult.pdfPath,
      JSON.stringify(extra_charges || {})
    ];
    const result = await client.query(query, values);

    await client.query('UPDATE public.quotations SET status = $1 WHERE est_id = $2', ['booked', est_id]);

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Booking created successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      order_id: result.rows[0].order_id,
      est_id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error booking quotation:', err);
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  } finally {
    client.release();
  }
};

exports.cancelQuotation = async (req, res) => {
  try {
    const { est_id } = req.params;

    const quotationQuery = await pool.query(
      'SELECT id, status, products FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotation = quotationQuery.rows[0];
    if (quotation.status === 'canceled') {
      return res.status(400).json({ message: 'Quotation is already canceled' });
    }

    // If quotation was booked, restock the product quantities and cancel matching booking
    if (quotation.status === 'booked') {
      let products = [];
      try {
        products = typeof quotation.products === 'string' ? JSON.parse(quotation.products) : quotation.products;
      } catch {
        products = [];
      }
      if (Array.isArray(products)) {
        for (const product of products) {
          const { id, product_type, quantity } = product;
          if (!id || !quantity) continue;
          const tableName = (product_type || 'gift_box_dealers').toLowerCase().replace(/\s+/g, '_');
          try {
            await pool.query(
              `UPDATE public.${tableName} SET stock = stock + $1 WHERE id = $2`,
              [Number(quantity), Number(id)]
            );
          } catch (stockErr) {
            console.warn(`Could not restore stock for ${tableName}:`, stockErr.message);
          }
        }
      }

      const order_id = quotationIdToOrderId(est_id);
      await pool.query(
        "UPDATE public.dbooking SET status = 'cancelled' WHERE order_id = $1",
        [order_id]
      );
    }

    await pool.query('UPDATE public.quotations SET status = $1 WHERE est_id = $2', ['canceled', est_id]);

    res.status(200).json({ message: 'Quotation canceled successfully and stock restored' });
  } catch (err) {
    console.error('Error canceling quotation:', err);
    res.status(500).json({ message: 'Failed to cancel quotation', error: err.message });
  }
};

// Delete Quotation (with booking + stock restore if booked)
exports.deleteQuotation = async (req, res) => {
  const client = await pool.connect();
  try {
    const { est_id } = req.params;

    if (!est_id) {
      return res.status(400).json({ message: 'Valid est_id is required' });
    }

    await client.query('BEGIN');

    // 1. Get quotation
    const quotationRes = await client.query(
      `SELECT est_id, status, products, pdf 
       FROM public.quotations 
       WHERE est_id = $1`,
      [est_id]
    );

    if (quotationRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotation = quotationRes.rows[0];

    // Parse products safely
    let products = [];
    try {
      products = typeof quotation.products === 'string'
        ? JSON.parse(quotation.products)
        : quotation.products;
    } catch {
      products = [];
    }
    if (!Array.isArray(products)) products = [];

    // 2. If booked -> remove booking + restore stock
    if (quotation.status === 'booked') {
      const order_id = quotationIdToOrderId(est_id);

      const bookingRes = await client.query(
        `SELECT id FROM public.dbooking WHERE order_id = $1`,
        [order_id]
      );

      if (bookingRes.rows.length > 0) {
        for (const product of products) {
          const { id, product_type, quantity } = product;
          if (!id || !product_type || !quantity) continue;

          const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
          const productId = parseInt(id, 10);
          if (Number.isNaN(productId)) continue;

          try {
            await client.query(
              `UPDATE public.${tableName} 
               SET stock = stock + $1 
               WHERE id = $2`,
              [quantity, productId]
            );
          } catch (stockErr) {
            console.warn(`Could not restore stock for ${tableName}:`, stockErr.message);
          }
        }

        await client.query(`DELETE FROM public.dbooking WHERE order_id = $1`, [order_id]);
      }
    }

    // 3. Delete quotation
    await client.query(`DELETE FROM public.quotations WHERE est_id = $1`, [est_id]);

    // 4. Delete PDF if exists
    if (quotation.pdf && fs.existsSync(quotation.pdf)) {
      try {
        fs.unlinkSync(quotation.pdf);
      } catch (fileErr) {
        console.warn('Could not delete quotation PDF file:', fileErr.message);
      }
    }

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Quotation (and booking if exists) deleted successfully, stock restored',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in deleteQuotation:', err);
    res.status(500).json({
      message: 'Failed to delete quotation',
      error: err.message,
    });
  } finally {
    client.release();
  }
};