const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Design Tokens & Colors
const COLORS = {
  primary: '#0f172a',       // Deep slate/navy
  primaryLight: '#1e293b',  // Dark slate
  accent: '#0284c7',        // Sky blue
  gold: '#d97706',          // Warm amber/gold
  textMain: '#0f172a',      // Primary text
  textMuted: '#64748b',     // Secondary text
  bgLight: '#f8fafc',       // Card / alternate row fill
  bgCard: '#f1f5f9',        // Card background
  border: '#e2e8f0',        // Subtle border
  borderDark: '#cbd5e1',    // Darker border
  white: '#ffffff',
  green: '#16a34a',
  red: '#dc2626',
};

const COMPANY = {
  name: 'HIFI PYRO PARK',
  tagline: 'Premium Fireworks & Novelties Manufacturer & Dealer',
  address: 'Opp. Anil Kumar Eye Hospital, Sattur Road, Sivakasi - 626 123, Tamil Nadu',
  mobile: '+91 97865 08621, +91 97868 60010',
  email: 'nivasramasamy27@gmail.com',
  bankDetails: {
    accountName: 'HIFI PYRO PARK',
    bankName: 'State Bank of India',
    accountNumber: '38920194829',
    ifscCode: 'SBIN0000921',
    branch: 'Sivakasi Main Branch',
  },
};

function formatCurrency(num) {
  const n = Number(num) || 0;
  return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(date) {
  if (!date) return new Date().toLocaleDateString('en-GB');
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Draw Modern Top Header
 */
function drawHeader(doc, typeTitle, docNumber, dateStr, status = 'ACTIVE') {
  // Top brand color banner
  doc.rect(0, 0, 595.28, 8).fill(COLORS.primary);
  doc.rect(0, 8, 595.28, 3).fill(COLORS.gold);

  // Company Brand Name & Details (Left side)
  doc
    .fillColor(COLORS.primary)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(COMPANY.name, 40, 26);

  doc
    .fillColor(COLORS.gold)
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text(COMPANY.tagline.toUpperCase(), 40, 48);

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(8.5)
    .font('Helvetica')
    .text(COMPANY.address, 40, 60)
    .text(`Phone: ${COMPANY.mobile}  |  Email: ${COMPANY.email}`, 40, 72);

  // Document Badge (Right side)
  const badgeWidth = 160;
  const badgeX = 595.28 - 40 - badgeWidth;

  doc.roundedRect(badgeX, 24, badgeWidth, 60, 4).fillAndStroke(COLORS.bgLight, COLORS.borderDark);

  doc
    .fillColor(COLORS.primaryLight)
    .fontSize(12)
    .font('Helvetica-Bold')
    .text(typeTitle.toUpperCase(), badgeX, 32, { width: badgeWidth, align: 'center' });

  doc
    .fillColor(COLORS.accent)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(docNumber, badgeX, 48, { width: badgeWidth, align: 'center' });

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(8.5)
    .font('Helvetica')
    .text(`Date: ${formatDate(dateStr)}`, badgeX, 64, { width: badgeWidth, align: 'center' });

  // Divider Line
  doc.moveTo(40, 96).lineTo(555.28, 96).strokeColor(COLORS.border).stroke();
}

/**
 * Draw Customer Information Card
 */
function drawCustomerCard(doc, customer, y = 106, extraFields = {}) {
  const cardWidth = 515.28;
  const cardHeight = 72;

  // Background card
  doc.roundedRect(40, y, cardWidth, cardHeight, 6).fillAndStroke(COLORS.bgLight, COLORS.border);

  // Left Column: Customer Bill To
  doc
    .fillColor(COLORS.accent)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('BILL TO / CUSTOMER DETAILS', 52, y + 8);

  const customerName = customer.customer_name || customer.name || 'Customer';
  const companyName = customer.companyname || customer.company_name || '';

  doc
    .fillColor(COLORS.primary)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(companyName ? `${customerName} (${companyName})` : customerName, 52, y + 20, { width: 250 });

  let contactLine = `Phone: ${customer.mobile_number || 'N/A'}`;
  if (customer.email) contactLine += `  |  Email: ${customer.email}`;

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(8.5)
    .font('Helvetica')
    .text(contactLine, 52, y + 36, { width: 260 })
    .text(`Address: ${customer.address || 'N/A'}`, 52, y + 48, { width: 260 });

  // Right Column: Location / Order Metadata
  const rightX = 330;
  doc
    .fillColor(COLORS.accent)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('SHIPPING & ORDER DETAILS', rightX, y + 8);

  doc
    .fillColor(COLORS.textMain)
    .fontSize(8.5)
    .font('Helvetica')
    .text(`City / District: ${customer.district || 'N/A'}`, rightX, y + 22)
    .text(`State: ${customer.state || 'N/A'}`, rightX, y + 34)
    .text(`Customer Type: ${extraFields.customer_type || customer.customer_type || 'Dealer'}`, rightX, y + 46);

  if (extraFields.referenceId) {
    doc.text(`Ref ID: ${extraFields.referenceId}`, rightX, y + 58);
  }

  return y + cardHeight + 14;
}

/**
 * Draw Modern Products Table
 */
function drawProductsTable(doc, products, startY, hasDiscount) {
  const tableWidth = 515.28;
  const colX = hasDiscount
    ? [40, 75, 235, 290, 355, 415, 475]
    : [40, 75, 275, 345, 420, 485];
  const colWidths = hasDiscount
    ? [35, 160, 55, 65, 60, 60, 80]
    : [35, 200, 70, 75, 65, 70];
  const colAlign = hasDiscount
    ? ['center', 'left', 'center', 'right', 'center', 'center', 'right']
    : ['center', 'left', 'center', 'right', 'center', 'right'];

  let y = startY;

  // Table Header Background
  doc.roundedRect(40, y, tableWidth, 22, 4).fill(COLORS.primaryLight);

  // Table Header Titles
  const headers = hasDiscount
    ? ['#', 'PRODUCT DESCRIPTION', 'QTY', 'PRICE', 'DISC', 'PER', 'TOTAL']
    : ['#', 'PRODUCT DESCRIPTION', 'QTY', 'PRICE', 'PER', 'TOTAL'];

  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(8);
  headers.forEach((hdr, i) => {
    doc.text(hdr, colX[i] + 4, y + 7, { width: colWidths[i] - 8, align: colAlign[i] });
  });

  y += 24;

  let calculatedSubtotal = 0;

  products.forEach((prod, idx) => {
    // Pagination check
    if (y > 700) {
      doc.addPage();
      drawHeader(doc, 'CONTINUED', '', '', '');
      y = 110;
      // Redraw table header
      doc.roundedRect(40, y, tableWidth, 22, 4).fill(COLORS.primaryLight);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(8);
      headers.forEach((hdr, i) => {
        doc.text(hdr, colX[i] + 4, y + 7, { width: colWidths[i] - 8, align: colAlign[i] });
      });
      y += 24;
    }

    const price = Number(prod.price) || 0;
    const discount = Number(prod.discount) || 0;
    const qty = Number(prod.quantity) || 0;
    const lineTotal = (price - (price * discount / 100)) * qty;
    calculatedSubtotal += lineTotal;

    // Row zebra striping
    if (idx % 2 === 1) {
      doc.rect(40, y, tableWidth, 20).fill(COLORS.bgLight);
    }

    // Row bottom line
    doc.moveTo(40, y + 20).lineTo(555.28, y + 20).strokeColor(COLORS.border).stroke();

    // Row text
    doc.fillColor(COLORS.textMain).font('Helvetica').fontSize(8.5);

    const rowData = hasDiscount
      ? [
          String(idx + 1),
          prod.productname || 'N/A',
          String(qty),
          formatCurrency(price),
          discount > 0 ? `${discount}%` : '-',
          prod.per || 'box',
          formatCurrency(lineTotal),
        ]
      : [
          String(idx + 1),
          prod.productname || 'N/A',
          String(qty),
          formatCurrency(price),
          prod.per || 'box',
          formatCurrency(lineTotal),
        ];

    rowData.forEach((val, i) => {
      // Highlight total column in bold
      if (i === rowData.length - 1) doc.font('Helvetica-Bold');
      doc.text(val, colX[i] + 4, y + 5, { width: colWidths[i] - 8, align: colAlign[i] });
      if (i === rowData.length - 1) doc.font('Helvetica');
    });

    y += 20;
  });

  return { currentY: y + 8, calculatedSubtotal };
}

/**
 * Draw Summary, Grand Total, Bank Details, and Footer
 */
function drawFooterSection(doc, currentY, subtotal, extraCharges = {}) {
  let y = currentY;
  if (y > 640) {
    doc.addPage();
    y = 60;
  }

  const tax = parseFloat(extraCharges.tax || 0);
  const pf = parseFloat(extraCharges.pf || 0);
  const minus = parseFloat(extraCharges.minus || 0);
  const grandTotal = subtotal + tax + pf - minus;

  // Left Side: Bank Details & Terms Card
  const leftX = 40;
  const leftWidth = 260;
  doc.roundedRect(leftX, y, leftWidth, 90, 4).fillAndStroke(COLORS.bgLight, COLORS.border);

  doc
    .fillColor(COLORS.accent)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('BANK DETAILS FOR PAYMENT', leftX + 10, y + 8);

  doc
    .fillColor(COLORS.textMain)
    .font('Helvetica')
    .fontSize(8)
    .text(`A/C Name: ${COMPANY.bankDetails.accountName}`, leftX + 10, y + 22)
    .text(`Bank: ${COMPANY.bankDetails.bankName}`, leftX + 10, y + 33)
    .text(`A/C No: ${COMPANY.bankDetails.accountNumber}`, leftX + 10, y + 44)
    .text(`IFSC: ${COMPANY.bankDetails.ifscCode}  |  Branch: ${COMPANY.bankDetails.branch}`, leftX + 10, y + 55);

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(7.5)
    .text('* Subject to Sivakasi Jurisdiction. Goods once sold will not be returned.', leftX + 10, y + 74);

  // Right Side: Breakdown & Grand Total
  const rightX = 320;
  const rightWidth = 235.28;

  let rowY = y;
  doc.fillColor(COLORS.textMuted).font('Helvetica').fontSize(9);
  doc.text('Subtotal:', rightX, rowY);
  doc.fillColor(COLORS.textMain).text(formatCurrency(subtotal), rightX, rowY, { width: rightWidth, align: 'right' });
  rowY += 15;

  if (pf > 0) {
    doc.fillColor(COLORS.textMuted).text('Packing & Forwarding (P&F):', rightX, rowY);
    doc.fillColor(COLORS.textMain).text(formatCurrency(pf), rightX, rowY, { width: rightWidth, align: 'right' });
    rowY += 15;
  }

  if (tax > 0) {
    doc.fillColor(COLORS.textMuted).text('Tax / GST:', rightX, rowY);
    doc.fillColor(COLORS.textMain).text(formatCurrency(tax), rightX, rowY, { width: rightWidth, align: 'right' });
    rowY += 15;
  }

  if (minus > 0) {
    doc.fillColor(COLORS.green).text('Special Discount / Deduction:', rightX, rowY);
    doc.fillColor(COLORS.green).text(`-${formatCurrency(minus)}`, rightX, rowY, { width: rightWidth, align: 'right' });
    rowY += 15;
  }

  // Highlighted Grand Total Box
  doc.roundedRect(rightX - 5, rowY, rightWidth + 5, 28, 4).fill(COLORS.primary);

  doc
    .fillColor(COLORS.gold)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('GRAND TOTAL:', rightX + 8, rowY + 9);

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(formatCurrency(grandTotal), rightX, rowY + 8, { width: rightWidth - 10, align: 'right' });

  // Signature Block
  const sigY = y + 105;
  doc
    .fillColor(COLORS.textMuted)
    .font('Helvetica')
    .fontSize(8)
    .text('Authorized Signatory', 555.28 - 140, sigY + 30, { width: 140, align: 'center' });

  doc.moveTo(555.28 - 140, sigY + 28).lineTo(555.28, sigY + 28).strokeColor(COLORS.borderDark).stroke();

  doc
    .fillColor(COLORS.primary)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`For ${COMPANY.name}`, 555.28 - 140, sigY + 12, { width: 140, align: 'center' });

  // Page Bottom Brand Footer
  const footerY = 800;
  doc.rect(0, footerY + 12, 595.28, 4).fill(COLORS.primary);
  doc
    .fillColor(COLORS.textMuted)
    .font('Helvetica')
    .fontSize(7.5)
    .text(
      'Thank you for partnering with HIFI PYRO PARK! Celebrate every festival safely.',
      40,
      footerY,
      { width: 515.28, align: 'center' }
    );
}

/**
 * Generate Modern Quotation PDF
 */
function generateModernQuotationPDF(quotationData, customerDetails, products, extraCharges = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!quotationData || !customerDetails || !Array.isArray(products)) {
        return reject(new Error('Invalid input for Quotation PDF'));
      }

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const safeCustomerName = (customerDetails.customer_name || customerDetails.name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const pdfDir = path.join(__dirname, '../Controller/quotation');
      ensureDir(pdfDir);

      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${quotationData.est_id || 'quo'}.pdf`);
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      // Draw Top Header
      drawHeader(doc, 'QUOTATION', quotationData.est_id || 'QUO', quotationData.created_at || new Date(), 'PENDING');

      // Draw Customer Card
      const tableStartY = drawCustomerCard(doc, customerDetails, 106, {
        customer_type: quotationData.customer_type,
      });

      // Check for discounts
      const hasDiscount = products.some((p) => parseFloat(p.discount || 0) > 0);

      // Draw Products Table
      const { currentY, calculatedSubtotal } = drawProductsTable(doc, products, tableStartY, hasDiscount);

      // Draw Summary & Footer
      drawFooterSection(doc, currentY, calculatedSubtotal, extraCharges);

      doc.end();
      stream.on('finish', () => resolve({ pdfPath, calculatedTotal: calculatedSubtotal }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Invoice / Order Bill PDF
 */
function generateModernInvoicePDF(bookingData, customerDetails, products, extraCharges = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!bookingData || !customerDetails || !Array.isArray(products)) {
        return reject(new Error('Invalid input for Invoice PDF'));
      }

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const safeCustomerName = (customerDetails.customer_name || customerDetails.name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const pdfDir = path.join(__dirname, '../Controller/pdf_data');
      ensureDir(pdfDir);

      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${bookingData.order_id || 'ord'}.pdf`);
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      // Draw Top Header
      drawHeader(doc, 'TAX INVOICE', bookingData.order_id || 'ORD', bookingData.created_at || new Date(), bookingData.status || 'BOOKED');

      // Draw Customer Card
      const tableStartY = drawCustomerCard(doc, customerDetails, 106, {
        customer_type: bookingData.customer_type,
        referenceId: bookingData.est_id || null,
      });

      // Check for discounts
      const hasDiscount = products.some((p) => parseFloat(p.discount || 0) > 0);

      // Draw Products Table
      const { currentY, calculatedSubtotal } = drawProductsTable(doc, products, tableStartY, hasDiscount);

      // Draw Summary & Footer
      drawFooterSection(doc, currentY, calculatedSubtotal, extraCharges);

      doc.end();
      stream.on('finish', () => resolve({ pdfPath, calculatedTotal: calculatedSubtotal }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Payment Receipt PDF
 */
function generateModernReceiptPDF(bookingData, customerDetails, payments = [], receiptId = '') {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const safeCustomerName = (customerDetails.customer_name || customerDetails.name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const pdfDir = path.join(__dirname, '../Controller/receipt');
      ensureDir(pdfDir);

      const genReceiptId = receiptId || `RCP-${Date.now()}`;
      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${genReceiptId}.pdf`);
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      // Draw Header
      drawHeader(doc, 'PAYMENT RECEIPT', genReceiptId, new Date(), 'PAID');

      // Customer card
      const y = drawCustomerCard(doc, customerDetails, 106, {
        customer_type: bookingData.customer_type,
        referenceId: bookingData.order_id,
      });

      // Payments Table
      const tableWidth = 515.28;
      const colX = [40, 75, 200, 310, 420];
      const colWidths = [35, 125, 110, 110, 95];

      doc.roundedRect(40, y, tableWidth, 22, 4).fill(COLORS.primaryLight);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(8);
      ['#', 'PAYMENT METHOD', 'RECEIVED BY (ADMIN)', 'DATE', 'AMOUNT (INR)'].forEach((h, i) => {
        doc.text(h, colX[i] + 4, y + 7, { width: colWidths[i] - 8, align: i === 4 ? 'right' : 'left' });
      });

      let rowY = y + 24;
      let totalPaid = 0;

      payments.forEach((p, idx) => {
        const amt = Number(p.amount_paid) || 0;
        totalPaid += amt;

        if (idx % 2 === 1) doc.rect(40, rowY, tableWidth, 20).fill(COLORS.bgLight);
        doc.moveTo(40, rowY + 20).lineTo(555.28, rowY + 20).strokeColor(COLORS.border).stroke();

        doc.fillColor(COLORS.textMain).font('Helvetica').fontSize(8.5);
        doc.text(String(idx + 1), colX[0] + 4, rowY + 5);
        doc.text(p.payment_method ? p.payment_method.toUpperCase() : 'CASH', colX[1] + 4, rowY + 5);
        doc.text(p.admin_username || p.admin || 'Admin', colX[2] + 4, rowY + 5);
        doc.text(formatDate(p.created_at || p.transaction_date), colX[3] + 4, rowY + 5);
        doc.font('Helvetica-Bold').text(formatCurrency(amt), colX[4] + 4, rowY + 5, { width: colWidths[4] - 8, align: 'right' });

        rowY += 20;
      });

      // Receipt Summary
      const summaryY = rowY + 15;
      doc.roundedRect(300, summaryY, 255.28, 30, 4).fill(COLORS.primary);
      doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(10).text('TOTAL RECEIVED:', 312, summaryY + 9);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(12).text(formatCurrency(totalPaid), 312, summaryY + 8, { width: 233, align: 'right' });

      // Signatory
      const sigY = summaryY + 50;
      doc.fillColor(COLORS.textMuted).font('Helvetica').fontSize(8).text('Authorized Signatory', 555.28 - 140, sigY + 30, { width: 140, align: 'center' });
      doc.moveTo(555.28 - 140, sigY + 28).lineTo(555.28, sigY + 28).strokeColor(COLORS.borderDark).stroke();
      doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(8.5).text(`For ${COMPANY.name}`, 555.28 - 140, sigY + 12, { width: 140, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve({ pdfPath, calculatedTotal: totalPaid, receiptId: genReceiptId }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateModernQuotationPDF,
  generateModernInvoicePDF,
  generateModernReceiptPDF,
  COMPANY,
  COLORS,
  formatCurrency,
};
