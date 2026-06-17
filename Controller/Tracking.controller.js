const { Pool } = require('pg');
const axios = require('axios');
const fs = require('fs');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const ACCESS_TOKEN = 'EAAKZAUdN55kEBPLcupTZAXpIZCAszZBupSiKxRCWe5zYiZB0LZCuUFl3vTLjWDBuAgU1u6f29S8e2XkdzgrSfn8PpiT0jLSZCAOU9aGhDoOlTL9MrxZBgG0vZBCDt3dHLFlM2GHOrwvJP2WjZB2yQix9FOh6Wduq1LhXgJQpHYTYoBGbiTc8ek9LAZBXeXjPQJa8QaPAvvbcGwPIAw63P1dOAX4qfqC8AS7fJDKZAZBLbLmXEM8Hv';
const PHONE_NUMBER_ID = '660922473779560';

const createTransportTable = `
  CREATE TABLE IF NOT EXISTS transport_details (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES bookings(order_id),
    transport_name VARCHAR(100) NOT NULL,
    lr_number VARCHAR(50) NOT NULL,
    transport_contact VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

// const alterBookingsTable = `
//   ALTER TABLE bookings
//   ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
//   ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(100),
//   ADD COLUMN IF NOT EXISTS amount_paid NUMERIC
// `;

// pool.query(createTransportTable).catch((err) => console.error('Error creating transport table:', err));
// pool.query(alterBookingsTable).catch((err) => console.error('Error altering bookings table:', err));

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
      SELECT b.id, b.order_id, b.customer_name, b.district, b.state, b.status, b.products, b.address, b.created_at, b.mobile_number, b.payment_method, b.transaction_id, b.amount_paid, t.transport_name, t.lr_number, t.transport_contact
      FROM public.bookings b
      LEFT JOIN transport_details t ON b.order_id = t.order_id
      WHERE b.status = ANY($1)
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

exports.getreportBookings = async (req, res) => {
  try {
    const { status } = req.query;
    const allowedStatuses = ['paid','dispatched','delivered'];
    let query = `
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
        t.transport_contact
      FROM public.bookings b
      LEFT JOIN transport_details t ON b.order_id = t.order_id
      WHERE b.status = ANY($1)
    `;
    const params = [allowedStatuses];
    if (status && allowedStatuses.includes(status)) {
      query += ` AND b.status = $2`;
      params.push(status);
    }
    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching filtered bookings:', err);
    res.status(500).json({ message: 'Failed to fetch filtered bookings' });
  }
};

exports.updateFilterBookingStatus = async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    const { 
      status, 
      transportName, 
      lrNumber, 
      transportContact,
      transportDetails   // fallback
    } = req.body;

    console.log('🚀 Received Payload:', { id, status, transportName, lrNumber, transportContact });

    if (!id) return res.status(400).json({ message: 'Booking ID required' });

    const validStatuses = ['booked', 'paid', 'packed', 'dispatched', 'delivered'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Update bookings table
    const bookingUpdate = await client.query(`
      UPDATE public.bookings 
      SET status = $1, updated_at = NOW()
      WHERE id = $2 
      RETURNING id, order_id, status, mobile_number
    `, [status, id]);

    if (bookingUpdate.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookingUpdate.rows[0];

    // 2. Handle Transport Details (without ON CONFLICT)
    let transportData = null;
    if (status === 'dispatched') {
      const tName = transportName || transportDetails?.transportName || transportDetails?.transport_name;
      const tLR = lrNumber || transportDetails?.lrNumber || transportDetails?.lr_number;
      const tContact = transportContact || transportDetails?.transportContact || transportDetails?.transport_contact;

      if (tName && tLR) {
        // Delete old record if exists, then insert new one
        await client.query('DELETE FROM transport_details WHERE order_id = $1', [booking.order_id]);

        const insertResult = await client.query(`
          INSERT INTO transport_details (order_id, transport_name, lr_number, transport_contact)
          VALUES ($1, $2, $3, $4)
          RETURNING transport_name, lr_number, transport_contact
        `, [booking.order_id, tName, tLR, tContact || null]);

        transportData = insertResult.rows[0];
        console.log('✅ Transport details saved successfully:', transportData);
      } else {
        console.warn('⚠️ Missing transport details for dispatched status');
      }
    }

    await client.query('COMMIT');

    // Send WhatsApp notification
    await sendStatusUpdate(booking.mobile_number, status, transportData);

    res.status(200).json({ 
      message: 'Status updated successfully', 
      data: { 
        ...booking, 
        transport_name: transportData?.transport_name,
        lr_number: transportData?.lr_number,
        transport_contact: transportData?.transport_contact 
      } 
    });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Error updating booking status:', err);
    res.status(500).json({ 
      message: 'Failed to update booking status', 
      error: err.message 
    });
  } finally {
    if (client) client.release();
  }
};

exports.deleteBooking = async (req, res) => {
  let client;
  try {
    const { order_id } = req.params;
    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) 
      return res.status(400).json({ message: 'Invalid or missing Order ID', order_id });

    client = await pool.connect();
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

    // === CRITICAL: Delete child records first (foreign key violation) ===
    await client.query(
      'DELETE FROM transport_details WHERE order_id = $1',
      [order_id]
    );

    // Delete the booking
    await client.query(
      'DELETE FROM public.bookings WHERE order_id = $1',
      [order_id]
    );

    // Delete associated quotation if it exists
    if (quotation_id) {
      const quotationCheck = await client.query(
        'SELECT pdf FROM public.fwcquotations WHERE quotation_id = $1',  // Note: table name was "quotations" in old code — using fwcquotations here to match main file
        [quotation_id]
      );

      if (quotationCheck.rows.length > 0) {
        const quotationPdf = quotationCheck.rows[0].pdf;
        await client.query(
          'DELETE FROM public.fwcquotations WHERE quotation_id = $1',
          [quotation_id]
        );

        if (quotationPdf && fs.existsSync(quotationPdf)) {
          try {
            fs.unlinkSync(quotationPdf);
            console.log(`Deleted quotation PDF: ${quotationPdf}`);
          } catch (err) {
            console.error(`Failed to delete quotation PDF ${quotationPdf}: ${err.message}`);
          }
        }
      }
    }

    // Delete booking PDF file if it exists
    if (pdf && fs.existsSync(pdf)) {
      try {
        fs.unlinkSync(pdf);
        console.log(`Deleted booking PDF: ${pdf}`);
      } catch (err) {
        console.error(`Failed to delete booking PDF ${pdf}: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ 
      message: 'Booking and associated data deleted successfully', 
      order_id 
    });

  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error(`Failed to delete booking for order_id ${req.params.order_id}: ${err.message}`);
    res.status(500).json({ 
      message: 'Failed to delete booking', 
      error: err.message, 
      order_id: req.params.order_id 
    });
  } finally {
    if (client) client.release();
  }
};

module.exports;