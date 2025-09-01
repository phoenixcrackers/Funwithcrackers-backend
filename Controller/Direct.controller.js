const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

// Initialize PostgreSQL pool
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const generatePDF = (type, data, customerDetails, products, dbValues) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const safeCustomerName = (customerDetails.customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const pdfDir = path.resolve(__dirname, '../pdf_data');
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
        fs.chmodSync(pdfDir, 0o770);
      }
      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${data.order_id || data.quotation_id}-${type}.pdf`);
      const stream = fs.createWriteStream(pdfPath, { flags: 'w', mode: 0o660 });
      doc.pipe(stream);

      doc.fontSize(20).font('Helvetica-Bold').text(type === 'quotation' ? 'Quotation' : 'Estimate Bill', 50, 50, { align: 'center' });
      doc.fontSize(12).font('Helvetica')
        .text('Phoenix Crackers', 50, 80)
        .text('Sivakasi', 50, 95)
        .text('Mobile: +91 63836 59214', 50, 110)
        .text('Email: nivasramasamy27@gmail.com', 50, 125)
        .text('Website: www.funwithcrackers.com', 50, 140);

      const customerType = data.customer_type === 'Customer of Selected Agent' ? 'Customer - Agent' : data.customer_type || 'User';
      let addressLine1 = customerDetails.address || 'N/A';
      let addressLine2 = '';
      if (addressLine1.length > 30) {
        const splitIndex = addressLine1.lastIndexOf(' ', 30);
        addressLine2 = addressLine1.slice(splitIndex + 1);
        addressLine1 = addressLine1.slice(0, splitIndex);
      }
      doc.fontSize(12).font('Helvetica')
        .text(`${type === 'quotation' ? 'Quotation ID' : 'Order ID'}: ${data.quotation_id || data.order_id}`, 300, 80, { align: 'right' })
        .text(`Date: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`, 300, 95, { align: 'right' })
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

      const tableY = 250;
      const tableWidth = 500;
      const colWidths = [30, 150, 50, 70, 70, 50, 100];
      const colX = [50, 80, 210, 250, 320, 400, 450];
      const rowHeight = 25;
      const pageHeight = doc.page.height - doc.page.margins.bottom;

      doc.moveTo(50, tableY - 5).lineTo(50 + tableWidth, tableY - 5).stroke();
      doc.fontSize(10).font('Helvetica-Bold')
        .text('Sl.No', colX[0] + 5, tableY, { width: colWidths[0] - 10, align: 'center' })
        .text('Product', colX[1] + 5, tableY, { width: colWidths[1] - 10, align: 'left' })
        .text('Qty', colX[2] + 5, tableY, { width: colWidths[2] - 10, align: 'center' })
        .text('Rate', colX[3] + 5, tableY, { width: colWidths[3] - 10, align: 'left' })
        .text('Disc Rate', colX[4] + 5, tableY, { width: colWidths[4] - 10, align: 'left' })
        .text('Per', colX[5] + 5, tableY, { width: colWidths[5] - 10, align: 'center' })
        .text('Total', colX[6] + 5, tableY, { width: colWidths[6] - 10, align: 'left' });
      doc.moveTo(50, tableY + 15).lineTo(50 + tableWidth, tableY + 15).stroke();
      colX.forEach((x, i) => {
        doc.moveTo(x, tableY - 5).lineTo(x, tableY + 15).stroke();
        if (i === colX.length - 1) {
          doc.moveTo(x + colWidths[i], tableY - 5).lineTo(x + colWidths[i], tableY + 15).stroke();
        }
      });

      let y = tableY + rowHeight;
      products.forEach((product, index) => {
        if (y + rowHeight > pageHeight - 50) {
          doc.addPage();
          y = doc.page.margins.top + 20;
          doc.moveTo(50, y - 5).lineTo(50 + tableWidth, y - 5).stroke();
          doc.fontSize(10).font('Helvetica-Bold')
            .text('Sl.No', colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
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
        .text(`Total: Rs.${total.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
      y += 20;
      if (additionalDiscount > 0) {
        doc.text(`Discount: Rs.${additionalDiscountAmount.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
        y += 20;
        doc.text(`Grand Total: Rs.${grandTotal.toFixed(2)}`, 350, y, { width: 150, align: 'right' });
        y += 20;
      }

      y += 30;
      if (y + 50 > pageHeight - 50) {
        doc.addPage();
        y = doc.page.margins.top + 20;
      }
      doc.fontSize(10).font('Helvetica')
        .text('Thank you for your business!', 50, y, { align: 'center' })
        .text('For any queries, contact us at +91 63836 59214', 50, y + 15, { align: 'center' });

      doc.end();
      stream.on('finish', () => {
        if (!fs.existsSync(pdfPath)) {
          reject(new Error(`PDF file not created at ${pdfPath}`));
          return;
        }
        fs.access(pdfPath, fs.constants.R_OK, (err) => {
          if (err) {
            reject(new Error(`PDF file at ${pdfPath} is not readable: ${err.message}`));
            return;
          }
          resolve({ pdfPath, calculatedTotal: total });
        });
      });
      stream.on('error', (err) => {
        reject(new Error(`Stream error while creating PDF at ${pdfPath}: ${err.message}`));
      });
    } catch (err) {
      reject(new Error(`Error generating PDF: ${err.message}`));
    }
  });
};

async function sendBookingEmail(toEmail, bookingData, customerDetails, pdfPath, products, type, status = 'booked', transportDetails = null) {
  try {
    if (!fs.existsSync(pdfPath)) {
      throw new Error('PDF file does not exist for email');
    }

    const emailUser = process.env.EMAIL_USER || 'phoenixcrackersfwc@gmail.com';
    const emailPass = process.env.EMAIL_PASS || 'eegm mdht oehj bbhg';
    if (!emailUser || !emailPass) {
      throw new Error('Email credentials not configured in environment variables');
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: emailUser,
        pass: emailPass,
      },
      logger: true,
      debug: true,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    await transporter.verify();

    const productList = products.map(p =>
      `- ${p.productname || 'N/A'}: ${p.quantity || 1} x Rs.${parseFloat(p.price || 0).toFixed(2)}`
    ).join('\n');

    let subject, text;
    const idField = type === 'quotation' ? 'Quotation ID' : 'Order ID';
    const idValue = bookingData.quotation_id || bookingData.order_id;

    if (toEmail === 'nivasramasamy27@gmail.com' && type === 'quotation') {
      subject = `New Quotation Notification: ${idValue}`;
      text = `
A new quotation has been made with Phoenix Crackers.

Quotation Details:
${idField}: ${idValue}
Customer Name: ${customerDetails.customer_name || 'N/A'}
Mobile: ${customerDetails.mobile_number || 'N/A'}
Email: ${customerDetails.email || 'N/A'}
Address: ${customerDetails.address || 'N/A'}
District: ${customerDetails.district || 'N/A'}
State: ${customerDetails.state || 'N/A'}
Customer Type: ${bookingData.customer_type || 'User'}
Net Rate: Rs.${parseFloat(bookingData.net_rate || 0).toFixed(2)}
You Save: Rs.${parseFloat(bookingData.you_save || 0).toFixed(2)}
Additional Discount: ${parseFloat(bookingData.additional_discount || 0).toFixed(2)}%
Total: Rs.${parseFloat(bookingData.total || 0).toFixed(2)}

Attached is the quotation for reference.

Best regards,
Phoenix Crackers Team
      `;
    } else if (toEmail === 'nivasramasamy27@gmail.com' && type === 'invoice' && status === 'booked') {
      subject = `New Booking Notification: Order ${idValue}`;
      text = `
A new booking has been made with Phoenix Crackers.

Booking Details:
${idField}: ${idValue}
Customer Name: ${customerDetails.customer_name || 'N/A'}
Mobile: ${customerDetails.mobile_number || 'N/A'}
Email: ${customerDetails.email || 'N/A'}
Address: ${customerDetails.address || 'N/A'}
District: ${customerDetails.district || 'N/A'}
State: ${customerDetails.state || 'N/A'}
Customer Type: ${bookingData.customer_type || 'User'}
Net Rate: Rs.${parseFloat(bookingData.net_rate || 0).toFixed(2)}
You Save: Rs.${parseFloat(bookingData.you_save || 0).toFixed(2)}
Additional Discount: ${parseFloat(bookingData.additional_discount || 0).toFixed(2)}%
Total: Rs.${parseFloat(bookingData.total || 0).toFixed(2)}

Attached is the estimate bill for reference.

Best regards,
Phoenix Crackers Team
      `;
    } else if (toEmail === 'nivasramasamy27@gmail.com' && type === 'invoice' && status === 'paid') {
      subject = `New Payment Notification: Order ${idValue}`;
      text = `
A payment has been received for Order ${idValue}.

Customer Name: ${customerDetails.customer_name || 'N/A'}
Order ID: ${idValue}
Total: Rs.${parseFloat(bookingData.total || 0).toFixed(2)}

Attached is the estimate bill for reference.

Best regards,
Phoenix Crackers Team
      `;
    } else if (type === 'invoice' && status === 'booked') {
      subject = `Thank You for Your Booking! Order ${idValue}`;
      text = `
Dear ${customerDetails.customer_name || 'Customer'},

Thank you for your booking with Phoenix Crackers!

Booking Details:
${idField}: ${idValue}
Customer Name: ${customerDetails.customer_name || 'N/A'}
Mobile: ${customerDetails.mobile_number || 'N/A'}
Email: ${customerDetails.email || 'N/A'}
Address: ${customerDetails.address || 'N/A'}
District: ${customerDetails.district || 'N/A'}
State: ${customerDetails.state || 'N/A'}
Customer Type: ${bookingData.customer_type || 'User'}
Net Rate: Rs.${parseFloat(bookingData.net_rate || 0).toFixed(2)}
You Save: Rs.${parseFloat(bookingData.you_save || 0).toFixed(2)}
Additional Discount: ${parseFloat(bookingData.additional_discount || 0).toFixed(2)}%
Total: Rs.${parseFloat(bookingData.total || 0).toFixed(2)}

Products:
${productList}

Attached is your estimate bill for reference.

For any queries, contact us at +91 63836 59214.

Best regards,
Phoenix Crackers Team
      `;
    } else if (type === 'invoice' && status === 'paid') {
      subject = `Payment Received for Order ${idValue}`;
      text = `
Dear ${customerDetails.customer_name || 'Customer'},

Thank you for your payment for Order ${idValue}!

We have received your payment, and we will start packing your order soon.

Booking Details:
${idField}: ${idValue}
Customer Name: ${customerDetails.customer_name || 'N/A'}
Mobile: ${customerDetails.mobile_number || 'N/A'}
Email: ${customerDetails.email || 'N/A'}
Address: ${customerDetails.address || 'N/A'}
District: ${customerDetails.district || 'N/A'}
State: ${customerDetails.state || 'N/A'}
Customer Type: ${bookingData.customer_type || 'User'}
Net Rate: Rs.${parseFloat(bookingData.net_rate || 0).toFixed(2)}
You Save: Rs.${parseFloat(bookingData.you_save || 0).toFixed(2)}
Additional Discount: ${parseFloat(bookingData.additional_discount || 0).toFixed(2)}%
Total: Rs.${parseFloat(bookingData.total || 0).toFixed(2)}

Products:
${productList}

Attached is your estimate bill for reference.

For any queries, contact us at +91 63836 59214.

Best regards,
Phoenix Crackers Team

${transportDetails ? `Transport Details:\n${Object.entries(transportDetails).map(([key, value]) => `${key}: ${value}`).join('\n')}` : ''}
      `;
    } else {
      subject = `New ${type === 'quotation' ? 'Quotation' : 'Booking'}: ${idValue}`;
      text = `
A new ${type} has been made.

Customer Name: ${customerDetails.customer_name || 'N/A'}
Mobile: ${customerDetails.mobile_number || 'N/A'}
Email: ${customerDetails.email || 'N/A'}
Address: ${customerDetails.address || 'N/A'}
District: ${customerDetails.district || 'N/A'}
State: ${customerDetails.state || 'N/A'}
${idField}: ${idValue}
Customer Type: ${bookingData.customer_type || 'User'}
Net Rate: Rs.${parseFloat(bookingData.net_rate || 0).toFixed(2)}
You Save: Rs.${parseFloat(bookingData.you_save || 0).toFixed(2)}
Additional Discount: ${parseFloat(bookingData.additional_discount || 0).toFixed(2)}%
Total: Rs.${parseFloat(bookingData.total || 0).toFixed(2)}

Products:
${productList}
      `;
    }

    let retries = 3;
    let lastError = null;
    while (retries > 0) {
      try {
        const mailOptions = {
          from: `"Phoenix Crackers" <${emailUser}>`,
          to: toEmail,
          subject,
          text,
          attachments: [
            {
              filename: path.basename(pdfPath),
              path: pdfPath,
              contentType: 'application/pdf',
            },
          ],
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to ${toEmail}`);
        return;
      } catch (err) {
        lastError = err;
        console.error(`Attempt ${4 - retries} failed for ${toEmail}: ${err.message}`);
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    const errorLogPath = path.join(__dirname, '../logs/email_errors.log');
    const errorMessage = `Failed to send email to ${toEmail} at ${new Date().toISOString()}: ${lastError.message}\n`;
    fs.appendFileSync(errorLogPath, errorMessage);
    throw new Error(`Failed to send email to ${toEmail} after 3 retries: ${lastError.message}`);
  } catch (err) {
    console.error(`Failed to send email to ${toEmail}: ${err.message}`);
    throw err;
  }
}

exports.getCustomers = async (req, res) => {
  try {
    const query = `
      SELECT id, customer_name AS name, address, mobile_number, email, customer_type, district, state, agent_id
      FROM public.customers
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch customers', error: err.message });
  }
};

exports.getProductTypes = async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT product_type FROM public.products');
    res.status(200).json(result.rows);
  } catch (err) {
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
        SELECT id, serial_number, productname, dprice, per, discount, image, status, $1 AS product_type
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
    res.status(500).json({ message: 'Failed to fetch quotations', error: err.message });
  }
};

exports.createQuotation = async (req, res) => {
  try {
    const {
      customer_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount,
      customer_type, customer_name, address, mobile_number, email, district, state
    } = req.body;

    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id)) return res.status(400).json({ message: 'Invalid or missing Quotation ID' });
    if (!Array.isArray(products) || products.length === 0) return res.status(400).json({ message: 'Products array is required and must not be empty' });
    if (!total || isNaN(parseFloat(total)) || parseFloat(total) <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    const parsedNetRate = parseFloat(net_rate) || 0;
    const parsedYouSave = parseFloat(you_save) || 0;
    const parsedPromoDiscount = parseFloat(promo_discount) || 0;
    const parsedAdditionalDiscount = parseFloat(additional_discount) || 0;
    const parsedTotal = parseFloat(total);

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, promo_discount, additional_discount, and total must be valid numbers' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };
    let agent_name = null;

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type, agent_id FROM public.customers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) return res.status(404).json({ message: 'Customer not found' });

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
      if (finalCustomerType !== 'User') return res.status(400).json({ message: 'Customer type must be "User" for quotations without customer ID' });
      if (!customer_name || !address || !district || !state || !mobile_number)
        return res.status(400).json({ message: 'All customer details must be provided' });
    }

    const enhancedProducts = [];
    for (const product of products) {
      const { id, product_type, quantity, price, discount } = product;
      if (!id || !product_type || quantity < 1 || isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
        return res.status(400).json({ message: 'Invalid product entry' });

      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
      if (productCheck.rows.length === 0)
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable` });
      const per = productCheck.rows[0].per || '';
      enhancedProducts.push({ ...product, per });
    }

    const { pdfPath } = await generatePDF(
      'quotation',
      { quotation_id, customer_type: finalCustomerType, total: parsedTotal, agent_name },
      customerDetails,
      enhancedProducts,
      { net_rate: parsedNetRate, you_save: parsedYouSave, total: parsedTotal, promo_discount: parsedPromoDiscount, additional_discount: parsedAdditionalDiscount }
    );

    const result = await pool.query(`
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

    try {
      await sendBookingEmail(
        'nivasramasamy27@gmail.com',
        {
          quotation_id,
          customer_type: finalCustomerType,
          net_rate: parsedNetRate,
          you_save: parsedYouSave,
          total: parsedTotal,
          additional_discount: parsedAdditionalDiscount
        },
        customerDetails,
        pdfPath,
        enhancedProducts,
        'quotation'
      );
    } catch (emailError) {
      console.error(`Failed to send quotation email to nivasramasamy27@gmail.com: ${emailError.message}`);
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(500).json({ message: 'PDF file not found after generation', error: 'File system error' });
    }
    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${path.basename(pdfPath)}`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message });
      });
      readStream.pipe(res);
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create quotation', error: err.message });
  }
};

exports.updateQuotation = async (req, res) => {
  try {
    const { quotation_id } = req.params;
    const { products, net_rate, you_save, total, promo_discount, additional_discount, status } = req.body;

    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id)) return res.status(400).json({ message: 'Invalid or missing Quotation ID' });
    if (products && (!Array.isArray(products) || products.length === 0)) return res.status(400).json({ message: 'Products array is required and must not be empty' });
    if (total && (isNaN(parseFloat(total)) || parseFloat(total) <= 0)) return res.status(400).json({ message: 'Total must be a positive number' });
    if (status && !['pending', 'booked', 'canceled'].includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const parsedNetRate = net_rate !== undefined ? parseFloat(net_rate) : undefined;
    const parsedYouSave = you_save !== undefined ? parseFloat(you_save) : undefined;
    const parsedPromoDiscount = promo_discount !== undefined ? parseFloat(promo_discount) : undefined;
    const parsedAdditionalDiscount = additional_discount !== undefined ? parseFloat(additional_discount) : undefined;
    const parsedTotal = total !== undefined ? parseFloat(total) : undefined;

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => v !== undefined && isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, total, promo_discount, and additional_discount must be valid numbers' });

    const quotationCheck = await pool.query(
      'SELECT * FROM public.fwcquotations WHERE quotation_id = $1',
      [quotation_id]
    );
    if (quotationCheck.rows.length === 0) return res.status(404).json({ message: 'Quotation not found' });

    const quotation = quotationCheck.rows[0];
    let customerDetails = {
      customer_name: quotation.customer_name,
      address: quotation.address,
      mobile_number: quotation.mobile_number,
      email: quotation.email,
      district: quotation.district,
      state: quotation.state
    };
    let agent_name = null;

    if (quotation.customer_id) {
      const customerCheck = await pool.query(
        'SELECT customer_name, address, mobile_number, email, district, state, customer_type, agent_id FROM public.customers WHERE id = $1',
        [quotation.customer_id]
      );
      if (customerCheck.rows.length > 0) {
        customerDetails = customerCheck.rows[0];
        if (customerDetails.customer_type === 'Customer of Selected Agent' && customerDetails.agent_id) {
          const agentCheck = await pool.query('SELECT customer_name FROM public.customers WHERE id = $1', [customerDetails.agent_id]);
          if (agentCheck.rows.length > 0) agent_name = agentCheck.rows[0].customer_name;
        }
      }
    }

    let enhancedProducts = quotation.products;
    if (products) {
      enhancedProducts = [];
      for (const product of products) {
        const { id, product_type, quantity, price, discount } = product;
        if (!id || !product_type || quantity < 1 || isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
          return res.status(400).json({ message: 'Invalid product entry' });

        const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
        const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
        if (productCheck.rows.length === 0)
          return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable` });
        const per = productCheck.rows[0].per || '';
        enhancedProducts.push({ ...product, per });
      }
    }

    let pdfPath = quotation.pdf;
    if (products || parsedTotal !== undefined) {
      const pdfResult = await generatePDF(
        'quotation',
        { quotation_id, customer_type: quotation.customer_type, total: parsedTotal, agent_name },
        customerDetails,
        enhancedProducts,
        {
          net_rate: parsedNetRate !== undefined ? parsedNetRate : parseFloat(quotation.net_rate || 0),
          you_save: parsedYouSave !== undefined ? parsedYouSave : parseFloat(quotation.you_save || 0),
          total: parsedTotal !== undefined ? parsedTotal : parseFloat(quotation.total || 0),
          promo_discount: parsedPromoDiscount !== undefined ? parsedPromoDiscount : parseFloat(quotation.promo_discount || 0),
          additional_discount: parsedAdditionalDiscount !== undefined ? parsedAdditionalDiscount : parseFloat(quotation.additional_discount || 0)
        }
      );
      pdfPath = pdfResult.pdfPath;
      try {
        await sendBookingEmail(
          'nivasramasamy27@gmail.com',
          {
            quotation_id,
            customer_type: quotation.customer_type,
            net_rate: parsedNetRate !== undefined ? parsedNetRate : parseFloat(quotation.net_rate || 0),
            you_save: parsedYouSave !== undefined ? parsedYouSave : parseFloat(quotation.you_save || 0),
            total: parsedTotal !== undefined ? parsedTotal : parseFloat(quotation.total || 0),
            additional_discount: parsedAdditionalDiscount !== undefined ? parsedAdditionalDiscount : parseFloat(quotation.additional_discount || 0)
          },
          customerDetails,
          pdfPath,
          enhancedProducts,
          'quotation'
        );
      } catch (emailError) {
        console.error(`Failed to send quotation update email to nivasramasamy27@gmail.com: ${emailError.message}`);
      }
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
    updateFields.push(`updated_at = NOW()`);

    if (updateFields.length === 1) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const query = `
      UPDATE public.fwcquotations 
      SET ${updateFields.join(', ')}
      WHERE quotation_id = $${paramIndex}
      RETURNING id, quotation_id, status
    `;
    updateValues.push(quotation_id);

    const result = await pool.query(query, updateValues);

    if (!fs.existsSync(pdfPath)) {
      return res.status(500).json({ message: 'PDF file not found after update', error: 'File system error' });
    }
    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${path.basename(pdfPath)}`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message });
      });
      readStream.pipe(res);
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update quotation', error: err.message });
  }
};

exports.deleteQuotation = async (req, res) => {
  try {
    const { quotation_id } = req.params;
    if (!quotation_id || !/^[a-zA-Z0-9-_]+$/.test(quotation_id)) return res.status(400).json({ message: 'Invalid or missing Quotation ID' });

    const quotationCheck = await pool.query(
      'SELECT * FROM public.fwcquotations WHERE quotation_id = $1 AND status = $2',
      [quotation_id, 'pending']
    );
    if (quotationCheck.rows.length === 0) return res.status(404).json({ message: 'Quotation not found or not in pending status' });

    await pool.query(
      'UPDATE public.fwcquotations SET status = $1, updated_at = NOW() WHERE quotation_id = $2',
      ['canceled', quotation_id]
    );

    res.status(200).json({ message: 'Quotation canceled successfully', quotation_id });
  } catch (err) {
    res.status(500).json({ message: 'Failed to cancel quotation', error: err.message });
  }
};

exports.getQuotation = async (req, res) => {
  try {
    let { quotation_id } = req.params;
    if (quotation_id.endsWith('.pdf')) quotation_id = quotation_id.replace(/\.pdf$/, '');
    if (!/^[a-zA-Z0-9-_]+$/.test(quotation_id)) return res.status(400).json({ message: 'Invalid quotation_id format' });

    let quotationQuery = await pool.query(
      'SELECT products, net_rate, you_save, total, promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, customer_type, pdf, customer_id, status FROM public.fwcquotations WHERE quotation_id = $1',
      [quotation_id]
    );

    if (quotationQuery.rows.length === 0) {
      const parts = quotation_id.split('-');
      if (parts.length > 1) {
        const possibleQuotationId = parts.slice(1).join('-');
        quotationQuery = await pool.query(
          'SELECT products, net_rate, you_save, total, promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, customer_type, pdf, customer_id, status FROM public.fwcquotations WHERE quotation_id = $1',
          [possibleQuotationId]
        );
      }
    }

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const { products, net_rate, you_save, total, promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, customer_type, pdf, customer_id, status } = quotationQuery.rows[0];
    let agent_name = null;
    if (customer_type === 'Customer of Selected Agent' && customer_id) {
      const customerCheck = await pool.query('SELECT agent_id FROM public.customers WHERE id = $1', [customer_id]);
      if (customerCheck.rows.length > 0 && customerCheck.rows[0].agent_id) {
        const agentCheck = await pool.query('SELECT customer_name FROM public.customers WHERE id = $1', [customerCheck.rows[0].agent_id]);
        if (agentCheck.rows.length > 0) agent_name = agentCheck.rows[0].customer_name;
      }
    }

    let pdfPath = pdf;
    if (!fs.existsSync(pdf)) {
      let parsedProducts = typeof products === 'string' ? JSON.parse(products) : products;
      let enhancedProducts = [];
      for (const p of parsedProducts) {
        if (!p.per) {
          const tableName = p.product_type.toLowerCase().replace(/\s+/g, '_');
          const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [p.id]);
          const per = productCheck.rows[0]?.per || '';
          enhancedProducts.push({ ...p, per });
        } else {
          enhancedProducts.push(p);
        }
      }
      const pdfResult = await generatePDF(
        'quotation',
        { quotation_id, customer_type, total: parseFloat(total || 0), agent_name },
        { customer_name, address, mobile_number, email, district, state },
        enhancedProducts,
        { 
          net_rate: parseFloat(net_rate || 0), 
          you_save: parseFloat(you_save || 0), 
          total: parseFloat(total || 0), 
          promo_discount: parseFloat(promo_discount || 0),
          additional_discount: parseFloat(additional_discount || 0)
        }
      );
      pdfPath = pdfResult.pdfPath;

      await pool.query(
        'UPDATE public.fwcquotations SET pdf = $1 WHERE quotation_id = $2',
        [pdfPath, quotation_id]
      );
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(500).json({ message: 'PDF file not found after generation', error: 'File system error' });
    }

    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message });
      }
      const safeCustomerName = (customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${quotation_id}-quotation.pdf`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message });
      });
      readStream.pipe(res);
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quotation', error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const {
      customer_id, order_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount,
      customer_type, customer_name, address, mobile_number, email, district, state
    } = req.body;

    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) 
      return res.status(400).json({ message: 'Invalid or missing Order ID' });
    
    if (!Array.isArray(products) || products.length === 0) 
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    
    if (!total || isNaN(parseFloat(total)) || parseFloat(total) <= 0) 
      return res.status(400).json({ message: 'Total must be a positive number' });

    const parsedNetRate = parseFloat(net_rate) || 0;
    const parsedYouSave = parseFloat(you_save) || 0;
    const parsedPromoDiscount = parseFloat(promo_discount) || 0;
    const parsedAdditionalDiscount = parseFloat(additional_discount) || 0;
    const parsedTotal = parseFloat(total);

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, promo_discount, additional_discount, and total must be valid numbers' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };
    let agent_name = null;

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type, agent_id FROM public.customers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) 
        return res.status(404).json({ message: 'Customer not found' });

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
        return res.status(400).json({ message: 'Customer type must be "User" for bookings without customer ID' });
      if (!customer_name || !address || !district || !state || !mobile_number)
        return res.status(400).json({ message: 'All customer details must be provided' });
    }

    const enhancedProducts = [];
    for (const product of products) {
      const { id, product_type, quantity, price, discount } = product;
      if (!id || !product_type || quantity < 1 || isNaN(parseFloat(price)) || isNaN(parseFloat(discount)))
        return res.status(400).json({ message: 'Invalid product entry' });

      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
      if (productCheck.rows.length === 0)
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable` });
      const per = productCheck.rows[0].per || '';
      enhancedProducts.push({ ...product, per });
    }

    const { pdfPath } = await generatePDF(
      'invoice',
      { order_id, customer_type: finalCustomerType, total: parsedTotal, agent_name },
      customerDetails,
      enhancedProducts,
      { net_rate: parsedNetRate, you_save: parsedYouSave, total: parsedTotal, promo_discount: parsedPromoDiscount, additional_discount: parsedAdditionalDiscount }
    );

    await pool.query('BEGIN');

    const bookingResult = await pool.query(`
      INSERT INTO public.bookings 
      (customer_id, order_id, quotation_id, products, net_rate, you_save, total, promo_discount, additional_discount, address, mobile_number, customer_name, email, district, state, customer_type, status, pdf)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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

    if (quotation_id) {
      const quotationCheck = await pool.query(
        'SELECT id FROM public.fwcquotations WHERE quotation_id = $1 AND status = $2',
        [quotation_id, 'pending']
      );
      if (quotationCheck.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ message: 'Quotation not found or not in pending status' });
      }

      await pool.query(
        'UPDATE public.fwcquotations SET status = $1, updated_at = NOW() WHERE quotation_id = $2',
        ['booked', quotation_id]
      );
    }

    await pool.query('COMMIT');

    // Send emails after booking is committed, but don't fail the request if emails fail
    try {
      await sendBookingEmail(
        'nivasramasamy27@gmail.com',
        {
          order_id,
          customer_type: finalCustomerType,
          net_rate: parsedNetRate,
          you_save: parsedYouSave,
          total: parsedTotal,
          additional_discount: parsedAdditionalDiscount
        },
        customerDetails,
        pdfPath,
        enhancedProducts,
        'invoice'
      );
    } catch (emailError) {
      console.error(`Failed to send booking email to nivasramasamy27@gmail.com: ${emailError.message}`);
    }

    if (customerDetails.email) {
      try {
        await sendBookingEmail(
          customerDetails.email,
          {
            order_id,
            customer_type: finalCustomerType,
            net_rate: parsedNetRate,
            you_save: parsedYouSave,
            total: parsedTotal,
            additional_discount: parsedAdditionalDiscount
          },
          customerDetails,
          pdfPath,
          enhancedProducts,
          'invoice',
          'booked'
        );
      } catch (emailError) {
        console.error(`Failed to send booking email to ${customerDetails.email}: ${emailError.message}`);
      }
    }

    // Stream PDF for automatic download
    if (!fs.existsSync(pdfPath)) {
      return res.status(500).json({ message: 'PDF file not found after generation', error: 'File system error' });
    }
    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${path.basename(pdfPath)}`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message });
      });
      readStream.pipe(res);
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.updateBooking = async (req, res) => {
  try {
    const { order_id } = req.params;
    const { products, net_rate, you_save, total, promo_discount, additional_discount, status, transport_details } = req.body;

    if (!order_id || !/^[a-zA-Z0-9-_]+$/.test(order_id)) return res.status(400).json({ message: 'Invalid or missing Order ID' });
    if (products && (!Array.isArray(products) || products.length === 0)) return res.status(400).json({ message: 'Products array is required and must not be empty' });
    if (total && (isNaN(parseFloat(total)) || parseFloat(total) <= 0)) return res.status(400).json({ message: 'Total must be a positive number' });
    if (status && !['booked', 'paid', 'dispatched', 'canceled'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    if (status === 'dispatched' && !transport_details) return res.status(400).json({ message: 'Transport details required for dispatched status' });

    const parsedNetRate = net_rate !== undefined ? parseFloat(net_rate) : undefined;
    const parsedYouSave = you_save !== undefined ? parseFloat(you_save) : undefined;
    const parsedPromoDiscount = promo_discount !== undefined ? parseFloat(promo_discount) : undefined;
    const parsedAdditionalDiscount = additional_discount !== undefined ? parseFloat(additional_discount) : undefined;
    const parsedTotal = total !== undefined ? parseFloat(total) : undefined;

    if ([parsedNetRate, parsedYouSave, parsedPromoDiscount, parsedAdditionalDiscount, parsedTotal].some(v => v !== undefined && isNaN(v)))
      return res.status(400).json({ message: 'net_rate, you_save, total, promo_discount, and additional_discount must be valid numbers' });

    const bookingCheck = await pool.query(
      'SELECT * FROM public.bookings WHERE order_id = $1',
      [order_id]
    );
    if (bookingCheck.rows.length === 0) return res.status(404).json({ message: 'Booking not found' });

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
          return res.status(400).json({ message: 'Invalid product entry' });

        const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
        const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [id]);
        if (productCheck.rows.length === 0)
          return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or unavailable` });
        const per = productCheck.rows[0].per || '';
        enhancedProducts.push({ ...product, per });
      }
    }

    let pdfPath = booking.pdf;
    if (products || parsedTotal !== undefined) {
      const pdfResult = await generatePDF(
        'invoice',
        { order_id, customer_type: booking.customer_type, total: parsedTotal, agent_name },
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
      pdfPath = pdfResult.pdfPath;
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
      return res.status(400).json({ message: 'No fields to update' });
    }

    const query = `
      UPDATE public.bookings 
      SET ${updateFields.join(', ')}
      WHERE order_id = $${paramIndex}
      RETURNING id, order_id, status
    `;
    updateValues.push(order_id);

    const result = await pool.query(query, updateValues);

    try {
      if (customerDetails.email && status) {
        await sendBookingEmail(
          customerDetails.email,
          {
            order_id,
            customer_type: booking.customer_type,
            net_rate: parsedNetRate !== undefined ? parsedNetRate : parseFloat(booking.net_rate || 0),
            you_save: parsedYouSave !== undefined ? parsedYouSave : parseFloat(booking.you_save || 0),
            total: parsedTotal !== undefined ? parsedTotal : parseFloat(booking.total || 0),
            additional_discount: parsedAdditionalDiscount !== undefined ? parsedAdditionalDiscount : parseFloat(booking.additional_discount || 0)
          },
          customerDetails,
          pdfPath,
          products || JSON.parse(booking.products),
          'invoice',
          status,
          transport_details
        );
      }
    } catch (emailError) {
      console.error(`Failed to send booking update email to ${customerDetails.email}: ${emailError.message}`);
    }

    try {
      await sendBookingEmail(
        'nivasramasamy27@gmail.com',
        {
          order_id,
          customer_type: booking.customer_type,
          net_rate: parsedNetRate !== undefined ? parsedNetRate : parseFloat(booking.net_rate || 0),
          you_save: parsedYouSave !== undefined ? parsedYouSave : parseFloat(booking.you_save || 0),
          total: parsedTotal !== undefined ? parsedTotal : parseFloat(booking.total || 0),
          additional_discount: parsedAdditionalDiscount !== undefined ? parsedAdditionalDiscount : parseFloat(booking.additional_discount || 0)
        },
        customerDetails,
        pdfPath,
        products || JSON.parse(booking.products),
        'invoice',
        status,
        transport_details
      );
    } catch (emailError) {
      console.error(`Failed to send booking update email to nivasramasamy27@gmail.com: ${emailError.message}`);
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(500).json({ message: 'PDF file not found after update', error: 'File system error' });
    }
    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${path.basename(pdfPath)}`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message });
      });
      readStream.pipe(res);
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update booking', error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    let { order_id } = req.params;
    if (order_id.endsWith('.pdf')) order_id = order_id.replace(/\.pdf$/, '');
    if (!/^[a-zA-Z0-9-_]+$/.test(order_id)) return res.status(400).json({ message: 'Invalid order_id format' });

    const bookingQuery = await pool.query(
      'SELECT products, net_rate, you_save, total, promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, customer_type, pdf, customer_id, status FROM public.bookings WHERE order_id = $1',
      [order_id]
    );

    if (bookingQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const { products, net_rate, you_save, total, promo_discount, additional_discount, customer_name, address, mobile_number, email, district, state, customer_type, pdf, customer_id, status } = bookingQuery.rows[0];
    let agent_name = null;
    if (customer_type === 'Customer of Selected Agent' && customer_id) {
      const customerCheck = await pool.query('SELECT agent_id FROM public.customers WHERE id = $1', [customer_id]);
      if (customerCheck.rows.length > 0 && customerCheck.rows[0].agent_id) {
        const agentCheck = await pool.query('SELECT customer_name FROM public.customers WHERE id = $1', [customerCheck.rows[0].agent_id]);
        if (agentCheck.rows.length > 0) agent_name = agentCheck.rows[0].customer_name;
      }
    }

    let pdfPath = pdf;
    if (!fs.existsSync(pdf)) {
      let parsedProducts = typeof products === 'string' ? JSON.parse(products) : products;
      let enhancedProducts = [];
      for (const p of parsedProducts) {
        if (!p.per) {
          const tableName = p.product_type.toLowerCase().replace(/\s+/g, '_');
          const productCheck = await pool.query(`SELECT per FROM public.${tableName} WHERE id = $1`, [p.id]);
          const per = productCheck.rows[0]?.per || '';
          enhancedProducts.push({ ...p, per });
        } else {
          enhancedProducts.push(p);
        }
      }
      const pdfResult = await generatePDF(
        'invoice',
        { order_id, customer_type, total: parseFloat(total || 0), agent_name },
        { customer_name, address, mobile_number, email, district, state },
        enhancedProducts,
        { 
          net_rate: parseFloat(net_rate || 0), 
          you_save: parseFloat(you_save || 0), 
          total: parseFloat(total || 0), 
          promo_discount: parseFloat(promo_discount || 0),
          additional_discount: parseFloat(additional_discount || 0)
        }
      );
      pdfPath = pdfResult.pdfPath;

      await pool.query(
        'UPDATE public.bookings SET pdf = $1 WHERE order_id = $2',
        [pdfPath, order_id]
      );
    }

    if (!fs.existsSync(pdfPath)) {
      return res.status(500).json({ message: 'PDF file not found after generation', error: 'File system error' });
    }

    fs.access(pdfPath, fs.constants.R_OK, (err) => {
      if (err) {
        return res.status(500).json({ message: `Cannot read PDF file at ${pdfPath}`, error: err.message });
      }
      const safeCustomerName = (customer_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${order_id}-invoice.pdf`);
      const readStream = fs.createReadStream(pdfPath);
      readStream.on('error', (streamErr) => {
        res.status(500).json({ message: 'Failed to stream PDF', error: streamErr.message });
      });
      readStream.pipe(res);
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
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