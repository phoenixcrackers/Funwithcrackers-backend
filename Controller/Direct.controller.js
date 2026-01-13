const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');

// Initialize PostgreSQL pool
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

const generatePDFBuffer = (type, data, customerDetails, products, dbValues) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });

      // In-memory buffer
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on('error', (err) => reject(err));

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text(type === 'quotation' ? 'Quotation' : 'Estimate Bill', 50, 50, { align: 'center' });
      doc.fontSize(12).font('Helvetica')
        .text('Phoenix Crackers', 50, 80)
        .text('Sivakasi', 50, 95)
        .text('Mobile: +91 63836 59214', 50, 110)
        .text('Email: nivasramasamy27@gmail.com', 50, 125)
        .text('Website: www.funwithcrackers.com', 50, 140);

      // Customer Details
      const customerType = data.customer_type === 'Customer of Selected Agent' ? 'Customer - Agent' : data.customer_type || 'User';
      let addressLine1 = customerDetails.address || 'N/A';
      let addressLine2 = '';
      if (addressLine1.length > 30) {
        const splitIndex = addressLine1.lastIndexOf(' ', 30);
        addressLine2 = addressLine1.slice(splitIndex + 1);
        addressLine1 = addressLine1.slice(0, splitIndex);
      }
      let formattedDate = 'N/A';
      if (type === 'quotation') {
        // For quotations, use Date.now() if created_at is not available or invalid
        try {
          const date = customerDetails.created_at
            ? (customerDetails.created_at instanceof Date
                ? customerDetails.created_at
                : new Date(customerDetails.created_at))
            : new Date(); // Fallback to current date
          if (!isNaN(date.getTime())) {
            formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          } else {
            console.warn(`generatePDF: Invalid date format for created_at: ${customerDetails.created_at}, using current date`);
            formattedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          }
        } catch (err) {
          console.error(`generatePDF: Error parsing created_at: ${err.message}, using current date`);
          formattedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
      } else {
        // For invoices (bookings), use provided created_at or fallback to current date
        try {
          const date = customerDetails.created_at
            ? (customerDetails.created_at instanceof Date
                ? customerDetails.created_at
                : new Date(customerDetails.created_at))
            : new Date();
          if (!isNaN(date.getTime())) {
            formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          } else {
            console.warn(`generatePDF: Invalid date format for created_at: ${customerDetails.created_at}, using current date`);
            formattedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          }
        } catch (err) {
          console.error(`generatePDF: Error parsing created_at: ${err.message}, using current date`);
          formattedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
      }
      doc.fontSize(12).font('Helvetica')
        .text(`${type === 'quotation' ? 'Quotation ID' : 'Order ID'}: ${data.quotation_id || data.order_id}`, 300, 80, { align: 'right' })
        .text(`Date: ${formattedDate}`, 300, 95, { align: 'right' })
        .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 300, 110, { align: 'right' })
        .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 300, 125, { align: 'right' })
        .text(`Address: ${addressLine1}`, 300, 140, { align: 'right' })
        .text(addressLine2, 300, 155, { align: 'right' })
        .text(`District: ${customerDetails.district || 'N/A'}`, 300, 170, { align: 'right' })
        .text(`State: ${customerDetails.state || 'N/A'}`, 300, 185, { align: 'right' })
        .text(`Customer Type: ${customerType}`, 300, 200, { align: 'right' });
      if (data.agent_name) {
        doc.text(`Agent: ${data.agent_name}`, 300, 215, { align: 'right' });
      }

      // Table Setup
      const tableY = 250;
      const tableWidth = 500;
      const colWidths = [30, 150, 50, 70, 70, 50, 100];
      const colX = [50, 80, 210, 250, 320, 400, 450];
      const rowHeight = 25;
      const pageHeight = doc.page.height - doc.page.margins.bottom;

      // Initialize y
      let y = tableY;

      // Split products into discounted and non-discounted
      const discountedProducts = products.filter(p => parseFloat(p.discount || 0) > 0);
      const netRateProducts = products.filter(p => !p.discount || parseFloat(p.discount) === 0);

      // Primary Table (Discounted Products)
      if (discountedProducts.length > 0) {
        doc.fontSize(12).font('Helvetica-Bold').text('DISCOUNTED PRODUCTS', 50, y - 20);
        doc.moveTo(50, y - 5).lineTo(50 + tableWidth, y - 5).stroke();
        doc.fontSize(10).font('Helvetica-Bold')
          .text('Sl.N', colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
          .text('Product', colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
          .text('Qty', colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
          .text('Rate', colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' })
          .text('Disc Rate', colX[4] + 5, y, { width: colWidths[4] - 10, align: 'left' })
          .text('Per', colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' })
          .text('Total', colX[6] + 5, y, { width: colWidths[6] - 10, align: 'left' });
        doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();
        colX.forEach((x, i) => {
          doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
          if (i === colX.length - 1) {
            doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
          }
        });

        y += rowHeight;
        discountedProducts.forEach((product, index) => {
          if (y + rowHeight > pageHeight - 50) {
            doc.addPage();
            y = doc.page.margins.top + 20;
            doc.fontSize(12).font('Helvetica-Bold').text('DISCOUNTED PRODUCTS (Continued)', 50, y - 20);
            doc.moveTo(50, y - 5).lineTo(50 + tableWidth, y - 5).stroke();
            doc.fontSize(10).font('Helvetica-Bold')
              .text('Sl.N', colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
              .text('Product', colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
              .text('Qty', colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
              .text('Rate', colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' })
              .text('Disc Rate', colX[4] + 5, y, { width: colWidths[4] - 10, align: 'left' })
              .text('Per', colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' })
              .text('Total', colX[6] + 5, y, { width: colWidths[6] - 10, align: 'left' });
            doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();
            colX.forEach((x, i) => {
              doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
              if (i === colX.length - 1) {
                doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
              }
            });
            y += rowHeight;
          }

          const price = parseFloat(product.price) || 0;
          const discount = parseFloat(product.discount || 0) || 0;
          const discRate = price - (price * discount / 100);
          const productTotal = discRate * (product.quantity || 1);

          let productName = product.productname || 'N/A';
          if (productName.length > 30) {
            productName = productName.substring(0, 27) + '...';
          }

          doc.font('Helvetica')
            .text(index + 1, colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
            .text(productName, colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
            .text(product.quantity || 1, colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
            .text(`Rs.${price.toFixed(2)}`, colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' })
            .text(`Rs.${discRate.toFixed(2)}`, colX[4] + 5, y, { width: colWidths[4] - 10, align: 'left' })
            .text(product.per || 'N/A', colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' })
            .text(`Rs.${productTotal.toFixed(2)}`, colX[6] + 5, y, { width: colWidths[6] - 10, align: 'left' });

          doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();
          colX.forEach((x, i) => {
            doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
            if (i === colX.length - 1) {
              doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
            }
          });

          y += rowHeight;
        });
      }

      // Secondary Table (Net Rate Products)
      if (netRateProducts.length > 0) {
        y += 20;
        if (y + rowHeight + 30 > pageHeight - 50) {
          doc.addPage();
          y = doc.page.margins.top + 20;
        }

        doc.fontSize(12).font('Helvetica-Bold').text('NET RATE PRODUCTS', 50, y);
        y += 20;
        doc.moveTo(50, y - 5).lineTo(50 + tableWidth, y - 5).stroke();
        doc.fontSize(10).font('Helvetica-Bold')
          .text('Sl.N', colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
          .text('Product', colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
          .text('Qty', colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
          .text('Rate', colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' })
          .text('Disc Rate', colX[4] + 5, y, { width: colWidths[4] - 10, align: 'left' })
          .text('Per', colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' })
          .text('Total', colX[6] + 5, y, { width: colWidths[6] - 10, align: 'left' });
        doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();
        colX.forEach((x, i) => {
          doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
          if (i === colX.length - 1) {
            doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
          }
        });

        y += rowHeight;
        netRateProducts.forEach((product, index) => {
          if (y + rowHeight > pageHeight - 50) {
            doc.addPage();
            y = doc.page.margins.top + 20;
            doc.fontSize(12).font('Helvetica-Bold').text('NET RATE PRODUCTS (Continued)', 50, y - 20);
            doc.moveTo(50, y - 5).lineTo(50 + tableWidth, y - 5).stroke();
            doc.fontSize(10).font('Helvetica-Bold')
              .text('Sl.N', colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
              .text('Product', colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
              .text('Qty', colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
              .text('Rate', colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' })
              .text('Disc Rate', colX[4] + 5, y, { width: colWidths[4] - 10, align: 'left' })
              .text('Per', colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' })
              .text('Total', colX[6] + 5, y, { width: colWidths[6] - 10, align: 'left' });
            doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();
            colX.forEach((x, i) => {
              doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
              if (i === colX.length - 1) {
                doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
              }
            });
            y += rowHeight;
          }

          const price = parseFloat(product.price) || 0;
          const discRate = price; // No discount for net rate products
          const productTotal = discRate * (product.quantity || 1);

          let productName = product.productname || 'N/A';
          if (productName.length > 30) {
            productName = productName.substring(0, 27) + '...';
          }

          doc.font('Helvetica')
            .text(index + 1, colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
            .text(productName, colX[1] + 5, y, { width: colWidths[1] - 10, align: 'left' })
            .text(product.quantity || 1, colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
            .text(`Rs.${price.toFixed(2)}`, colX[3] + 5, y, { width: colWidths[3] - 10, align: 'left' })
            .text(`Rs.${discRate.toFixed(2)}`, colX[4] + 5, y, { width: colWidths[4] - 10, align: 'left' })
            .text(product.per || 'N/A', colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' })
            .text(`Rs.${productTotal.toFixed(2)}`, colX[6] + 5, y, { width: colWidths[6] - 10, align: 'left' });

          doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();
          colX.forEach((x, i) => {
            doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
            if (i === colX.length - 1) {
              doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
            }
          });

          y += rowHeight;
        });
      }

      // Handle case with no products
      if (products.length === 0) {
        y += 20;
        doc.fontSize(12).font('Helvetica').text('No products available', 50, y, { align: 'center' });
        y += 20;
      }

      // Totals Section
      y += 10;
      if (y + 110 > pageHeight - 50) {
        doc.addPage();
        y = doc.page.margins.top + 20;
      }

      const netRate = parseFloat(dbValues.net_rate) || 0;
      const youSave = parseFloat(dbValues.you_save) || 0;
      const additionalDiscount = parseFloat(dbValues.additional_discount) || 0;
      const total = netRate - youSave;
      const additionalDiscountAmount = total * (additionalDiscount / 100);
      const grandTotal = total - additionalDiscountAmount;


      doc.fontSize(10).font('Helvetica-Bold')
        .text(`Total: Rs.${netRate.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
      y += 20;
      if (youSave > 0){
      doc.fontSize(10).font('Helvetica-Bold')
        .text(`You Save: Rs.${youSave.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
      y += 20;
      }
      if (additionalDiscount > 0){
        doc.fontSize(10).font('Helvetica-Bold')
          .text(`Sub Total: Rs.${total.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
        y += 20;
      }
      if (additionalDiscount > 0) {
        doc.text(`Extra Discount: Rs.${additionalDiscountAmount.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
        y += 20;
      }
      doc.fontSize(10).font('Helvetica-Bold')
        .text(`Grand Total: Rs.${grandTotal.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
      y += 20;

      y += 30;
      if (y + 50 > pageHeight - 50) {
        doc.addPage();
        y = doc.page.margins.top + 20;
      }
      doc.fontSize(10).font('Helvetica')
        .text('Thank you for your business!', 50, y, { align: 'center' })
        .text('For any queries, contact us at +91 63836 59214', 50, y + 15, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(new Error(`Error generating PDF: ${err.message}`));
    }
  });
};

exports.getCustomers = async (req, res) => {
  try {
    const query = `
      SELECT c.id, c.customer_name AS name, c.address, c.mobile_number, c.email, c.customer_type, c.district, c.state, c.agent_id,
             a.customer_name AS agent_name
      FROM public.customers c
      LEFT JOIN public.customers a ON c.agent_id::bigint = a.id AND c.customer_type = 'Customer of Selected Agent'
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Failed to fetch customers:', err.stack);
    res.status(500).json({ error: 'Failed to fetch customers', details: err.message });
  }
};

exports.getProductTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT product_type FROM public.products');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(`Failed to fetch product types: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch product types', error: err.message });
  }
};

exports.getProductsByType = async (req, res) => {
  try {
    const productTypesResult = await pool.query('SELECT DISTINCT product_type FROM public.products');
    const productTypes = productTypesResult.rows.map(row => row.product_type);

    let allProducts = [];

    for (const productType of productTypes) {
      const tableName = productType.toLowerCase().replace(/\s+/g, '_');
      const query = `
        SELECT id, serial_number, productname, price, dprice, per, discount, image, status, $1 AS product_type
        FROM public.${tableName}
        WHERE status = 'on'
      `;
      const result = await pool.query(query, [productType]);
      allProducts = allProducts.concat(result.rows);
    }

    const products = allProducts.map(row => ({
      id: row.id,
      product_type: row.product_type,
      serial_number: row.serial_number,
      productname: row.productname,
      price: parseFloat(row.price || 0),
      dprice: parseFloat(row.dprice || 0),
      per: row.per,
      discount: parseFloat(row.discount || 0),
      image: row.image,
      status: row.status
    }));

    res.status(200).json(products);
  } catch (err) {
    console.error(`Failed to fetch products: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch products', error: err.message });
  }
};

exports.getAproductsByType = async (req, res) => {
  try {
    const productTypesResult = await pool.query('SELECT DISTINCT product_type FROM public.products');
    const productTypes = productTypesResult.rows.map(row => row.product_type);

    let allProducts = [];

    for (const productType of productTypes) {
      const tableName = productType.toLowerCase().replace(/\s+/g, '_');
      const query = `
        SELECT id, serial_number, productname, dprice, price, per, discount, image, status, $1 AS product_type
        FROM public.${tableName}
      `;
      const result = await pool.query(query, [productType]);
      allProducts = allProducts.concat(result.rows);
    }

    const products = allProducts.map(row => ({
      id: row.id,
      product_type: row.product_type,
      serial_number: row.serial_number,
      productname: row.productname,
      price: parseFloat(row.price || 0),
      dprice: parseFloat(row.dprice || 0),
      per: row.per,
      discount: parseFloat(row.discount || 0),
      image: row.image,
      status: row.status
    }));

    res.status(200).json(products);
  } catch (err) {
    console.error(`Failed to fetch products: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch products', error: err.message });
  }
};

exports.getAllQuotations = async (req, res) => {
  try {
    const query = `
      SELECT id, customer_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount,
             customer_name, address, mobile_number, email, district, state, customer_type, 
             status, created_at, updated_at, pdf
      FROM public.fwcquotations
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(`Failed to fetch quotations: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch quotations', error: err.message });
  }
};

exports.createQuotation = async (req, res) => {
  let client;
  try {
    const {
      customer_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount,
      customer_type, customer_name, address, mobile_number, email, district, state
    } = req.body;

    console.log(`Received createQuotation request with quotation_id: ${quotation_id}`);

    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id)) 
      return res.status(400).json({ message: 'Invalid or missing Quotation ID', quotation_id });
    if (!Array.isArray(products) || products.length === 0) 
      return res.status(400).json({ message: 'Products array is required and must not be empty', quotation_id });
    if (!total || isNaN(parseFloat(total)) || parseFloat(total) <= 0) 
      return res.status(400).json({ message: 'Total must be a positive number', quotation_id });

    const parsedNetRate = parseFloat(net_rate) || 0;
    const parsedYouSave = parseFloat(you_save) || 0;
    const parsedPromoDiscount = parseFloat(promo_discount) || 0;
    const parsedAdditionalDiscount = parseFloat(additional_discount) || 0;
    const parsedTotal = parseFloat(total);

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, promo_discount, additional_discount, and total must be valid numbers', quotation_id });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };
    let agent_name = null;

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type, agent_id FROM public.customers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) 
        return res.status(404).json({ message: 'Customer not found', quotation_id });

      const customerRow = customerCheck.rows[0];
      finalCustomerType = customer_type || customerRow.customer_type || 'User';
      customerDetails = {
        customer_name: customerRow.customer_name,
        address: customerRow.address,
        mobile_number: customerRow.mobile_number,
        email: customerRow.email,
        district: customerRow.district,
        state: customerRow.state
      };

      if (finalCustomerType === 'Customer of Selected Agent' && customerRow.agent_id) {
        const agentCheck = await pool.query('SELECT customer_name FROM public.customers WHERE id = $1', [customerRow.agent_id]);
        if (agentCheck.rows.length > 0) agent_name = agentCheck.rows[0].customer_name;
      }
    } else {
      if (finalCustomerType !== 'User') 
        return res.status(400).json({ message: 'Customer type must be "User" for quotations without customer ID', quotation_id });
      if (!customer_name || !address || !district || !state || !mobile_number)
        return res.status(400).json({ message: 'All customer details must be provided', quotation_id });
    }

    const enhancedProducts = [];
    for (const product of products) {
      const { id, product_type, quantity, price, discount, productname, per } = product;
      if (!id || !product_type || !productname || quantity < 1 || isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
        return res.status(400).json({ message: 'Invalid product entry (id, product_type, productname, quantity, price, discount required)', quotation_id });

      let productPer = per || 'Unit'; // Default to 'Unit' if per is not provided
      if (product_type.toLowerCase() !== 'custom') {
        const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
        const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
        if (productCheck.rows.length === 0)
          return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable`, quotation_id });
        productPer = productCheck.rows[0].per || productPer;
      }
      enhancedProducts.push({ ...product, per: productPer });
    }

    let pdfPath;
    try {
      const pdfResult = await generatePDFBuffer(
        'quotation',
        { quotation_id, customer_type: finalCustomerType, total: parsedTotal, agent_name },
        customerDetails,
        enhancedProducts,
        { net_rate: parsedNetRate, you_save: parsedYouSave, total: parsedTotal, promo_discount: parsedPromoDiscount, additional_discount: parsedAdditionalDiscount }
      );
      console.log(`PDF generated`);
    } catch (pdfError) {
      console.error(`Failed: PDF generation failed for quotation_id ${quotation_id}: ${pdfError.message}`);
      return res.status(500).json({ message: 'Failed to generate PDF', error: pdfError.message, quotation_id });
    }

    client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingQuotation = await client.query('SELECT id FROM public.fwcquotations WHERE quotation_id = $1', [quotation_id]);
      if (existingQuotation.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Quotation ID already exists', quotation_id });
      }

      const result = await client.query(`
        INSERT INTO public.fwcquotations 
        (customer_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17)
        RETURNING id, created_at, customer_type, pdf, quotation_id
      `, [
        customer_id || null,
        quotation_id,
        JSON.stringify(enhancedProducts),
        parsedNetRate,
        parsedYouSave,
        parsedTotal,
        parsedPromoDiscount,
        parsedAdditionalDiscount,
        customerDetails.address || null,
        customerDetails.mobile_number || null,
        customerDetails.customer_name || null,
        customerDetails.email || null,
        customerDetails.district || null,
        customerDetails.state || null,
        finalCustomerType,
        'pending',
        pdfPath
      ]);

      console.log(`Quotation created`);

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Quotation created successfully',
        quotation_id: result.rows[0].quotation_id,
        pdf_path: pdfPath
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      if (client) client.release();
    }
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    console.error(`Failed: Failed to create quotation for quotation_id ${req.body.quotation_id}: ${err.message}`);
    res.status(500).json({ message: 'Failed to create quotation', error: err.message, quotation_id: req.body.quotation_id });
  }
};

// ... existing imports ...

exports.updateQuotation = async (req, res) => {
  let client;
  try {
    const { quotation_id } = req.params;
    const {
      products,
      net_rate,
      you_save,
      total,
      promo_discount,
      additional_discount,
      status,
      customer_id, // NEW: allow changing customer
    } = req.body;

    // ---------- 1. VALIDATE ----------
    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id))
      return res.status(400).json({ message: 'Invalid Quotation ID', quotation_id });

    // ---------- 2. FETCH CURRENT QUOTATION ----------
    const qCheck = await pool.query(
      'SELECT * FROM public.fwcquotations WHERE quotation_id = $1',
      [quotation_id]
    );
    if (qCheck.rows.length === 0)
      return res.status(404).json({ message: 'Quotation not found', quotation_id });

    const quotation = qCheck.rows[0];

    // ---------- 3. FETCH NEW CUSTOMER DETAILS (if customer_id changed) ----------
    let customerDetails = {
      customer_name: quotation.customer_name,
      address: quotation.address,
      mobile_number: quotation.mobile_number,
      email: quotation.email,
      district: quotation.district,
      state: quotation.state,
      customer_type: quotation.customer_type,
      created_at: quotation.created_at,
    };
    let agent_name = null;

    if (customer_id && customer_id !== quotation.customer_id?.toString()) {
      const custRes = await pool.query(
        `SELECT id, customer_name, address, mobile_number, email,
                district, state, customer_type, agent_id
         FROM public.customers WHERE id = $1`,
        [customer_id]
      );
      if (custRes.rows.length === 0)
        return res.status(404).json({ message: 'Customer not found', quotation_id });

      const cust = custRes.rows[0];
      customerDetails = {
        customer_name: cust.customer_name,
        address: cust.address,
        mobile_number: cust.mobile_number,
        email: cust.email,
        district: cust.district,
        state: cust.state,
        customer_type: cust.customer_type,
        created_at: quotation.created_at, // keep original creation date
      };

      if (cust.customer_type === 'Customer of Selected Agent' && cust.agent_id) {
        const ag = await pool.query(
          'SELECT customer_name FROM public.customers WHERE id = $1',
          [cust.agent_id]
        );
        if (ag.rows.length > 0) agent_name = ag.rows[0].customer_name;
      }
    }

    // ---------- 4. BUILD PRODUCTS ----------
    let enhancedProducts = quotation.products ? (typeof quotation.products === 'string' ? JSON.parse(quotation.products) : quotation.products) : [];

    if (products && Array.isArray(products)) {
      enhancedProducts = [];
      for (const p of products) {
        const { id, product_type, quantity, price, discount, productname, per } = p;
        if (!id || !product_type || !productname || quantity < 1 ||
            isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
          return res.status(400).json({ message: 'Invalid product entry', quotation_id });

        let productPer = per || 'Unit';
        if (product_type.toLowerCase() !== 'custom') {
          const tbl = product_type.toLowerCase().replace(/\s+/g, '_');
          const pr = await pool.query(`SELECT per FROM public.${tbl} WHERE id = $1`, [id]);
          if (pr.rows.length === 0)
            return res.status(404).json({ message: `Product ${id} not found`, quotation_id });
          productPer = pr.rows[0].per || productPer;
        }
        enhancedProducts.push({ ...p, per: productPer });
      }
    }

    // ---------- 5. UPDATE DATABASE (no pdf column) ----------
    const updateFields = [];
    const updateVals = [];
    let idx = 1;

    if (products) {
      updateFields.push(`products = $${idx++}`);
      updateVals.push(JSON.stringify(enhancedProducts));
    }
    if (net_rate !== undefined) {
      updateFields.push(`net_rate = $${idx++}`);
      updateVals.push(parseFloat(net_rate));
    }
    if (you_save !== undefined) {
      updateFields.push(`you_save = $${idx++}`);
      updateVals.push(parseFloat(you_save));
    }
    if (total !== undefined) {
      updateFields.push(`total = $${idx++}`);
      updateVals.push(parseFloat(total));
    }
    if (promo_discount !== undefined) {
      updateFields.push(`promo_discount = $${idx++}`);
      updateVals.push(parseFloat(promo_discount));
    }
    if (additional_discount !== undefined) {
      updateFields.push(`additional_discount = $${idx++}`);
      updateVals.push(parseFloat(additional_discount));
    }
    if (status) {
      updateFields.push(`status = $${idx++}`);
      updateVals.push(status);
    }

    // Update customer fields if customer changed
    if (customer_id && customer_id !== quotation.customer_id?.toString()) {
      updateFields.push(`customer_id = $${idx++}`);     updateVals.push(customer_id);
      updateFields.push(`customer_name = $${idx++}`);   updateVals.push(customerDetails.customer_name);
      updateFields.push(`address = $${idx++}`);         updateVals.push(customerDetails.address);
      updateFields.push(`mobile_number = $${idx++}`);   updateVals.push(customerDetails.mobile_number);
      updateFields.push(`email = $${idx++}`);           updateVals.push(customerDetails.email);
      updateFields.push(`district = $${idx++}`);        updateVals.push(customerDetails.district);
      updateFields.push(`state = $${idx++}`);           updateVals.push(customerDetails.state);
      updateFields.push(`customer_type = $${idx++}`);   updateVals.push(customerDetails.customer_type);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    updateFields.push(`updated_at = NOW()`);
    updateVals.push(quotation_id); // for WHERE clause

    const sql = `
      UPDATE public.fwcquotations
      SET ${updateFields.join(', ')}
      WHERE quotation_id = $${idx}
      RETURNING id, quotation_id, status
    `;

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(sql, updateVals);
    await client.query('COMMIT');

    // ---------- 6. GENERATE PDF IN MEMORY ----------
    const pdfBuffer = await generatePDFBuffer(
      'quotation',
      {
        quotation_id,
        customer_type: customerDetails.customer_type,
        total: total !== undefined ? parseFloat(total) : parseFloat(quotation.total || 0),
        agent_name,
      },
      customerDetails,
      enhancedProducts,
      {
        net_rate: net_rate !== undefined ? parseFloat(net_rate) : parseFloat(quotation.net_rate || 0),
        you_save: you_save !== undefined ? parseFloat(you_save) : parseFloat(quotation.you_save || 0),
        additional_discount: additional_discount !== undefined ? parseFloat(additional_discount) : parseFloat(quotation.additional_discount || 0),
      }
    );

    // ---------- 7. STREAM PDF BUFFER ----------
    const safeName = (customerDetails.customer_name || 'customer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${safeName}-${quotation_id}-quotation.pdf`
    );
    res.send(pdfBuffer);

  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
    }
    console.error('updateQuotation error:', err);
    res.status(500).json({ message: 'Failed to update quotation', error: err.message });
  }
};

exports.deleteQuotation = async (req, res) => {
  try {
    const { quotation_id } = req.params;
    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id)) 
      return res.status(400).json({ message: 'Invalid or missing Quotation ID', quotation_id });

    const quotationCheck = await pool.query(
      'SELECT * FROM public.fwcquotations WHERE quotation_id = $1 AND status = $2',
      [quotation_id, 'pending']
    );
    if (quotationCheck.rows.length === 0) 
      return res.status(404).json({ message: 'Quotation not found or not in pending status', quotation_id });

    await pool.query(
      'UPDATE public.fwcquotations SET status = $1, updated_at = NOW() WHERE quotation_id = $2',
      ['canceled', quotation_id]
    );

    res.status(200).json({ message: 'Quotation canceled successfully', quotation_id });
  } catch (err) {
    console.error(`Failed: Failed to cancel quotation for quotation_id ${req.params.quotation_id}: ${err.message}`);
    res.status(500).json({ message: 'Failed to cancel quotation', error: err.message, quotation_id: req.params.quotation_id });
  }
};

exports.getQuotation = async (req, res) => {
  try {
    let { quotation_id } = req.params;
    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id)) {
      return res.status(400).json({ message: 'Invalid quotation_id' });
    }
    if (quotation_id.endsWith('.pdf')) quotation_id = quotation_id.replace(/\.pdf$/, '');

    const result = await pool.query(
      `SELECT products, net_rate, you_save, total, promo_discount, additional_discount,
              customer_name, address, mobile_number, email, district, state, customer_type,
              customer_id, created_at
       FROM public.fwcquotations WHERE quotation_id = $1`,
      [quotation_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const row = result.rows[0];
    let agent_name = null;
    if (row.customer_type === 'Customer of Selected Agent' && row.customer_id) {
      const agentRes = await pool.query(
        `SELECT c2.customer_name AS agent_name
         FROM public.customers c1
         JOIN public.customers c2 ON c1.agent_id = c2.id
         WHERE c1.id = $1`,
        [row.customer_id]
      );
      agent_name = agentRes.rows[0]?.agent_name || null;
    }

    // Enhance products with 'per' if missing
    let parsedProducts = typeof row.products === 'string' ? JSON.parse(row.products) : row.products;
    for (const p of parsedProducts) {
      if (!p.per && p.product_type.toLowerCase() !== 'custom') {
        const tableName = p.product_type.toLowerCase().replace(/\s+/g, '_');
        const perRes = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [p.id]);
        if (perRes.rows.length > 0) p.per = perRes.rows[0].per;
      }
    }

    // Generate PDF buffer dynamically
    const pdfBuffer = await generatePDFBuffer(
      'quotation',
      { quotation_id, customer_type: row.customer_type, agent_name },
      { ...row, created_at: row.created_at },
      parsedProducts,
      {
        net_rate: parseFloat(row.net_rate || 0),
        you_save: parseFloat(row.you_save || 0),
        total: parseFloat(row.total || 0),
        additional_discount: parseFloat(row.additional_discount || 0),
      }
    );

    const safeCustomerName = (row.customer_name || 'unknown')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${quotation_id}-quotation.pdf`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('getQuotation error:', err);
    res.status(500).json({ message: 'Failed to generate quotation PDF', error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  let client;
  try {
    const {
      customer_id, order_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount,
      customer_type, customer_name, address, mobile_number, email, district, state
    } = req.body;

    console.log(`Received createBooking request with order_id: ${order_id}`);

    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) 
      return res.status(400).json({ message: 'Invalid or missing Order ID', order_id });

    if (!Array.isArray(products) || products.length === 0) 
      return res.status(400).json({ message: 'Products array is required and must not be empty', order_id });

    if (!total || isNaN(parseFloat(total)) || parseFloat(total) <= 0) 
      return res.status(400).json({ message: 'Total must be a positive number', order_id });

    const parsedNetRate = parseFloat(net_rate) || 0;
    const parsedYouSave = parseFloat(you_save) || 0;
    const parsedPromoDiscount = parseFloat(promo_discount) || 0;
    const parsedAdditionalDiscount = parseFloat(additional_discount) || 0;
    const parsedTotal = parseFloat(total);

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, promo_discount, additional_discount, and total must be valid numbers', order_id });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };
    let agent_name = null;

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type, agent_id FROM public.customers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) 
        return res.status(404).json({ message: 'Customer not found', order_id });

      const customerRow = customerCheck.rows[0];
      finalCustomerType = customer_type || customerRow.customer_type || 'User';
      customerDetails = {
        customer_name: customerRow.customer_name,
        address: customerRow.address,
        mobile_number: customerRow.mobile_number,
        email: customerRow.email,
        district: customerRow.district,
        state: customerRow.state
      };

      if (finalCustomerType === 'Customer of Selected Agent' && customerRow.agent_id) {
        const agentCheck = await pool.query('SELECT customer_name FROM public.customers WHERE id = $1', [customerRow.agent_id]);
        if (agentCheck.rows.length > 0) agent_name = agentCheck.rows[0].customer_name;
      }
    } else {
      if (finalCustomerType !== 'User') 
        return res.status(400).json({ message: 'Customer type must be "User" for bookings without customer ID', order_id });
      if (!customer_name || !address || !district || !state || !mobile_number)
        return res.status(400).json({ message: 'All customer details must be provided', order_id });
    }

    const enhancedProducts = [];
    for (const product of products) {
      const { id, product_type, quantity, price, discount, productname, per } = product;
      if (!id || !product_type || !productname || quantity < 1 || isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
        return res.status(400).json({ message: 'Invalid product entry (id, product_type, productname, quantity, price, discount required)', order_id });

      let productPer = per || 'Unit';
      if (product_type.toLowerCase() !== 'custom') {
        const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
        const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
        if (productCheck.rows.length === 0)
          return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable`, order_id });
        productPer = productCheck.rows[0].per || productPer;
      }
      enhancedProducts.push({ ...product, per: productPer });
    }

    let pdfPath;
    try {
      const pdfResult = await generatePDFBuffer(
        'invoice',
        { order_id, customer_type: finalCustomerType, total: parsedTotal, agent_name },
        customerDetails,
        enhancedProducts,
        { net_rate: parsedNetRate, you_save: parsedYouSave, total: parsedTotal, promo_discount: parsedPromoDiscount, additional_discount: parsedAdditionalDiscount }
      );
      console.log(`PDF generated`);
    } catch (pdfError) {
      console.error(`Failed: PDF generation failed for order_id ${order_id}: ${pdfError.message}`);
      return res.status(500).json({ message: 'Failed to generate PDF', error: pdfError.message, order_id });
    }

    client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingBooking = await client.query('SELECT id FROM public.bookings WHERE order_id = $1', [order_id]);
      if (existingBooking.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Order ID already exists', order_id });
      }

      const result = await client.query(`
        INSERT INTO public.bookings 
        (customer_id, order_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18)
        RETURNING id, created_at, customer_type, pdf, order_id
      `, [
        customer_id || null,
        order_id,
        quotation_id || null,
        JSON.stringify(enhancedProducts),
        parsedNetRate,
        parsedYouSave,
        parsedTotal,
        parsedPromoDiscount,
        parsedAdditionalDiscount,
        customerDetails.address || null,
        customerDetails.mobile_number || null,
        customerDetails.customer_name || null,
        customerDetails.email || null,
        customerDetails.district || null,
        customerDetails.state || null,
        finalCustomerType,
        'booked',
        pdfPath
      ]);

      console.log(`Booking created`);

      if (quotation_id) {
        const quotationCheck = await client.query(
          'SELECT id FROM public.fwcquotations WHERE quotation_id = $1 AND status = $2',
          [quotation_id, 'pending']
        );
        if (quotationCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'Quotation not found or not in pending status', order_id });
        }

        await client.query(
          'UPDATE public.fwcquotations SET status = $1, updated_at = NOW() WHERE quotation_id = $2',
          ['booked', quotation_id]
        );
      }

      await client.query('COMMIT');
      res.status(200).json({
        message: 'Booking created successfully',
        order_id: result.rows[0].order_id,
        pdf_path: pdfPath
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      if (client) client.release();
    }
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    console.error(`Failed: Failed to create booking for order_id ${req.body.order_id}: ${err.message}`);
    res.status(500).json({ message: 'Failed to create booking', error: err.message, order_id: req.body.order_id });
  }
};

exports.updateBooking = async (req, res) => {
  try {
    const { order_id } = req.params;
    const { products, net_rate, you_save, total, promo_discount, additional_discount, status, transport_details } = req.body;

    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) 
      return res.status(400).json({ message: 'Invalid or missing Order ID', order_id });
    if (products && (!Array.isArray(products) || products.length === 0)) 
      return res.status(400).json({ message: 'Products array is required and must not be empty', order_id });
    if (total && (isNaN(parseFloat(total)) || parseFloat(total) <= 0)) 
      return res.status(400).json({ message: 'Total must be a positive number', order_id });
    if (status && !['booked', 'paid', 'dispatched', 'canceled'].includes(status)) 
      return res.status(400).json({ message: 'Invalid status', order_id });
    if (status === 'dispatched' && !transport_details) 
      return res.status(400).json({ message: 'Transport details required for dispatched status', order_id });

    const parsedNetRate = net_rate !== undefined ? parseFloat(net_rate) : undefined;
    const parsedYouSave = you_save !== undefined ? parseFloat(you_save) : undefined;
    const parsedPromoDiscount = promo_discount !== undefined ? parseFloat(promo_discount) : undefined;
    const parsedAdditionalDiscount = additional_discount !== undefined ? parseFloat(additional_discount) : undefined;
    const parsedTotal = total !== undefined ? parseFloat(total) : undefined;

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => v !== undefined && isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, total, promo_discount, and additional_discount must be valid numbers', order_id });

    const bookingCheck = await pool.query(
      'SELECT * FROM public.bookings WHERE order_id = $1',
      [order_id]
    );
    if (bookingCheck.rows.length === 0) 
      return res.status(404).json({ message: 'Booking not found', order_id });

    const booking = bookingCheck.rows[0];
    let customerDetails = {
      customer_name: booking.customer_name,
      address: booking.address,
      mobile_number: booking.mobile_number,
      email: booking.email,
      district: booking.district,
      state: booking.state
    };
    let agent_name = null;

    if (booking.customer_id) {
      const customerCheck = await pool.query(
        'SELECT customer_name, address, mobile_number, email, district, state, customer_type, agent_id FROM public.customers WHERE id = $1',
        [booking.customer_id]
      );
      if (customerCheck.rows.length > 0) {
        customerDetails = customerCheck.rows[0];
        if (customerDetails.customer_type === 'Customer of Selected Agent' && customerDetails.agent_id) {
          const agentCheck = await pool.query('SELECT customer_name FROM public.customers WHERE id = $1', [customerDetails.agent_id]);
          if (agentCheck.rows.length > 0) agent_name = agentCheck.rows[0].customer_name;
        }
      }
    }

    let enhancedProducts = booking.products;
    if (products) {
      enhancedProducts = [];
      for (const product of products) {
        const { id, product_type, quantity, price, discount } = product;
        if (!id || !product_type || quantity < 1 || isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
          return res.status(400).json({ message: 'Invalid product entry', order_id });

        const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
        const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
        if (productCheck.rows.length === 0)
          return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable`, order_id });
        const per = productCheck.rows[0].per || '';
        enhancedProducts.push({ ...product, per });
      }
    }

    let pdfPath = booking.pdf;
    if (products || parsedTotal !== undefined) {
      const pdfResult = await generatePDFBuffer(
        'invoice',
        { order_id, customer_type: booking.customer_type, total: parsedTotal || parseFloat(booking.total || 0), agent_name },
        customerDetails,
        enhancedProducts,
        {
          net_rate: parsedNetRate !== undefined ? parsedNetRate : parseFloat(booking.net_rate || 0),
          you_save: parsedYouSave !== undefined ? parsedYouSave : parseFloat(booking.you_save || 0),
          total: parsedTotal !== undefined ? parsedTotal : parseFloat(booking.total || 0),
          promo_discount: parsedPromoDiscount !== undefined ? parsedPromoDiscount : parseFloat(booking.promo_discount || 0),
          additional_discount: parsedAdditionalDiscount !== undefined ? parsedAdditionalDiscount : parseFloat(booking.additional_discount || 0)
        }
      );
    }

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (products) {
      updateFields.push(`products = $${paramIndex++}`);
      updateValues.push(JSON.stringify(enhancedProducts));
    }
    if (parsedNetRate !== undefined) {
      updateFields.push(`net_rate = $${paramIndex++}`);
      updateValues.push(parsedNetRate);
    }
    if (parsedYouSave !== undefined) {
      updateFields.push(`you_save = $${paramIndex++}`);
      updateValues.push(parsedYouSave);
    }
    if (parsedTotal !== undefined) {
      updateFields.push(`total = $${paramIndex++}`);
      updateValues.push(parsedTotal);
    }
    if (parsedPromoDiscount !== undefined) {
      updateFields.push(`promo_discount = $${paramIndex++}`);
      updateValues.push(parsedPromoDiscount);
    }
    if (parsedAdditionalDiscount !== undefined) {
      updateFields.push(`additional_discount = $${paramIndex++}`);
      updateValues.push(parsedAdditionalDiscount);
    }
    if (pdfPath) {
      updateFields.push(`pdf = $${paramIndex++}`);
      updateValues.push(pdfPath);
    }
    if (status) {
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(status);
    }
    if (transport_details) {
      updateFields.push(`transport_details = $${paramIndex++}`);
      updateValues.push(JSON.stringify(transport_details));
    }
    updateFields.push(`updated_at = NOW()`);

    if (updateFields.length === 1) {
      return res.status(400).json({ message: 'No fields to update', order_id });
    }

    const query = `
      UPDATE public.bookings 
      SET ${updateFields.join(', ')}
      WHERE order_id = $${paramIndex}
      RETURNING id, order_id, status
    `;
    updateValues.push(order_id);

    const result = await pool.query(query, updateValues);

    if (!fs.existsSync(pdfPath)) {
      console.error(`Failed: PDF file not found at ${pdfPath} for order_id ${order_id}`);
      return res.status(500).json({ message: 'PDF file not found after update', error: 'File system error', order_id });
    }
    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        console.error(`Failed: Cannot read PDF file at ${pdfPath} for order_id ${order_id}: ${err.message}`);
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message, order_id });
      }
      const safeCustomerName = (customerDetails.customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${order_id}-invoice.pdf`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        console.error(`Failed: Failed to stream PDF for order_id ${order_id}: ${streamErr.message}`);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message, order_id });
        }
      });
      readStream.pipe(res);
      console.log(`PDF streaming initiated for order_id: ${order_id}`);
    });
  } catch (err) {
    console.error(`Failed: Failed to update booking for order_id ${req.params.order_id}: ${err.message}`);
    res.status(500).json({ message: 'Failed to update booking', error: err.message, order_id: req.params.order_id });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const { order_id } = req.params;
    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) {
      return res.status(400).json({ message: 'Invalid order_id' });
    }

    const result = await pool.query(
      `SELECT products, net_rate, you_save, total, promo_discount, additional_discount,
              customer_name, address, mobile_number, email, district, state, customer_type,
              customer_id, created_at
       FROM public.bookings WHERE order_id = $1`,
      [order_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const row = result.rows[0];
    let agent_name = null;
    if (row.customer_type === 'Customer of Selected Agent' && row.customer_id) {
      const agentRes = await pool.query(
        `SELECT c2.customer_name AS agent_name
         FROM public.customers c1
         JOIN public.customers c2 ON c1.agent_id = c2.id
         WHERE c1.id = $1`,
        [row.customer_id]
      );
      agent_name = agentRes.rows[0]?.agent_name || null;
    }

    let parsedProducts = typeof row.products === 'string' ? JSON.parse(row.products) : row.products;
    for (const p of parsedProducts) {
      if (!p.per && p.product_type.toLowerCase() !== 'custom') {
        const tableName = p.product_type.toLowerCase().replace(/\s+/g, '_');
        const perRes = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [p.id]);
        if (perRes.rows.length > 0) p.per = perRes.rows[0].per;
      }
    }

    const pdfBuffer = await generatePDFBuffer(
      'invoice',
      { order_id, customer_type: row.customer_type, agent_name },
      { ...row, created_at: row.created_at },
      parsedProducts,
      {
        net_rate: parseFloat(row.net_rate || 0),
        you_save: parseFloat(row.you_save || 0),
        total: parseFloat(row.total || 0),
        additional_discount: parseFloat(row.additional_discount || 0),
      }
    );

    const safeCustomerName = (row.customer_name || 'unknown')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${order_id}-invoice.pdf`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('getInvoice error:', err);
    res.status(500).json({ message: 'Failed to generate invoice PDF', error: err.message });
  }
};

exports.searchBookings = async (req, res) => {
  try {
    const { customer_name, mobile_number } = req.body;

    if (!customer_name || !mobile_number) {
      return res.status(400).json({ message: 'Customer name and mobile number are required' });
    }

    const query = `
      SELECT id, order_id, quotation_id, products, net_rate, you_save, total, 
             promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, 
             customer_type, status, created_at, pdf, transport_name, lr_number, transport_contact,
             processing_date, dispatch_date, delivery_date
      FROM public.bookings 
      WHERE LOWER(customer_name) LIKE LOWER($1) 
      AND mobile_number LIKE $2
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [`%${customer_name}%`, `%${mobile_number}%`]);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to search bookings', error: err.message });
  }
};

exports.searchQuotations = async (req, res) => {
  try {
    const { customer_name, mobile_number } = req.body;

    if (!customer_name || !mobile_number) {
      return res.status(400).json({ message: "Customer name and mobile number are required" });
    }

    const query = `
      SELECT id, quotation_id, products, net_rate, you_save, total, 
             promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, 
             customer_type, status, created_at, pdf
      FROM public.fwcquotations
      WHERE LOWER(customer_name) LIKE LOWER($1) 
      AND mobile_number LIKE $2
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [`%${customer_name}%`, `%${mobile_number}%`]);
    
    const quotations = result.rows.map(row => ({
      ...row,
      type: 'quotation',
      transport_name: null,
      lr_number: null,
      transport_contact: null,
      dispatch_date: null,
      delivery_date: null,
    }));

    res.status(200).json(quotations);
  } catch (err) {
    res.status(500).json({ message: "Failed to search quotations", error: err.message });
  }
};

exports.exportQuotationsToExcel = async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    const result = await client.query(`
      SELECT
        quotation_id,
        customer_name,
        customer_type,
        customer_id,
        total,
        created_at
      FROM public.fwcquotations
      ORDER BY created_at DESC
    `);

    const quotations = result.rows;

    // Group by customer_type
    const grouped = quotations.reduce((acc, q) => {
      let type = q.customer_type?.trim() || "User";
      if (type === "Customer of Selected Agent") type = "Customer of Selected Agent";
      if (!acc[type]) acc[type] = [];
      acc[type].push(q);
      return acc;
    }, {});

    const workbook = XLSX.utils.book_new();

    const sheetConfig = [
      { type: "User", name: "User_Quotations" },
      { type: "Customer", name: "Customer_Quotations" },
      { type: "Agent", name: "Agent_Quotations" },
      { type: "Customer of Selected Agent", name: "Cust_of_Agent" },
    ];

    for (const { type, name } of sheetConfig) {
      let data = grouped[type] || [];
      if (data.length === 0) continue;

      // Fetch Agent Name only for "Customer of Selected Agent"
      if (type === "Customer of Selected Agent") {
        for (let q of data) {
          if (q.customer_id) {
            try {
              const agentRes = await client.query(`
                SELECT c2.customer_name AS agent_name
                FROM public.customers c1
                INNER JOIN public.customers c2 ON c1.agent_id = c2.id
                WHERE c1.id = $1
              `, [q.customer_id]);
              q.agent_name = agentRes.rows[0]?.agent_name || "N/A";
            } catch (err) {
              q.agent_name = "Error";
            }
          } else {
            q.agent_name = "N/A";
          }
        }
      }

      const rows = data.map(q => ({
        "Quotation ID": q.quotation_id || "N/A",
        "Customer Name": q.customer_name || "N/A",
        "Customer Type": q.customer_type || "User",
        "Total Amount": q.total ? `₹${Math.round(Number(q.total))}` : "₹0",
        "Date": q.created_at ? new Date(q.created_at).toLocaleDateString('en-GB') : "N/A",
        ...(type === "Customer of Selected Agent" ? { "Agent Name": q.agent_name || "N/A" } : {})
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const colWidths = rows.reduce((acc, row) => {
        Object.keys(row).forEach((key, i) => {
          const len = (row[key] || "").toString().length;
          acc[i] = Math.max(acc[i] || 10, len + 4);
        });
        return acc;
      }, []);
      worksheet["!cols"] = colWidths.map(w => ({ wch: w }));

      const safeName = name.replace(/[*?:/\\[\]]/g, "_").substring(0, 31);
      XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
    }

    try {
      console.log("Generating Agent-wise Product Quotation Sheets...");

      // Fetch all quotations under "Customer of Selected Agent" with agent_name joined
      const agentQuotationsResult = await client.query(`
        SELECT q.products, q.customer_id, c2.customer_name AS agent_name
        FROM public.fwcquotations q
        INNER JOIN public.customers c ON q.customer_id = c.id
        INNER JOIN public.customers c2 ON c.agent_id = c2.id
        WHERE c.customer_type = 'Customer of Selected Agent'
          AND c.agent_id IS NOT NULL
          AND q.products IS NOT NULL
      `);

      // Aggregate: Agent → Product → Total Quantity
      const agentProductTotals = {};

      for (const row of agentQuotationsResult.rows) {
        const agentName = row.agent_name || "Unknown Agent";
        if (!agentProductTotals[agentName]) agentProductTotals[agentName] = {};

        let products = [];
        try {
          products = typeof row.products === 'string' ? JSON.parse(row.products) : row.products;
        } catch (e) {
          continue;
        }

        products.forEach(p => {
          const name = (p.productname || "Unknown Product").trim();
          const qty = parseInt(p.quantity) || 0;
          agentProductTotals[agentName][name] = (agentProductTotals[agentName][name] || 0) + qty;
        });
      }

      // Create one sheet per agent
      for (const [agentName, productMap] of Object.entries(agentProductTotals)) {
        const rows = Object.entries(productMap)
          .map(([productName, totalQty]) => ({
            "Product Name": productName,
            "Total Quoted Quantity": totalQty
          }))
          .sort((a, b) => b["Total Quoted Quantity"] - a["Total Quoted Quantity"]);

        if (rows.length === 0) continue;

        const worksheet = XLSX.utils.json_to_sheet(rows);

        // Auto-size columns
        worksheet["!cols"] = [
          { wch: 45 },
          { wch: 20 }
        ];

        // Safe sheet name
        let baseName = agentName.replace(/[*?:/\\[\]]/g, "_").substring(0, 28);
        if (baseName.length < 3) baseName = "Agent";
        let sheetName = baseName;
        let counter = 1;
        while (workbook.SheetNames.includes(sheetName)) {
          sheetName = baseName.substring(0, 31 - `_${counter}`.length) + `_${counter}`;
          counter++;
        }

        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      }

      // Optional: Add "All Agents Combined" Summary Sheet
      const allAgentProducts = {};
      for (const productMap of Object.values(agentProductTotals)) {
        for (const [name, qty] of Object.entries(productMap)) {
          allAgentProducts[name] = (allAgentProducts[name] || 0) + qty;
        }
      }

      if (Object.keys(allAgentProducts).length > 0) {
        const allRows = Object.entries(allAgentProducts)
          .map(([name, qty]) => ({
            "Product Name": name,
            "Total Quoted (All Agents)": qty
          }))
          .sort((a, b) => b["Total Quoted (All Agents)"] - a["Total Quoted (All Agents)"]);

        const allWs = XLSX.utils.json_to_sheet(allRows);
        allWs["!cols"] = [{ wch: 50 }, { wch: 25 }];
        XLSX.utils.book_append_sheet(workbook, allWs, "All_Agents_Products");
      }
    } catch (agentErr) {
      console.error("Agent product sheets failed (continuing export):", agentErr.message);
      // Non-critical error — continue
    }

    const fileName = `PhoenixCrackers_Export_${new Date().toISOString().slice(0,10)}.xlsx`;
    const filePath = path.join(__dirname, '../exports', fileName);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    XLSX.writeFile(workbook, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error("Download failed:");
        if (!res.headersSent) res.status(500).send("Failed to download file");
      } else {
        console.log(`Exported successfully: ${fileName}`);
      }
    });

  } catch (err) {
    console.error("Export failed completely:");
    if (!res.headersSent) {
      res.status(500).json({
        message: "Export failed",
        error: err.message
      });
    }
  } finally {
    if (client) client.release();
  }
};
