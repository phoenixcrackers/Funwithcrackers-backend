const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  mobile: '+91 97865 08621, +91 97868 60010, +91 97869 99883',
  email: 'nivasramasamy27@gmail.com',
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
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    // Ignore directory creation failure in read-only filesystems
  }
}

function getSafePdfDir(subfolder = '') {
  const baseDir = process.env.PDF_STORAGE_DIR || path.join(os.tmpdir(), 'hifi_pdf');
  const targetDir = subfolder ? path.join(baseDir, subfolder) : baseDir;
  ensureDir(targetDir);
  return targetDir;
}

function calculateModernQuotationTotal(products, extraCharges = {}) {
  let subtotal = 0;
  if (Array.isArray(products)) {
    for (const prod of products) {
      const price = Number(prod.price) || 0;
      const discount = Number(prod.discount) || 0;
      const qty = Number(prod.quantity) || 0;
      const lineTotal = (price - (price * discount / 100)) * qty;
      subtotal += lineTotal;
    }
  }
  const tax = parseFloat(extraCharges.tax || 0);
  const pf = parseFloat(extraCharges.pf || 0);
  const minus = parseFloat(extraCharges.minus || 0);
  const grandTotal = subtotal + tax + pf - minus;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

/**
 * Draw Modern Top Header
 */
function drawHeader(doc, typeTitle, docNumber, dateStr, status = 'ACTIVE') {
  const isContinued = typeTitle === 'CONTINUED';

  if (isContinued) {
    // Compact Header for continued pages
    doc.rect(0, 0, 595.28, 4).fill(COLORS.primary);
    doc.rect(0, 4, 595.28, 2).fill(COLORS.gold);

    doc
      .fillColor(COLORS.primary)
      .fontSize(10.5)
      .font('Helvetica-Bold')
      .text(`${COMPANY.name} — CONTINUED`, 35, 10);

    if (docNumber) {
      doc
        .fillColor(COLORS.textMuted)
        .fontSize(7.5)
        .font('Helvetica')
        .text(`Ref / Doc #: ${docNumber}`, 350, 10, { width: 210, align: 'right' });
    }

    doc.moveTo(35, 23).lineTo(560.28, 23).strokeColor(COLORS.border).stroke();
    return;
  }

  // Top brand color banner
  doc.rect(0, 0, 595.28, 6).fill(COLORS.primary);
  doc.rect(0, 6, 595.28, 2.5).fill(COLORS.gold);

  // Company Brand Name & Details (Left side)
  doc
    .fillColor(COLORS.primary)
    .fontSize(16.5)
    .font('Helvetica-Bold')
    .text(COMPANY.name, 35, 14);

  doc
    .fillColor(COLORS.gold)
    .fontSize(7.5)
    .font('Helvetica-Bold')
    .text(COMPANY.tagline.toUpperCase(), 35, 33);

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(7.5)
    .font('Helvetica')
    .text(COMPANY.address, 35, 44)
    .text(`Phone: ${COMPANY.mobile}`, 35, 54)
    .text(`Email: ${COMPANY.email}`, 35, 64);

  // Document Badge (Right side)
  const badgeWidth = 155;
  const badgeX = 595.28 - 35 - badgeWidth;

  doc.roundedRect(badgeX, 14, badgeWidth, 58, 4).fillAndStroke(COLORS.bgLight, COLORS.borderDark);

  doc
    .fillColor(COLORS.primaryLight)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(typeTitle.toUpperCase(), badgeX, 20, { width: badgeWidth, align: 'center' });

  doc
    .fillColor(COLORS.accent)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text(docNumber || '', badgeX, 34, { width: badgeWidth, align: 'center' });

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(7.5)
    .font('Helvetica')
    .text(dateStr ? `Date: ${formatDate(dateStr)}` : '', badgeX, 48, { width: badgeWidth, align: 'center' });

  // Divider Line
  doc.moveTo(35, 76).lineTo(560.28, 76).strokeColor(COLORS.border).stroke();
}

/**
 * Draw Customer Information Card
 */
function drawCustomerCard(doc, customer, y = 82, extraFields = {}) {
  const cardWidth = 525.28;
  const cardHeight = 54;

  // Background card
  doc.roundedRect(35, y, cardWidth, cardHeight, 4).fillAndStroke(COLORS.bgLight, COLORS.border);

  // Left Column: Customer Bill To
  doc
    .fillColor(COLORS.accent)
    .fontSize(7)
    .font('Helvetica-Bold')
    .text('BILL TO / CUSTOMER DETAILS', 45, y + 5);

  const customerName = customer.customer_name || customer.name || 'Customer';
  const companyName = customer.companyname || customer.company_name || '';

  doc
    .fillColor(COLORS.primary)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(companyName ? `${customerName} (${companyName})` : customerName, 45, y + 16, {
      width: 265,
      lineBreak: false,
      ellipsis: true,
    });

  let contactLine = `Phone: ${customer.mobile_number || 'N/A'}`;
  if (customer.email) contactLine += `  |  Email: ${customer.email}`;

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(7.5)
    .font('Helvetica')
    .text(contactLine, 45, y + 28, { width: 265, lineBreak: false, ellipsis: true })
    .text(`Address: ${customer.address || 'N/A'}`, 45, y + 39, { width: 265, lineBreak: false, ellipsis: true });

  // Right Column: Location / Order Metadata
  const rightX = 320;
  doc
    .fillColor(COLORS.accent)
    .fontSize(7)
    .font('Helvetica-Bold')
    .text('SHIPPING & ORDER DETAILS', rightX, y + 5);

  doc
    .fillColor(COLORS.textMain)
    .fontSize(7.5)
    .font('Helvetica')
    .text(`City / District: ${customer.district || 'N/A'}`, rightX, y + 16, { width: 220, lineBreak: false, ellipsis: true })
    .text(
      `State: ${customer.state || 'N/A'}   |   Type: ${extraFields.customer_type || customer.customer_type || 'Dealer'}`,
      rightX,
      y + 27,
      { width: 220, lineBreak: false, ellipsis: true }
    );

  if (extraFields.referenceId) {
    doc.text(`Ref ID: ${extraFields.referenceId}`, rightX, y + 38, { width: 220, lineBreak: false, ellipsis: true });
  }

  return y + cardHeight + 8;
}

/**
 * Draw Modern Products Table
 */
function drawProductsTable(doc, products, startY, hasDiscount, docNumber = '', dateStr = '') {
  const tableWidth = 525.28;
  const colX = hasDiscount
    ? [35, 63, 260, 305, 365, 410, 460]
    : [35, 63, 300, 350, 420, 470];
  const colWidths = hasDiscount
    ? [28, 197, 45, 60, 45, 50, 100.28]
    : [28, 237, 50, 70, 50, 90.28];
  const colAlign = hasDiscount
    ? ['center', 'left', 'center', 'right', 'center', 'center', 'right']
    : ['center', 'left', 'center', 'right', 'center', 'right'];

  let y = startY;

  // Table Header Background
  doc.roundedRect(35, y, tableWidth, 18, 3).fill(COLORS.primaryLight);

  // Table Header Titles
  const headers = hasDiscount
    ? ['#', 'PRODUCT DESCRIPTION', 'QTY', 'PRICE', 'DISC', 'PER', 'TOTAL']
    : ['#', 'PRODUCT DESCRIPTION', 'QTY', 'PRICE', 'PER', 'TOTAL'];

  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7.5);
  headers.forEach((hdr, i) => {
    doc.text(hdr, colX[i] + 2, y + 5, { width: colWidths[i] - 4, align: colAlign[i] });
  });

  y += 20;

  let calculatedSubtotal = 0;
  const rowHeight = 16;
  const neededFooterSpace = 84;

  products.forEach((prod, idx) => {
    const isLast = (idx === products.length - 1);

    // Smart Pagination check:
    // If it's the last product, check if both this product and the footer can fit.
    // If they cannot, break to page 2 now so the last product stays together with the footer!
    // If it's not the last product, break if row exceeds 780.
    const shouldBreak = isLast
      ? (y + rowHeight + neededFooterSpace > 806)
      : (y + rowHeight > 780);

    if (shouldBreak) {
      doc.addPage();
      drawHeader(doc, 'CONTINUED', docNumber, dateStr);
      y = 30;
      // Redraw table header
      doc.roundedRect(35, y, tableWidth, 18, 3).fill(COLORS.primaryLight);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7.5);
      headers.forEach((hdr, i) => {
        doc.text(hdr, colX[i] + 2, y + 5, { width: colWidths[i] - 4, align: colAlign[i] });
      });
      y += 20;
    }

    const price = Number(prod.price) || 0;
    const discount = Number(prod.discount) || 0;
    const qty = Number(prod.quantity) || 0;
    const lineTotal = (price - (price * discount / 100)) * qty;
    calculatedSubtotal += lineTotal;

    // Row zebra striping
    if (idx % 2 === 1) {
      doc.rect(35, y, tableWidth, rowHeight).fill(COLORS.bgLight);
    }

    // Row bottom line
    doc.moveTo(35, y + rowHeight).lineTo(560.28, y + rowHeight).strokeColor(COLORS.border).stroke();

    // Row text
    doc.fillColor(COLORS.textMain).font('Helvetica').fontSize(8);

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
      doc.text(val, colX[i] + 2, y + 4, {
        width: colWidths[i] - 4,
        align: colAlign[i],
        lineBreak: false,
        ellipsis: true,
      });
      if (i === rowData.length - 1) doc.font('Helvetica');
    });

    y += rowHeight;
  });

  return { currentY: y + 4, calculatedSubtotal };
}

/**
 * Draw Summary, Grand Total, Thank You & Safe Diwali Statements, and Footer
 */
function drawFooterSection(doc, currentY, subtotal, extraCharges = {}) {
  let y = currentY + 4;
  const pf = parseFloat(extraCharges.pf || 0);
  const tax = parseFloat(extraCharges.tax || 0);
  const minus = parseFloat(extraCharges.minus || 0);
  const grandTotal = subtotal + pf + tax - minus;

  let extraCount = 0;
  if (pf > 0) extraCount++;
  if (tax > 0) extraCount++;
  if (minus > 0) extraCount++;

  const rightBreakdownHeight = 13 + (extraCount * 13) + 22 + 4 + 34;
  const leftCardHeight = 56;
  const neededHeight = Math.max(rightBreakdownHeight, leftCardHeight);

  if (y + neededHeight > 806) {
    doc.addPage();
    drawHeader(doc, 'CONTINUED', '', '');
    y = 36;
  }

  // Left Side: Customer Appreciation & Safe Diwali Guidelines Card
  const leftX = 35;
  const leftWidth = 265;
  const cardHeight = 56;
  doc.roundedRect(leftX, y, leftWidth, cardHeight, 4).fillAndStroke(COLORS.bgLight, COLORS.border);

  // Thank the Customer
  doc
    .fillColor(COLORS.gold)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text('THANK YOU FOR YOUR VALUED BUSINESS!', leftX + 8, y + 6);

  doc
    .fillColor(COLORS.primary)
    .font('Helvetica')
    .fontSize(6.8)
    .text('We truly appreciate your trust and patronage with HIFI PYRO PARK.', leftX + 8, y + 17);

  // Safe Diwali Statements
  doc
    .fillColor(COLORS.accent)
    .font('Helvetica-Bold')
    .fontSize(6.8)
    .text('SAFE DIWALI GUIDELINES:', leftX + 8, y + 27);

  doc
    .fillColor(COLORS.textMain)
    .font('Helvetica')
    .fontSize(6.2)
    .text('• Light in open areas under adult supervision  • Keep water & sand nearby', leftX + 8, y + 37, {
      width: leftWidth - 16,
      lineBreak: false,
      ellipsis: true,
    })
    .text('• Wear cotton clothes & maintain distance  • Never relight dud crackers', leftX + 8, y + 46, {
      width: leftWidth - 16,
      lineBreak: false,
      ellipsis: true,
    });

  doc
    .fillColor(COLORS.textMuted)
    .fontSize(6)
    .text('* Subject to Sivakasi Jurisdiction. Goods once sold will not be returned.', leftX, y + cardHeight + 4);

  // Right Side: Breakdown & Grand Total
  const rightX = 315;
  const rightWidth = 245.28;

  let rowY = y;
  doc.fillColor(COLORS.textMuted).font('Helvetica').fontSize(8);
  doc.text('Subtotal:', rightX, rowY);
  doc.fillColor(COLORS.textMain).text(formatCurrency(subtotal), rightX, rowY, { width: rightWidth, align: 'right' });
  rowY += 13;

  if (pf > 0) {
    doc.fillColor(COLORS.textMuted).text('Packing & Forwarding (P&F):', rightX, rowY);
    doc.fillColor(COLORS.textMain).text(formatCurrency(pf), rightX, rowY, { width: rightWidth, align: 'right' });
    rowY += 13;
  }

  if (tax > 0) {
    doc.fillColor(COLORS.textMuted).text('Tax / GST:', rightX, rowY);
    doc.fillColor(COLORS.textMain).text(formatCurrency(tax), rightX, rowY, { width: rightWidth, align: 'right' });
    rowY += 13;
  }

  if (minus > 0) {
    doc.fillColor(COLORS.green).text('Special Deduction / Discount:', rightX, rowY);
    doc.fillColor(COLORS.green).text(`-${formatCurrency(minus)}`, rightX, rowY, { width: rightWidth, align: 'right' });
    rowY += 13;
  }

  // Highlighted Grand Total Box
  doc.roundedRect(rightX - 4, rowY, rightWidth + 4, 22, 3).fill(COLORS.primary);

  doc
    .fillColor(COLORS.gold)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('GRAND TOTAL:', rightX + 6, rowY + 6);

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .text(formatCurrency(grandTotal), rightX, rowY + 5, { width: rightWidth - 6, align: 'right' });

  rowY += 26;

  // Signature Block
  const sigY = Math.max(rowY + 2, y + cardHeight + 2);
  doc
    .fillColor(COLORS.primary)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text(`For ${COMPANY.name}`, 560.28 - 140, sigY, { width: 140, align: 'center' });

  doc.moveTo(560.28 - 140, sigY + 16).lineTo(560.28, sigY + 16).strokeColor(COLORS.borderDark).stroke();

  doc
    .fillColor(COLORS.textMuted)
    .font('Helvetica')
    .fontSize(7)
    .text('Authorized Signatory', 560.28 - 140, sigY + 18, { width: 140, align: 'center' });
}

/**
 * Generate Modern Quotation PDF as in-memory Buffer (no disk write required)
 */
function generateModernQuotationPDFBuffer(quotationData, customerDetails, products, extraCharges = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!quotationData || !customerDetails || !Array.isArray(products)) {
        return reject(new Error('Invalid input for Quotation PDF'));
      }

      const doc = new PDFDocument({
        margin: 0,
        size: 'A4',
        autoFirstPage: true,
        bufferPages: true,
      });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));

      const docNumber = quotationData.est_id || 'QUO';
      const dateStr = quotationData.created_at || new Date();

      // Draw Top Header
      drawHeader(doc, 'QUOTATION', docNumber, dateStr, 'PENDING');

      // Draw Customer Card
      const tableStartY = drawCustomerCard(doc, customerDetails, 82, {
        customer_type: quotationData.customer_type,
      });

      // Check for discounts
      const hasDiscount = products.some((p) => parseFloat(p.discount || 0) > 0);

      // Draw Products Table
      const { currentY, calculatedSubtotal } = drawProductsTable(
        doc,
        products,
        tableStartY,
        hasDiscount,
        docNumber,
        dateStr
      );

      // Draw Summary & Footer
      drawFooterSection(doc, currentY, calculatedSubtotal, extraCharges);

      // Draw bottom footer banner across all pages
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        const footerY = 816;
        doc.rect(0, footerY + 8, 595.28, 3).fill(COLORS.primary);
        doc
          .fillColor(COLORS.textMuted)
          .font('Helvetica')
          .fontSize(6.8)
          .text(
            'Thank you for partnering with HIFI PYRO PARK! Wishing you a joyous, prosperous & safe Diwali celebration.',
            35,
            footerY,
            { width: 525.28, align: 'center' }
          );

        if (range.count > 1) {
          doc
            .fillColor(COLORS.primaryLight)
            .font('Helvetica-Bold')
            .fontSize(6.5)
            .text(`Page ${i + 1} of ${range.count}`, 490, footerY, { width: 70, align: 'right' });
        }
      }

      doc.on('end', () => {
        const buffer = Buffer.concat(buffers);
        resolve({ buffer, calculatedTotal: calculatedSubtotal });
      });
      doc.on('error', reject);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Quotation PDF (writes to safe directory, e.g. os.tmpdir(), without crashing on read-only environments)
 */
function generateModernQuotationPDF(quotationData, customerDetails, products, extraCharges = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const { buffer, calculatedTotal } = await generateModernQuotationPDFBuffer(quotationData, customerDetails, products, extraCharges);
      const safeCustomerName = (customerDetails.customer_name || customerDetails.name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const pdfDir = getSafePdfDir('quotation');
      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${quotationData.est_id || 'quo'}.pdf`);

      try {
        fs.writeFileSync(pdfPath, buffer);
      } catch (writeErr) {
        console.warn('Could not write quotation PDF to disk (read-only filesystem):', writeErr.message);
      }

      resolve({ pdfPath, calculatedTotal, buffer });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Invoice / Order Bill PDF as in-memory Buffer (no disk write required)
 */
function generateModernInvoicePDFBuffer(bookingData, customerDetails, products, extraCharges = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!bookingData || !customerDetails || !Array.isArray(products)) {
        return reject(new Error('Invalid input for Invoice PDF'));
      }

      const doc = new PDFDocument({
        margin: 0,
        size: 'A4',
        autoFirstPage: true,
        bufferPages: true,
      });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));

      const docNumber = bookingData.order_id || 'ORD';
      const dateStr = bookingData.created_at || new Date();

      // Draw Top Header
      drawHeader(doc, 'TAX INVOICE', docNumber, dateStr, bookingData.status || 'BOOKED');

      // Draw Customer Card
      const tableStartY = drawCustomerCard(doc, customerDetails, 82, {
        customer_type: bookingData.customer_type,
        referenceId: bookingData.est_id || null,
      });

      // Check for discounts
      const hasDiscount = products.some((p) => parseFloat(p.discount || 0) > 0);

      // Draw Products Table
      const { currentY, calculatedSubtotal } = drawProductsTable(
        doc,
        products,
        tableStartY,
        hasDiscount,
        docNumber,
        dateStr
      );

      // Draw Summary & Footer
      drawFooterSection(doc, currentY, calculatedSubtotal, extraCharges);

      // Draw bottom footer banner across all pages
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        const footerY = 816;
        doc.rect(0, footerY + 8, 595.28, 3).fill(COLORS.primary);
        doc
          .fillColor(COLORS.textMuted)
          .font('Helvetica')
          .fontSize(6.8)
          .text(
            'Thank you for partnering with HIFI PYRO PARK! Wishing you a joyous, prosperous & safe Diwali celebration.',
            35,
            footerY,
            { width: 525.28, align: 'center' }
          );

        if (range.count > 1) {
          doc
            .fillColor(COLORS.primaryLight)
            .font('Helvetica-Bold')
            .fontSize(6.5)
            .text(`Page ${i + 1} of ${range.count}`, 490, footerY, { width: 70, align: 'right' });
        }
      }

      doc.on('end', () => {
        const buffer = Buffer.concat(buffers);
        resolve({ buffer, calculatedTotal: calculatedSubtotal });
      });
      doc.on('error', reject);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Invoice / Order Bill PDF (writes to safe directory, e.g. os.tmpdir(), without crashing on read-only environments)
 */
function generateModernInvoicePDF(bookingData, customerDetails, products, extraCharges = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const { buffer, calculatedTotal } = await generateModernInvoicePDFBuffer(bookingData, customerDetails, products, extraCharges);
      const safeCustomerName = (customerDetails.customer_name || customerDetails.name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const pdfDir = getSafePdfDir('pdf_data');
      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${bookingData.order_id || 'ord'}.pdf`);

      try {
        fs.writeFileSync(pdfPath, buffer);
      } catch (writeErr) {
        console.warn('Could not write invoice PDF to disk (read-only filesystem):', writeErr.message);
      }

      resolve({ pdfPath, calculatedTotal, buffer });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Payment Receipt PDF as in-memory Buffer (no disk write required)
 */
function generateModernReceiptPDFBuffer(bookingData, customerDetails, payments = [], receiptId = '') {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 0,
        size: 'A4',
        autoFirstPage: true,
        bufferPages: true,
      });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));

      const genReceiptId = receiptId || `RCP-${Date.now()}`;

      // Draw Header
      drawHeader(doc, 'PAYMENT RECEIPT', genReceiptId, new Date(), 'PAID');

      // Customer card
      const y = drawCustomerCard(doc, customerDetails, 82, {
        customer_type: bookingData.customer_type,
        referenceId: bookingData.order_id,
      });

      // Payments Table
      const tableWidth = 525.28;
      const colX = [35, 70, 205, 320, 435];
      const colWidths = [35, 135, 115, 115, 125.28];

      doc.roundedRect(35, y, tableWidth, 18, 3).fill(COLORS.primaryLight);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7.5);
      ['#', 'PAYMENT METHOD', 'RECEIVED BY (ADMIN)', 'DATE', 'AMOUNT (INR)'].forEach((h, i) => {
        doc.text(h, colX[i] + 2, y + 5, { width: colWidths[i] - 4, align: i === 4 ? 'right' : 'left' });
      });

      let rowY = y + 20;
      let totalPaid = 0;

      payments.forEach((p, idx) => {
        const amt = Number(p.amount_paid) || 0;
        totalPaid += amt;

        if (idx % 2 === 1) doc.rect(35, rowY, tableWidth, 16).fill(COLORS.bgLight);
        doc.moveTo(35, rowY + 16).lineTo(560.28, rowY + 16).strokeColor(COLORS.border).stroke();

        doc.fillColor(COLORS.textMain).font('Helvetica').fontSize(8);
        doc.text(String(idx + 1), colX[0] + 2, rowY + 4);
        doc.text(p.payment_method ? p.payment_method.toUpperCase() : 'CASH', colX[1] + 2, rowY + 4);
        doc.text(p.admin_username || p.admin || 'Admin', colX[2] + 2, rowY + 4);
        doc.text(formatDate(p.created_at || p.transaction_date), colX[3] + 2, rowY + 4);
        doc.font('Helvetica-Bold').text(formatCurrency(amt), colX[4] + 2, rowY + 4, { width: colWidths[4] - 4, align: 'right' });

        rowY += 16;
      });

      // Receipt Summary
      const summaryY = rowY + 10;
      doc.roundedRect(315, summaryY, 245.28, 24, 3).fill(COLORS.primary);
      doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(9).text('TOTAL RECEIVED:', 323, summaryY + 7);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(11).text(formatCurrency(totalPaid), 323, summaryY + 6, { width: 231, align: 'right' });

      // Left Side: Customer Appreciation & Safe Diwali Card
      const leftX = 35;
      const leftWidth = 265;
      doc.roundedRect(leftX, summaryY, leftWidth, 56, 4).fillAndStroke(COLORS.bgLight, COLORS.border);

      doc
        .fillColor(COLORS.gold)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text('THANK YOU FOR YOUR PAYMENT!', leftX + 8, summaryY + 6);

      doc
        .fillColor(COLORS.primary)
        .font('Helvetica')
        .fontSize(6.8)
        .text('We sincerely thank you for your business and trust in HIFI PYRO PARK.', leftX + 8, summaryY + 17, { width: leftWidth - 16 });

      doc
        .fillColor(COLORS.accent)
        .font('Helvetica-Bold')
        .fontSize(6.8)
        .text('HAVE A SAFE & SPARKLING DIWALI!', leftX + 8, summaryY + 27);

      doc
        .fillColor(COLORS.textMain)
        .font('Helvetica')
        .fontSize(6.2)
        .text('• Handle fireworks responsibly & celebrate safely with loved ones.', leftX + 8, summaryY + 37, { width: leftWidth - 16 })
        .text('• Maintain adult supervision at all times.', leftX + 8, summaryY + 46, { width: leftWidth - 16 });

      // Signatory
      const sigY = summaryY + 64;
      doc
        .fillColor(COLORS.primary)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(`For ${COMPANY.name}`, 560.28 - 140, sigY, { width: 140, align: 'center' });

      doc.moveTo(560.28 - 140, sigY + 16).lineTo(560.28, sigY + 16).strokeColor(COLORS.borderDark).stroke();

      doc
        .fillColor(COLORS.textMuted)
        .font('Helvetica')
        .fontSize(7)
        .text('Authorized Signatory', 560.28 - 140, sigY + 18, { width: 140, align: 'center' });

      // Draw footer on all pages
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        const footerY = 816;
        doc.rect(0, footerY + 8, 595.28, 3).fill(COLORS.primary);
        doc
          .fillColor(COLORS.textMuted)
          .font('Helvetica')
          .fontSize(6.8)
          .text(
            'Thank you for partnering with HIFI PYRO PARK! Celebrate a Safe, Joyful & Eco-friendly Diwali.',
            35,
            footerY,
            { width: 525.28, align: 'center' }
          );

        if (range.count > 1) {
          doc
            .fillColor(COLORS.primaryLight)
            .font('Helvetica-Bold')
            .fontSize(6.5)
            .text(`Page ${i + 1} of ${range.count}`, 490, footerY, { width: 70, align: 'right' });
        }
      }

      doc.on('end', () => {
        const buffer = Buffer.concat(buffers);
        resolve({ buffer, calculatedTotal: totalPaid, receiptId: genReceiptId });
      });
      doc.on('error', reject);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate Modern Payment Receipt PDF (writes to safe directory, e.g. os.tmpdir(), without crashing on read-only environments)
 */
function generateModernReceiptPDF(bookingData, customerDetails, payments = [], receiptId = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const { buffer, calculatedTotal, receiptId: genReceiptId } = await generateModernReceiptPDFBuffer(bookingData, customerDetails, payments, receiptId);
      const safeCustomerName = (customerDetails.customer_name || customerDetails.name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const pdfDir = getSafePdfDir('receipt');
      const pdfPath = path.join(pdfDir, `${safeCustomerName}-${genReceiptId}.pdf`);

      try {
        fs.writeFileSync(pdfPath, buffer);
      } catch (writeErr) {
        console.warn('Could not write receipt PDF to disk (read-only filesystem):', writeErr.message);
      }

      resolve({ pdfPath, calculatedTotal, receiptId: genReceiptId, buffer });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  calculateModernQuotationTotal,
  generateModernQuotationPDFBuffer,
  generateModernQuotationPDF,
  generateModernInvoicePDFBuffer,
  generateModernInvoicePDF,
  generateModernReceiptPDFBuffer,
  generateModernReceiptPDF,
  COMPANY,
  COLORS,
  formatCurrency,
};
