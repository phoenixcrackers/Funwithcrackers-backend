const { Pool } = require('pg');
const axios = require('axios');
const fs = require('fs');

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

const ACCESS_TOKEN = 'EAAKZAUdN55kEBPLcupTZAXpIZCAszZBupSiKxRCWe5zYiZB0LZCuUFl3vTLjWDBuAgU1u6f29S8e2XkdzgrSfn8PpiT0jLSZCAOU9aGhDoOlTL9MrxZBgG0vZBCDt3dHLFlM2GHOrwvJP2WjZB2yQix9FOh6Wduq1LhXgJQpHYTYoBGbiTc8ek9LAZBXeXjPQJa8QaPAvvbcGwPIAw63P1dOAX4qfqC8AS7fJDKZAZBLbLmXEM8Hv';
const PHONE_NUMBER_ID = '660922473779560';

async function sendStatusUpdate(mobileNumber, status, transportDetails = null) {
  if (!mobileNumber) {
    console.warn('Mobile number is missing; skipping WhatsApp notification');
    return;
  }

  let recipientNumber = mobileNumber.replace(/\D/g, '');
  if (recipientNumber.length === 10) {
    recipientNumber = `+91${recipientNumber}`;
  } else if (recipientNumber.length === 12 && recipientNumber.startsWith('91')) {
    recipientNumber = `+${recipientNumber}`;
  } else {
    console.warn(`Invalid mobile number format: ${mobileNumber}; skipping WhatsApp notification`);
    return;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: recipientNumber,
    type: 'template',
    template: {
      name: 'hello_world',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: status },
            ...(status === 'dispatched' && transportDetails
              ? [
                  { type: 'text', text: transportDetails.transport_name || 'N/A' },
                  { type: 'text', text: transportDetails.lr_number || 'N/A' },
                  { type: 'text', text: transportDetails.transport_contact || 'N/A' },
                ]
              : [
                  { type: 'text', text: 'N/A' },
                  { type: 'text', text: 'N/A' },
                  { type: 'text', text: 'N/A' },
                ]),
          ],
        },
      ],
    },
  };

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`✅ Status update sent to ${recipientNumber} for status: ${status}`);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Error sending WhatsApp status update:', err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
  }
}

exports.getAllBookings = async (req, res) => {
  try {
    const { status, customerType } = req.query;
    let query = `
      SELECT * FROM public.bookings
    `;
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (customerType) {
      conditions.push(`customer_type = $${params.length + 1}`);
      params.push(customerType);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ message: 'Failed to fetch bookings' });
  }
};

exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_method, transaction_id, amount_paid, transportDetails } = req.body;
    console.log('Received Payload:', { status, payment_method, transaction_id, amount_paid, transportDetails });

    const validStatuses = ['booked', 'paid', 'packed', 'dispatched', 'delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    if (status === 'paid') {
      if (amount_paid === undefined || amount_paid === null || isNaN(amount_paid) || amount_paid <= 0) {
        return res.status(400).json({ message: 'Valid amount paid is required for paid status' });
      }
      if (!payment_method) {
        return res.status(400).json({ message: 'Payment method is required for paid status' });
      }
      if (payment_method === 'bank' && (!transaction_id || transaction_id.trim() === '')) {
        return res.status(400).json({ message: 'Transaction ID is required for bank payments' });
      }
    }

    await pool.query('BEGIN');

    // Build the update query dynamically
    let query = `
      UPDATE public.bookings
      SET status = $1
    `;
    const params = [status];
    let paramIndex = 2;

    // Only update payment fields if they are explicitly provided
    if (status === 'paid') {
      query += `, payment_method = $${paramIndex}`;
      params.push(payment_method);
      paramIndex++;
      query += `, transaction_id = $${paramIndex}`;
      params.push(transaction_id || null);
      paramIndex++;
      query += `, amount_paid = $${paramIndex}`;
      params.push(amount_paid);
      paramIndex++;
    }

    query += `
      WHERE id = $${paramIndex}
      RETURNING id, order_id, status, mobile_number, payment_method, transaction_id, amount_paid
    `;
    params.push(id);

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found' });
    }

    let transportData = null;
    if (status === 'dispatched' && transportDetails) {
      const transportQuery = `
        INSERT INTO transport_details (order_id, transport_name, lr_number, transport_contact)
        VALUES ($1, $2, $3, $4)
        RETURNING transport_name, lr_number, transport_contact
      `;
      const transportResult = await pool.query(transportQuery, [
        result.rows[0].order_id,
        transportDetails.transportName,
        transportDetails.lrNumber,
        transportDetails.transportContact || null,
      ]);
      transportData = transportResult.rows[0];
    }

    await pool.query('COMMIT');

    await sendStatusUpdate(result.rows[0].mobile_number, status, transportData);

    res.status(200).json({ message: 'Status updated successfully', data: result.rows[0] });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error updating booking status:', err);
    res.status(500).json({ message: 'Failed to update booking status', error: err.message });
  }
};


exports.getFilteredBookings = async (req, res) => {
  try {
    const { status } = req.query;
    const allowedStatuses = ['paid', 'packed', 'dispatched', 'delivered'];
    let query = `
      SELECT id, order_id, customer_name, district, state, status, products, address, created_at, mobile_number, payment_method, transaction_id, amount_paid, transport_name, lr_number, transport_contact
      FROM public.bookings
      WHERE status = ANY($1)
    `;
    const params = [allowedStatuses];
    if (status && allowedStatuses.includes(status)) {
      query += ` AND b.status = $2`;
      params.push(status);
    }
    const result = await pool.query(query, params);
    const bookingsWithTotal = result.rows.map((booking) => ({
      ...booking,
      total: booking.products && Array.isArray(booking.products)
        ? booking.products.reduce((sum, product) => sum + (parseFloat(product.price) || 0) * (product.quantity || 0), 0)
        : 0,
    }));
    res.status(200).json(bookingsWithTotal);
  } catch (err) {
    console.error('Error fetching filtered bookings:', err);
    res.status(500).json({ message: 'Failed to fetch filtered bookings' });
  }
};

exports.getReportBookings = async (req, res) => {
  try {
    const allowedBookingStatuses = ['paid', 'dispatched', 'delivered'];

    const bookingsQuery = `
      SELECT 
        b.id,
        b.order_id,
        b.customer_name,
        b.district,
        b.state,
        b.status,
        b.products,
        b.address,
        b.created_at,
        b.mobile_number,
        b.payment_method,
        b.transaction_id,
        b.amount_paid,
        b.total,
        t.transport_name,
        t.lr_number,
        t.transport_contact,
        NULL::text AS quotation_id,
        NULL::text AS quotation_pdf,
        'BOOKING' AS source_type
      FROM public.bookings b
      LEFT JOIN transport_details t ON b.order_id = t.order_id
      WHERE b.status = ANY($1)
      ORDER BY b.created_at DESC
    `;

    const bookingsResult = await pool.query(bookingsQuery, [allowedBookingStatuses]);
    console.log(`[REPORT] Bookings returned: ${bookingsResult.rowCount}`);

    const quotationsQuery = `
      SELECT 
        NULL::integer AS id,
        NULL::text AS order_id,
        q.customer_name,
        q.district,
        q.state,
        'quotation_pending' AS status,
        q.products,
        q.address,
        q.created_at,
        q.mobile_number,
        NULL::text AS payment_method,
        NULL::text AS transaction_id,
        NULL::numeric AS amount_paid,
        CAST(COALESCE(q.total, '0') AS numeric) AS total,
        NULL::text AS transport_name,
        NULL::text AS lr_number,
        NULL::text AS transport_contact,
        q.quotation_id,
        q.pdf AS quotation_pdf,
        'QUOTATION' AS source_type
      FROM public.fwcquotations q
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bookings b 
        WHERE b.quotation_id = q.quotation_id
      )
      ORDER BY q.created_at DESC
    `;

    const quotationsResult = await pool.query(quotationsQuery);
    console.log(`[REPORT] Quotations returned: ${quotationsResult.rowCount}`);

    const combined = [
      ...bookingsResult.rows,
      ...quotationsResult.rows
    ];

    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    console.log(`[REPORT] Total items sent: ${combined.length}`);

    res.status(200).json(combined);
  } catch (err) {
    console.error('Error in getReportBookings:', err);
    res.status(500).json({ 
      message: 'Failed to fetch report data', 
      error: err.message 
    });
  }
};

exports.updateFilterBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_method, transaction_id, amount_paid, transportDetails } = req.body;
    console.log('Received Payload:', { status, payment_method, transaction_id, amount_paid });

    const validStatuses = ['booked', 'paid', 'packed', 'dispatched', 'delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    if (status === 'paid') {
      if (amount_paid === undefined || amount_paid === null || isNaN(amount_paid) || amount_paid <= 0) {
        return res.status(400).json({ message: 'Valid amount paid is required' });
      }
      if (!payment_method) {
        return res.status(400).json({ message: 'Payment method is required for paid status' });
      }
      if (payment_method === 'bank' && (!transaction_id || transaction_id.trim() === '')) {
        return res.status(400).json({ message: 'Transaction ID is required for bank payments' });
      }
    }

    await pool.query('BEGIN');

    // Build the update query dynamically
    let query = `
      UPDATE public.bookings
      SET status = $1
    `;
    const params = [status];
    let paramIndex = 2;

    // Only update payment fields if status is 'paid'
    if (status === 'paid') {
      query += `, payment_method = $${paramIndex}, transaction_id = $${paramIndex + 1}, amount_paid = $${paramIndex + 2}`;
      params.push(payment_method || null, transaction_id || null, amount_paid || null);
      paramIndex += 3;
    }

    query += `
      WHERE id = $${paramIndex}
      RETURNING id, order_id, status, mobile_number, payment_method, transaction_id, amount_paid
    `;
    params.push(id);

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found' });
    }

    let transportData = null;
    if (status === 'dispatched' && transportDetails) {
      const transportQuery = `
        UPDATE public.bookings
        SET transport_name = $1, lr_number = $2, transport_contact = $3
        WHERE id = $4
        RETURNING transport_name, lr_number, transport_contact
      `;
      const transportResult = await pool.query(transportQuery, [
        transportDetails.transportName,
        transportDetails.lrNumber,
        transportDetails.transportContact || null,
        id,
      ]);
      transportData = transportResult.rows[0];
    }

    await pool.query('COMMIT');
    await sendStatusUpdate(result.rows[0].mobile_number, status, transportData);

    res.status(200).json({ message: 'Status updated successfully', data: result.rows[0] });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error updating booking status:', err);
    res.status(500).json({ message: 'Failed to update booking status', error: err.message });
  }
};

exports.deleteBooking = async (req, res) => {
  const client = await pool.connect();
  try {
    const { order_id } = req.params;
    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id))
      return res.status(400).json({ message: 'Invalid or missing Order ID', order_id });

    await client.query('BEGIN');

    const bookingCheck = await client.query(
      'SELECT quotation_id, pdf FROM public.bookings WHERE order_id = $1',
      [order_id]
    );
    if (bookingCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found', order_id });
    }

    const { quotation_id, pdf } = bookingCheck.rows[0];

    // ✅ Delete transport_details first to avoid FK violation
    await client.query('DELETE FROM transport_details WHERE order_id = $1', [order_id]);

    // Delete the booking
    await client.query('DELETE FROM public.bookings WHERE order_id = $1', [order_id]);

    // Delete associated quotation if it exists
    if (quotation_id) {
      const quotationCheck = await client.query(
        'SELECT pdf FROM public.fwcquotations WHERE quotation_id = $1',
        [quotation_id]
      );
      if (quotationCheck.rows.length > 0) {
        const quotationPdf = quotationCheck.rows[0].pdf;
        await client.query('DELETE FROM public.fwcquotations WHERE quotation_id = $1', [quotation_id]);
        if (quotationPdf && fs.existsSync(quotationPdf)) {
          try { fs.unlinkSync(quotationPdf); } catch (e) { console.error(`Failed to delete quotation PDF: ${e.message}`); }
        }
      }
    }

    if (pdf && fs.existsSync(pdf)) {
      try { fs.unlinkSync(pdf); } catch (e) { console.error(`Failed to delete booking PDF: ${e.message}`); }
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Booking deleted successfully', order_id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Failed to delete booking for order_id ${req.params.order_id}: ${err.message}`);
    res.status(500).json({ message: 'Failed to delete booking', error: err.message });
  } finally {
    client.release(); // ✅ Only released once, here in finally
  }
};

module.exports;