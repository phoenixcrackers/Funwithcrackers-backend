const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { generateModernInvoicePDF } = require('../utils/modernPdfGenerator');
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
  allowExitOnIdle: true,
});

exports.addCustomer = async (req, res) => {
  const {
    customer_name,
    state,
    district,
    mobile_number,
    email,
    address,
    customer_type,
    agent_id,
    agent_name,
    agent_contact,
    agent_email,
    agent_state,
    agent_district,
    cust_agent_name,
    cust_agent_contact,
    cust_agent_email,
    cust_agent_address,
    cust_agent_district,
    cust_agent_state,
  } = req.body;

  try {
    let finalAgentId = agent_id;

    if (customer_type === 'Agent') {
      const agentResult = await pool.query(
        `INSERT INTO public.gbcustomers (customer_name, state, district, mobile_number, email, address, customer_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          agent_name || null,
          agent_state || null,
          agent_district || null,
          agent_contact || null,
          agent_email || null,
          address || null,
          'Agent',
        ]
      );
      finalAgentId = agentResult.rows[0].id;
      return res.status(201).json({ id: finalAgentId, message: 'Agent created successfully' });
    }

    if (customer_type === 'Customer of Selected Agent' && !agent_id) {
      return res.status(400).json({ error: 'Agent ID is required for Customer of Selected Agent.' });
    }

    let insertName, insertState, insertDistrict, insertMobile, insertEmail, insertAddress;

    if (customer_type === 'Customer of Selected Agent') {
      insertName = cust_agent_name || null;
      insertState = cust_agent_state || null;
      insertDistrict = cust_agent_district || null;
      insertMobile = cust_agent_contact || null;
      insertEmail = cust_agent_email || null;
      insertAddress = cust_agent_address || null;
    } else {
      insertName = customer_name || null;
      insertState = state || null;
      insertDistrict = district || null;
      insertMobile = mobile_number || null;
      insertEmail = email || null;
      insertAddress = address || null;
    }

    const result = await pool.query(
      `INSERT INTO public.gbcustomers (customer_name, state, district, mobile_number, email, address, customer_type, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        insertName,
        insertState,
        insertDistrict,
        insertMobile,
        insertEmail,
        insertAddress,
        customer_type || 'Customer',
        finalAgentId || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding customer:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

exports.getAgents = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, customer_name FROM public.gbcustomers WHERE customer_type = $1",
      ['Agent']
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agents:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

exports.getAllCustomers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id, c.customer_name, c.state, c.district, c.mobile_number, c.email, c.address, c.customer_type, c.agent_id,
        a.customer_name AS agent_name, a.mobile_number AS agent_mobile
      FROM public.gbcustomers c
      LEFT JOIN public.gbcustomers a ON CAST(c.agent_id AS text) = CAST(a.id AS text)
      ORDER BY c.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customers with agent join:', error.message);
    try {
      const fallback = await pool.query(
        "SELECT id, customer_name, state, district, mobile_number, email, address, customer_type, agent_id FROM public.gbcustomers ORDER BY id DESC"
      );
      res.json(fallback.rows);
    } catch (err2) {
      console.error('Error fetching customers fallback:', err2.stack);
      res.status(500).json({ error: 'Internal server error', details: err2.message });
    }
  }
};

exports.getCustomerById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        c.id, c.customer_name, c.state, c.district, c.mobile_number, c.email, c.address, c.customer_type, c.agent_id,
        a.customer_name AS agent_name, a.mobile_number AS agent_mobile, a.email AS agent_email
      FROM public.gbcustomers c
      LEFT JOIN public.gbcustomers a ON CAST(c.agent_id AS text) = CAST(a.id AS text)
      WHERE c.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching customer by id:', error.message);
    try {
      const fallback = await pool.query('SELECT * FROM public.gbcustomers WHERE id = $1', [id]);
      if (fallback.rows.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      res.json(fallback.rows[0]);
    } catch (err2) {
      console.error('Error fetching customer by id fallback:', err2.stack);
      res.status(500).json({ error: 'Internal server error', details: err2.message });
    }
  }
};

async function syncCustomerBills(customerId, oldCustomer, updatedCustomer) {
  try {
    const newName = (updatedCustomer.customer_name || oldCustomer.customer_name || '').trim();
    const newMobile = updatedCustomer.mobile_number !== undefined ? (updatedCustomer.mobile_number || '').trim() : (oldCustomer.mobile_number || '').trim();
    const newAddress = updatedCustomer.address !== undefined ? updatedCustomer.address : oldCustomer.address;
    const newDistrict = updatedCustomer.district !== undefined ? updatedCustomer.district : oldCustomer.district;
    const newState = updatedCustomer.state !== undefined ? updatedCustomer.state : oldCustomer.state;
    const newEmail = updatedCustomer.email !== undefined ? updatedCustomer.email : oldCustomer.email;

    const oldMobile = (oldCustomer.mobile_number || '').trim();
    const oldName = (oldCustomer.customer_name || '').trim();

    // 1. Fetch all bookings related to this customer (by customer_id, or by old/new mobile, or by old/new name)
    const bookingsRes = await pool.query(
      `SELECT id, order_id, customer_id, customer_name, mobile_number, email, address, district, state, customer_type, products, total, extra_charges, created_at, status, pdf
       FROM public.dbooking
       WHERE CAST(customer_id AS text) = CAST($1 AS text)
          OR (
            NULLIF($2, '') IS NOT NULL AND (
              mobile_number = $2
              OR REPLACE(COALESCE(mobile_number, ''), ' ', '') = REPLACE($2, ' ', '')
              OR RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($2, '[^0-9]', '', 'g'), 10)
            )
          )
          OR (
            NULLIF($3, '') IS NOT NULL AND (
              mobile_number = $3
              OR REPLACE(COALESCE(mobile_number, ''), ' ', '') = REPLACE($3, ' ', '')
              OR RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($3, '[^0-9]', '', 'g'), 10)
            )
          )
          OR (
            NULLIF($4, '') IS NOT NULL AND LOWER(TRIM(COALESCE(customer_name, ''))) = LOWER(TRIM($4))
          )
          OR (
            NULLIF($5, '') IS NOT NULL AND LOWER(TRIM(COALESCE(customer_name, ''))) = LOWER(TRIM($5))
          )`,
      [customerId, oldMobile, newMobile, oldName, newName]
    );

    for (const booking of bookingsRes.rows) {
      try {
        let products = [];
        try {
          products = typeof booking.products === 'string' ? JSON.parse(booking.products) : (booking.products || []);
        } catch {
          products = [];
        }

        let extraCharges = {};
        try {
          extraCharges = typeof booking.extra_charges === 'string' ? JSON.parse(booking.extra_charges) : (booking.extra_charges || {});
        } catch {
          extraCharges = {};
        }

        // Delete old PDF file if it exists
        if (booking.pdf && fs.existsSync(booking.pdf)) {
          try { fs.unlinkSync(booking.pdf); } catch (e) { }
        }

        // Regenerate modern invoice PDF with fresh customer details (new name, new number, etc.)
        const { pdfPath } = await generateModernInvoicePDF(
          {
            order_id: booking.order_id,
            customer_type: booking.customer_type,
            total: booking.total,
            created_at: booking.created_at,
            status: booking.status,
          },
          {
            customer_name: newName,
            mobile_number: newMobile,
            address: newAddress,
            district: newDistrict,
            state: newState,
            email: newEmail,
          },
          products,
          extraCharges
        );

        // Update booking row with fresh customer details, new customer_id link, & new pdf path
        await pool.query(
          `UPDATE public.dbooking 
           SET customer_name = $1, mobile_number = $2, address = $3, district = $4, state = $5, email = $6, pdf = $7, customer_id = $8
           WHERE id = $9`,
          [newName, newMobile, newAddress, newDistrict, newState, newEmail, pdfPath, customerId, booking.id]
        );
      } catch (err) {
        console.error(`Error regenerating bill for order ${booking.order_id}:`, err.message);
      }
    }

    // Also update any matching records in public.quotations
    try {
      await pool.query(
        `UPDATE public.quotations
         SET customer_name = $1, mobile_number = $2, address = $3, district = $4, state = $5, email = $6, pdf = NULL
         WHERE CAST(customer_id AS text) = CAST($7 AS text)
            OR (
              NULLIF($8, '') IS NOT NULL AND (
                mobile_number = $8
                OR RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($8, '[^0-9]', '', 'g'), 10)
              )
            )
            OR (
              NULLIF($9, '') IS NOT NULL AND (
                mobile_number = $9
                OR RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($9, '[^0-9]', '', 'g'), 10)
              )
            )
            OR (
              NULLIF($10, '') IS NOT NULL AND LOWER(TRIM(COALESCE(customer_name, ''))) = LOWER(TRIM($10))
            )`,
        [newName, newMobile, newAddress, newDistrict, newState, newEmail, customerId, oldMobile, newMobile, oldName]
      );
    } catch (qErr) {
      console.error('Error updating quotations:', qErr.message);
    }
  } catch (syncErr) {
    console.error('Error in syncCustomerBills:', syncErr.message);
  }
}

exports.updateCustomerName = async (req, res) => {
  const { id } = req.params;
  const { customer_name, name } = req.body;
  const newName = customer_name || name;

  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'Customer name is required.' });
  }

  try {
    const existing = await pool.query('SELECT * FROM public.gbcustomers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const oldCustomer = existing.rows[0];

    const result = await pool.query(
      'UPDATE public.gbcustomers SET customer_name = $1 WHERE id = $2 RETURNING *',
      [newName.trim(), id]
    );

    // Sync any existing bills/bookings with the new customer name and regenerate PDFs
    await syncCustomerBills(id, oldCustomer, { customer_name: newName.trim() });

    res.json({
      message: 'Customer name updated and fresh bills generated successfully',
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating customer name:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

exports.updateCustomer = async (req, res) => {
  const { id } = req.params;
  const {
    customer_name,
    state,
    district,
    mobile_number,
    email,
    address,
    customer_type,
    agent_id,
  } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM public.gbcustomers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const current = existing.rows[0];

    const updatedName = customer_name !== undefined ? customer_name : current.customer_name;
    const updatedState = state !== undefined ? state : current.state;
    const updatedDistrict = district !== undefined ? district : current.district;
    const updatedMobile = mobile_number !== undefined ? mobile_number : current.mobile_number;
    const updatedEmail = email !== undefined ? email : current.email;
    const updatedAddress = address !== undefined ? address : current.address;
    const updatedType = customer_type !== undefined ? customer_type : current.customer_type;
    const updatedAgentId = agent_id !== undefined ? agent_id : current.agent_id;

    const result = await pool.query(
      `UPDATE public.gbcustomers 
       SET customer_name = $1, state = $2, district = $3, mobile_number = $4, email = $5, address = $6, customer_type = $7, agent_id = $8
       WHERE id = $9 RETURNING *`,
      [updatedName, updatedState, updatedDistrict, updatedMobile, updatedEmail, updatedAddress, updatedType, updatedAgentId, id]
    );

    // Automatically sync customer bills with updated name, number, and address
    await syncCustomerBills(id, current, {
      customer_name: updatedName,
      mobile_number: updatedMobile,
      address: updatedAddress,
      district: updatedDistrict,
      state: updatedState,
      email: updatedEmail,
    });

    res.json({
      message: 'Customer details updated and fresh bills regenerated successfully',
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating customer:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

exports.getCustomerBookings = async (req, res) => {
  const { id } = req.params;
  try {
    const custRes = await pool.query('SELECT * FROM public.gbcustomers WHERE id = $1', [id]);
    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const cust = custRes.rows[0];
    const custMobile = (cust.mobile_number || '').trim();
    const custName = (cust.customer_name || '').trim();

    const result = await pool.query(
      `SELECT id, order_id, total, status, created_at, customer_name, mobile_number, pdf, products, extra_charges, customer_id
       FROM public.dbooking
       WHERE CAST(customer_id AS text) = CAST($1 AS text)
          OR (
            NULLIF($2, '') IS NOT NULL AND (
              mobile_number = $2
              OR REPLACE(COALESCE(mobile_number, ''), ' ', '') = REPLACE($2, ' ', '')
              OR RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($2, '[^0-9]', '', 'g'), 10)
            )
          )
          OR (
            NULLIF($3, '') IS NOT NULL AND LOWER(TRIM(COALESCE(customer_name, ''))) = LOWER(TRIM($3))
          )
       ORDER BY id DESC`,
      [id, custMobile, custName]
    );

    // Backfill customer_id on any matched bookings that were previously unlinked
    for (const b of result.rows) {
      if (!b.customer_id || String(b.customer_id) !== String(id)) {
        pool.query('UPDATE public.dbooking SET customer_id = $1 WHERE id = $2', [id, b.id]).catch(() => { });
      }
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching customer bookings:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

exports.regenerateCustomerBill = async (req, res) => {
  const { id, order_id } = req.params;
  try {
    const custRes = await pool.query('SELECT * FROM public.gbcustomers WHERE id = $1', [id]);
    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const cust = custRes.rows[0];

    let cleanOrderId = order_id;
    if (cleanOrderId.endsWith('.pdf')) cleanOrderId = cleanOrderId.replace(/\.pdf$/, '');

    let bookingRes = await pool.query(
      `SELECT id, order_id, customer_id, customer_name, mobile_number, email, address, district, state, customer_type, products, total, extra_charges, created_at, status, pdf
       FROM public.dbooking
       WHERE order_id = $1`,
      [cleanOrderId]
    );

    if (bookingRes.rows.length === 0) {
      const altOrderId = cleanOrderId.startsWith('DORD-') ? cleanOrderId.replace(/^DORD-/, '') : `DORD-${cleanOrderId}`;
      bookingRes = await pool.query(
        `SELECT id, order_id, customer_id, customer_name, mobile_number, email, address, district, state, customer_type, products, total, extra_charges, created_at, status, pdf
         FROM public.dbooking
         WHERE order_id = $1`,
        [altOrderId]
      );
    }

    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    const booking = bookingRes.rows[0];

    let products = [];
    try {
      products = typeof booking.products === 'string' ? JSON.parse(booking.products) : (booking.products || []);
    } catch {
      products = [];
    }

    let extraCharges = {};
    try {
      extraCharges = typeof booking.extra_charges === 'string' ? JSON.parse(booking.extra_charges) : (booking.extra_charges || {});
    } catch {
      extraCharges = {};
    }

    // Delete old PDF if exists
    if (booking.pdf && fs.existsSync(booking.pdf)) {
      try { fs.unlinkSync(booking.pdf); } catch (e) { }
    }

    // Generate Fresh Invoice PDF
    const { pdfPath } = await generateModernInvoicePDF(
      {
        order_id: booking.order_id,
        customer_type: cust.customer_type || booking.customer_type,
        total: booking.total,
        created_at: booking.created_at,
        status: booking.status,
      },
      {
        customer_name: cust.customer_name,
        mobile_number: cust.mobile_number,
        address: cust.address,
        district: cust.district,
        state: cust.state,
        email: cust.email,
      },
      products,
      extraCharges
    );

    await pool.query(
      `UPDATE public.dbooking 
       SET customer_name = $1, mobile_number = $2, address = $3, district = $4, state = $5, email = $6, pdf = $7, customer_id = $8
       WHERE id = $9`,
      [cust.customer_name, cust.mobile_number, cust.address, cust.district, cust.state, cust.email, pdfPath, id, booking.id]
    );

    res.json({
      message: 'Fresh bill generated successfully with updated customer details!',
      order_id: booking.order_id,
      pdfPath
    });
  } catch (error) {
    console.error('Error regenerating customer bill:', error.stack);
    res.status(500).json({ error: 'Failed to regenerate bill', details: error.message });
  }
};

exports.deleteCustomer = async (req, res) => {
  const { id } = req.params;
  try {
    // If any customers reference this customer as their agent, remove the reference first
    await pool.query(
      'UPDATE public.gbcustomers SET agent_id = NULL WHERE CAST(agent_id AS text) = CAST($1 AS text)',
      [id]
    );

    // Delete the customer record and all details
    const result = await pool.query(
      'DELETE FROM public.gbcustomers WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    res.json({
      message: 'Customer and all entered details deleted successfully.',
      deletedCustomer: result.rows[0],
    });
  } catch (error) {
    console.error('Error deleting customer:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};