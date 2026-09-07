const { Pool } = require("pg")
const fs = require("fs")
const path = require("path")
const os = require("os")
const PDFDocument = require("pdfkit")
const multer = require("multer")
const { generateOrderId } = require("../utils/numberGenerator")
const {
  generateModernInvoicePDF,
  generateModernInvoicePDFBuffer,
  generateModernReceiptPDF,
  generateModernReceiptPDFBuffer,
} = require("../utils/modernPdfGenerator")

const getSafeReceiptDir = (sub = "receipt") => {
  const dir = process.env.PDF_STORAGE_DIR || path.join(os.tmpdir(), "hifi_pdf", sub);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
};

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pdfDir = getSafeReceiptDir("pdf_data")
    cb(null, pdfDir)
  },
  filename: (req, file, cb) => {
    const { customer_name, order_id } = req.body
    const safeName = (customer_name || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    cb(null, `${safeName}-${order_id}.pdf`)
  },
})
const upload = multer({ storage })

const validateId = (id, type = "id") => (/^[a-zA-Z0-9-_]+$/.test(id) ? null : `Invalid ${type} format`)

const parseProducts = (products) => {
  try {
    return typeof products === "string" ? JSON.parse(products) : products || []
  } catch {
    return null
  }
}

const drawTableRow = (doc, y, colX, colWidths, values, alignOptions = []) => {
  values.forEach((val, i) => {
    const textVal = typeof val === "object" && val.text ? val.text : val
    const align = alignOptions[i] || "center"
    doc.text(textVal, colX[i] + 5, y, { width: colWidths[i] - 10, align })
  })
  doc
    .moveTo(50, y + 15)
    .lineTo(570, y + 15)
    .stroke()
  colX.forEach((x, i) =>
    doc
      .moveTo(x, y - 5)
      .lineTo(x, y + 15)
      .stroke(),
  )
  doc
    .moveTo(570, y - 5)
    .lineTo(570, y + 15)
    .stroke()
}

const generateReceiptId = () => {
  const randomNum = Math.floor(100000000 + Math.random() * 900000000) // 9-digit random number
  return `rcp${randomNum}`
}

const generateReceiptPDF = (
  bookingData,
  customerDetails,
  products,
  dispatchLogs = [],
  payments = [],
  extraCharges = {},
) => {
  return new Promise((resolve, reject) => {
    if (!bookingData || !customerDetails || !Array.isArray(products)) {
      return reject(new Error("Invalid input: bookingData, customerDetails, and products required"))
    }
    const doc = new PDFDocument({ margin: 50 })
    const safeName = (customerDetails.customer_name || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    const receiptId = generateReceiptId()
    const pdfDir = getSafeReceiptDir("receipt")
    const pdfPath = path.join(pdfDir, `${safeName}-${receiptId}.pdf`)
    const stream = fs.createWriteStream(pdfPath)
    doc.pipe(stream)
    // Header
    doc.fontSize(12).font("Helvetica").text(`Receipt ${receiptId}`, 300, 50, { align: "right" })
    doc.fontSize(20).font("Helvetica-Bold").text("Receipt", 50, 80, { align: "center" })
    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Hifi Pyro Park", 50, 110, { align: "left" })
      .text("Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi", 50, 125, { align: "left" })
      .text("Mobile:+91 97865 08621, +91 97868 60010", 50, 140, { align: "left" })
      .text(`Customer: ${customerDetails.customer_name || "N/A"}`, 300, 110, { align: "right" })
      .text(`Contact: ${customerDetails.mobile_number || "N/A"}`, 300, 125, { align: "right" })
      .text(`City: ${customerDetails.district || "N/A"}`, 300, 140, { align: "right" })
      .text(
        `Order Date: ${new Date(bookingData.created_at || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}`,
        300,
        155,
        { align: "right" },
      )
    // Payment Table
    let y = 200
    const colWidths = [50, 150, 150, 100, 100]
    const colX = [50, 100, 250, 400, 500]
    doc
      .moveTo(50, y - 5)
      .lineTo(570, y - 5)
      .stroke()
    drawTableRow(
      doc,
      y,
      colX,
      colWidths,
      ["Sl.No", "Payment Type", "Paid to Admin", "Date", "Amount (₹)"],
      ["center", "left", "left", "right", "right"],
    )
    // Table data (only payments)
    const tableData = payments
      .map((payment, index) => ({
        slNo: index + 1,
        paymentType: payment.payment_method || "N/A",
        paidToAdmin: payment.admin_username || "N/A",
        date: new Date(payment.created_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        amount: Number.parseFloat(payment.amount_paid || 0).toFixed(2),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    y += 25
    tableData.forEach((row, index) => {
      if (y > 700) {
        doc.addPage()
        y = 50
      }
      drawTableRow(
        doc,
        y,
        colX,
        colWidths,
        [row.slNo, row.paymentType, row.paidToAdmin, row.date, row.amount],
        ["center", "left", "left", "right", "right"],
      )
      y += 20
    })
    // Extra Charges
    y += 10
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    const tax = Number.parseFloat(extraCharges.tax || 0)
    const pf = Number.parseFloat(extraCharges.pf || 0)
    const minus = Number.parseFloat(extraCharges.minus || 0)
    if (tax || pf || minus) {
      const extraText = [
        tax ? `Tax: ₹${tax.toFixed(2)}` : "",
        pf ? `Packaging & Forwarding: ₹${pf.toFixed(2)}` : "",
        minus ? `Deduction: ₹${minus.toFixed(2)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      doc.font("Helvetica").text(extraText, 400, y, { align: "right" })
      y += 20 * extraText.split("\n").length
    }
    // Total Row
    const totalAmount = payments.reduce((sum, p) => sum + Number.parseFloat(p.amount_paid || 0), 0)
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    doc
      .moveTo(50, y - 5)
      .lineTo(570, y - 5)
      .stroke()
    drawTableRow(
      doc,
      y,
      colX,
      colWidths,
      [{ text: "Total", colSpan: 4 }, "", "", "", totalAmount.toFixed(2)],
      ["left", "left", "left", "right", "right"],
    )
    doc
      .moveTo(50, y - 5)
      .lineTo(400, y - 5)
      .stroke()
    doc
      .moveTo(50, y + 15)
      .lineTo(570, y + 15)
      .stroke()
    colX.forEach((x, i) =>
      doc
        .moveTo(x, y - 5)
        .lineTo(x, y + 15)
        .stroke(),
    )
    doc
      .moveTo(570, y - 5)
      .lineTo(570, y + 15)
      .stroke()
    doc.end()
    stream.on("finish", () => resolve({ pdfPath, calculatedTotal: totalAmount, receiptId }))
    stream.on("error", reject)
  })
}

exports.getReceipt = async (req, res) => {
  try {
    let { receipt_id } = req.params
    console.log(`Processing receipt for receipt_id: ${receipt_id}`)
    // Normalize receipt_id
    if (receipt_id.endsWith(".pdf")) {
      receipt_id = receipt_id.replace(/\.pdf$/, "")
    }
    // Validate receipt_id (e.g., rcp followed by 9 digits)
    if (!receipt_id.startsWith("rcp") || !/^[a-zA-Z0-9]{12}$/.test(receipt_id)) {
      console.error(`Invalid receipt_id format: ${receipt_id}`)
      return res.status(400).json({ message: 'Invalid receipt_id. Must start with "rcp" followed by 9 digits.' })
    }
    // Fetch booking data
    console.log("Querying dbooking table...")
    const { rows } = await pool.query(
      "SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, status, pdf, order_id, id, extra_charges, created_at, receipt_id, customer_id FROM public.dbooking WHERE receipt_id = $1",
      [receipt_id],
    )
    if (!rows.length) {
      console.error(`No booking found for receipt_id: ${receipt_id}`)
      return res.status(404).json({ message: `Receipt not found for receipt_id '${receipt_id}'` })
    }
    const {
      products,
      total,
      customer_name,
      address,
      mobile_number,
      email,
      district,
      state,
      customer_type,
      status,
      order_id: actualOrderId,
      id: booking_id,
      extra_charges,
      created_at,
      receipt_id: dbReceiptId,
      customer_id,
    } = rows[0]
    // Validate user association (if user is authenticated)
    const userId = req.user?.id // Assuming req.user is set by authentication middleware
    if (userId && customer_id && customer_id !== userId) {
      console.error(`User ${userId} not authorized for receipt_id: ${receipt_id}`)
      return res.status(403).json({ message: "Not authorized to access this receipt" })
    }
    const parsedProducts = parseProducts(products)
    if (!parsedProducts) {
      console.error("Failed to parse products:", products)
      throw new Error("Invalid product data format")
    }
    // Fetch dispatch logs
    console.log(`Querying dispatch_logs for order_id: ${actualOrderId}`)
    const { rows: dispatchLogs } = await pool.query(
      "SELECT product_name, quantity, dispatched_qty, dispatched_at, product_index FROM public.dispatch_logs WHERE order_id = $1 ORDER BY dispatched_at DESC",
      [actualOrderId],
    )
    // Fetch payment transactions
    console.log(`Querying payment_transactions for booking_id: ${booking_id}`)
    const { rows: paymentRows } = await pool.query(
      `SELECT pt.amount_paid, pt.payment_method, pt.created_at, a.username AS admin_username
         FROM public.payment_transactions pt
         LEFT JOIN public.admin a ON pt.admin_id = a.id
         WHERE pt.booking_id = $1 ORDER BY pt.id ASC`,
      [booking_id],
    )
    // Generate receipt ID and PDF path
    const safeName = customer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    const pdfPath = path.join(__dirname, "receipt", `${safeName}-${receipt_id}.pdf`)
    // Generate PDF if it doesn't exist or if receipt_id is missing
    if (!fs.existsSync(pdfPath) || !dbReceiptId) {
      console.log(`Generating new PDF at: ${pdfPath}`)
      try {
        const {
          pdfPath: generatedPdfPath,
          calculatedTotal,
          receiptId: generatedReceiptId,
        } = await generateModernReceiptPDF(
          { order_id: actualOrderId, customer_type, total, status, created_at },
          { customer_name, address, mobile_number, email, district, state },
          paymentRows,
          receipt_id || dbReceiptId,
        )
        console.log(`PDF generated at: ${generatedPdfPath}`)
        // Update receipt_id in dbooking table if not already set
        if (!dbReceiptId) {
          await pool.query("UPDATE public.dbooking SET receipt_id = $1 WHERE id = $2", [generatedReceiptId, booking_id])
        }
      } catch (pdfError) {
        console.error("PDF generation failed:", pdfError.message, pdfError.stack)
        throw new Error(`Failed to generate receipt PDF: ${pdfError.message}`)
      }
    } else {
      console.log(`Using existing PDF at: ${pdfPath}`)
    }
    // Wait briefly to ensure file is written
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Verify file exists before streaming
    if (!fs.existsSync(pdfPath)) {
      console.error(`PDF file not found at: ${pdfPath}`)
      throw new Error("PDF file not found after generation")
    }
    // Serve the PDF
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename=${safeName}-${receipt_id}.pdf`)
    const stream = fs.createReadStream(pdfPath)
    stream.on("error", (streamError) => {
      console.error("Error reading PDF file:", streamError.message, streamError.stack)
      res.status(500).json({ message: "Failed to read receipt PDF", error: streamError.message })
    })
    stream.on("open", () => {
      console.log("Streaming PDF to client")
      stream.pipe(res)
    })
  } catch (err) {
    console.error("Error in getReceipt:", err.message, err.stack)
    res.status(500).json({ message: "Failed to fetch receipt", error: err.message })
  }
}

const generateInvoicePDF = (
  bookingData,
  customerDetails,
  products,
  dispatchLogs = [],
  payments = [],
  extraCharges = {},
) => {
  return new Promise((resolve, reject) => {
    if (!bookingData || !customerDetails || !Array.isArray(products)) {
      return reject(new Error("Invalid input: bookingData, customerDetails, and products required"))
    }
    const doc = new PDFDocument({ margin: 50 })
    const safeName = (customerDetails.customer_name || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    const pdfDir = getSafeReceiptDir("receipt")
    const pdfPath = path.join(pdfDir, `${safeName}-${bookingData.order_id || "unknown"}-receipt.pdf`)
    const stream = fs.createWriteStream(pdfPath)
    doc.pipe(stream)
    // Header
    doc.fontSize(20).font("Helvetica-Bold").text("Receipt", 50, 50, { align: "center" })
    doc
      .fontSize(12)
      .font("Helvetica")
      .text("Hifi Pyro Park", 50, 80, { align: "center" })
      .text("Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi", 50, 95, { align: "center" })
      .text("Mobile: +91 63836 59214", 50, 110, { align: "center" })
      .text("Email: nivasramasamy27@gmail.com", 50, 125, { align: "center" })
      .text(`Customer: ${customerDetails.customer_name || "N/A"}`, 50, 160)
      .text(`Contact: ${customerDetails.mobile_number || "N/A"}`, 50, 175)
      .text(
        `Address: ${customerDetails.address || "N/A"}, ${customerDetails.district || "N/A"}, ${customerDetails.state || "N/A"}`,
        50,
        190,
      )
      .text(`Order ID: ${bookingData.order_id || "N/A"}`, 300, 160, { align: "right" })
      .text(
        `Order Date: ${new Date(bookingData.created_at || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}`,
        300,
        175,
        { align: "right" },
      )
      .text(`Status: ${bookingData.status || "N/A"}`, 300, 190, { align: "right" })
    // Receipt Table
    let y = 250
    const colWidths = [50, 200, 80, 80, 80, 80]
    const colX = [50, 100, 300, 380, 460, 540]
    doc
      .moveTo(50, y - 5)
      .lineTo(570, y - 5)
      .stroke()
    drawTableRow(
      doc,
      y,
      colX,
      colWidths,
      ["Sl.No", "Description", "Quantity", "Rate/Box (₹)", "Date", "Amount (₹)"],
      ["center", "left", "right", "right", "right", "right"],
    )
    // Calculate debit and credit
    let debit = 0
    const tableData = [
      ...dispatchLogs.map((log, index) => {
        const prod = products[log.product_index]
        const price = prod ? Number.parseFloat(prod.price) || 0 : 0
        const discount = prod ? Number.parseFloat(prod.discount || 0) : 0
        const effectivePrice = price - (price * discount) / 100
        const amount = effectivePrice * (log.dispatched_qty || 0)
        debit += amount
        return {
          slNo: index + 1,
          productName: log.product_name || "N/A",
          quantity: log.dispatched_qty || 0,
          ratePerBox: effectivePrice.toFixed(2),
          amount: `${amount.toFixed(2)} Dr`,
          date: new Date(log.dispatched_at).getTime(),
        }
      }),
      ...payments.map((payment, index) => ({
        slNo: dispatchLogs.length + index + 1,
        productName: `Payment (${payment.payment_method || "N/A"})`,
        quantity: "-",
        ratePerBox: "-",
        amount: `${Number.parseFloat(payment.amount_paid || 0).toFixed(2)} Cr`,
        date: new Date(payment.created_at).getTime(),
      })),
    ].sort((a, b) => b.date - a.date) // Sort by date, latest to earliest
    y += 25
    tableData.forEach((row, index) => {
      if (y > 700) {
        doc.addPage()
        y = 50
      }
      drawTableRow(
        doc,
        y,
        colX,
        colWidths,
        [
          row.slNo,
          row.productName,
          row.quantity,
          row.ratePerBox,
          new Date(row.date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }),
          row.amount,
        ],
        ["center", "left", "right", "right", "right", row.amount.includes("Dr") ? "right" : "right"],
      )
      y += 20
    })
    // Extra Charges (Tax, P&F, Deduction)
    y += 10
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    const tax = Number.parseFloat(extraCharges.tax || 0)
    const pf = Number.parseFloat(extraCharges.pf || 0)
    const minus = Number.parseFloat(extraCharges.minus || 0)
    if (tax || pf || minus) {
      const extraText = [
        tax ? `Tax: Rs.${tax.toFixed(2)}` : "",
        pf ? `P&F: Rs.${pf.toFixed(2)}` : "",
        minus ? `Deduction: -Rs.${minus.toFixed(2)}` : "",
      ]
        .filter(Boolean)
        .join("  ")
      doc.font("Helvetica").text(extraText, 450, y, { align: "right" })
      y += 20
      debit = debit + tax + pf - minus
    }
    // Total Row
    const credit = payments.reduce((sum, p) => sum + Number.parseFloat(p.amount_paid || 0), 0)
    const netBalance = credit - debit
    const totalQty = products.reduce((sum, p) => sum + Number(p.quantity || 0), 0)
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    doc
      .moveTo(50, y - 5)
      .lineTo(570, y - 5)
      .stroke()
    drawTableRow(
      doc,
      y,
      colX,
      colWidths,
      [
        { text: "Total", colSpan: 2 },
        totalQty,
        "-",
        "-",
        { text: `${netBalance.toFixed(2)} ${netBalance < 0 ? "(Outstanding)" : "(Advance)"}` },
      ],
      ["left", "left", "right", "right", "right", netBalance < 0 ? "right" : "right"],
    )
    doc
      .moveTo(50, y - 5)
      .lineTo(300, y - 5)
      .stroke() // Line for merged "Total" cell
    doc
      .moveTo(50, y + 15)
      .lineTo(570, y + 15)
      .stroke()
    colX.forEach((x, i) =>
      doc
        .moveTo(x, y - 5)
        .lineTo(x, y + 15)
        .stroke(),
    )
    doc
      .moveTo(570, y - 5)
      .lineTo(570, y + 15)
      .stroke()
    doc.end()
    stream.on("finish", () => resolve({ pdfPath, calculatedTotal: netBalance }))
    stream.on("error", reject)
  })
}

exports.getAdmins = async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, username, bank_name FROM public.admin")
    const admins = await Promise.all(
      rows.map(async (admin) => ({
        ...admin,
        total: (
          await pool.query(
            "SELECT COALESCE(SUM(amount_paid), 0) as total FROM public.payment_transactions WHERE admin_id = $1",
            [admin.id],
          )
        ).rows[0].total,
      })),
    )
    res.json(admins)
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch admins", error: err.message })
  }
}

exports.getAdminTransactions = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { rows } = await pool.query(
      `SELECT pt.amount_paid, pt.payment_method, pt.transaction_date, pt.bank_name, d.customer_name
       FROM public.payment_transactions pt
       LEFT JOIN public.dbooking d ON pt.booking_id = d.id
       WHERE pt.admin_id = $1
       ORDER BY pt.transaction_date DESC`,
      [adminId],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch transactions", error: err.message });
  }
};

exports.getBankAccounts = async (req, res) => {
  try {
    const { username } = req.params;
    const { rows } = await pool.query(
      "SELECT bank_name FROM public.admin WHERE LOWER(username) = LOWER($1)",
      [username]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.json(rows[0].bank_name || []);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch bank accounts", error: err.message });
  }
};

exports.addBankAccount = async (req, res) => {
  try {
    const { username, bank_name } = req.body; // Expect username and bank_name from the client
    if (!bank_name) {
      return res.status(400).json({ message: "Bank name is required" });
    }
    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }
    // Fetch the admin id based on username with case-insensitive matching
    const adminResult = await pool.query(
      "SELECT id FROM public.admin WHERE LOWER(username) = LOWER($1)",
      [username]
    );
    if (adminResult.rows.length === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }
    const adminId = adminResult.rows[0].id;
    // Update the existing admin's bank_name array by appending the new bank_name
    await pool.query(
      "UPDATE public.admin SET bank_name = array_append(bank_name, $2) WHERE id = $1",
      [adminId, bank_name]
    );
    res.status(201).json({ message: "Bank account added successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to add bank account", error: err.message });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.order_id, d.customer_name, d.company_name, d.license_number, d.address, d.district, d.state, d.mobile_number, d.email,
             d.products, d.status, d.created_at, d.pdf, d.remaining, d.admin, d.customer_type, d.customer_id, d.balance, d.amount_paid,
             d.payment_date, d.amount_status, d.payment_method, d.admin_id, d.transaction_date, d.transport_type, d.transport_name,
             d.transport_contact, d.lr_number, d.extra_charges, d.total, d.dispatched_qty,
             COALESCE(a.username, NULLIF(d.admin, ''), 'Admin') AS admin_username
      FROM public.dbooking d
      LEFT JOIN public.admin a ON d.admin_id = a.id
      ORDER BY d.created_at DESC
    `)
    res.json(rows)
  } catch (err) {
    console.error("Error fetching bookings:", err)
    res.status(500).json({ error: "Failed to fetch bookings" })
  }
}

exports.getTransactions = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rows } = await pool.query(
      `SELECT pt.amount_paid, pt.payment_method, pt.admin_id, pt.bank_name, pt.transaction_date, a.username AS admin_username
       FROM public.payment_transactions pt
       LEFT JOIN public.admin a ON pt.admin_id = a.id
       WHERE pt.booking_id = $1
       ORDER BY pt.transaction_date DESC`,
      [bookingId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch transactions", error: err.message });
  }
};

exports.updateBookingStatus = async (req, res) => {
  const { id } = req.params;
  const {
    status,
    dispatched_qty,
    transport_type,
    transport_name,
    transport_contact,
    lr_number,
    payment_method,
    amount_paid,
    admin_id,
    bank_account,
  } = req.body;

  try {
    if (validateId(id, "booking ID")) {
      return res.status(400).json({ error: validateId(id, "booking ID") });
    }

    const { rows } = await pool.query(
      "SELECT products, dispatched_qty, total, amount_paid FROM public.dbooking WHERE id = $1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Booking not found" });

    const booking = rows[0];
    const products = parseProducts(booking.products);
    if (!products) return res.status(400).json({ error: "Invalid product data format" });

    let updateQuery = "UPDATE public.dbooking SET";
    const updateValues = [];
    let paramCount = 1;
    let hasUpdates = false;

    // Handle payments (independent of status)
    if (amount_paid && Number.parseFloat(amount_paid) > 0) {
      if (!["cash", "bank"].includes(payment_method) || !admin_id) {
        return res.status(400).json({ error: "Invalid payment method or admin ID" });
      }
      const total = Number.parseFloat(booking.total) || 0;
      const currentPaid = Number.parseFloat(booking.amount_paid) || 0;
      if (Number.parseFloat(amount_paid) > total - currentPaid) {
        return res.status(400).json({ error: "Amount paid exceeds remaining balance" });
      }

      // Validate bank_account if payment is bank
      if (payment_method === "bank" && bank_account) {
        const adminResult = await pool.query(
          "SELECT bank_name FROM public.admin WHERE id = $1",
          [admin_id]
        );
        if (adminResult.rows.length === 0) {
          return res.status(404).json({ error: "Admin not found" });
        }
        const bankNames = adminResult.rows[0].bank_name || [];
        if (!bankNames.includes(bank_account)) {
          return res.status(400).json({ error: `Invalid bank account. Available accounts: ${bankNames.join(", ")}` });
        }
      }

      updateQuery += ` amount_paid = COALESCE(amount_paid, 0) + $${paramCount++}, payment_method = $${paramCount++}, admin_id = $${paramCount++}`;
      updateValues.push(Number.parseFloat(amount_paid), payment_method, admin_id);
      hasUpdates = true;

      // Insert payment transaction
      await pool.query(
        "INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date, bank_name) VALUES ($1, $2, $3, $4, NOW(), $5)",
        [id, Number.parseFloat(amount_paid), payment_method, admin_id, bank_account || null]
      );
    }

    // Handle status changes (only if provided)
    if (status) {
      if (status === "paid") {
        // no need to set status automatically here, handled above if payments
        updateQuery += `${hasUpdates ? "," : ""} status = $${paramCount++}`;
        updateValues.push(status);
        hasUpdates = true;
      } else if (["dispatched", "delivered"].includes(status)) {
        const totalQty = products.reduce((sum, p) => sum + (Number.parseInt(p.quantity) || 0), 0);
        const currentDispatched = Number.parseInt(booking.dispatched_qty || 0);
        const newDispatchQty = Number.parseInt(dispatched_qty || 0);
        if (!dispatched_qty || newDispatchQty <= 0 || currentDispatched + newDispatchQty > totalQty) {
          return res.status(400).json({ error: "Invalid dispatch quantity" });
        }
        updateQuery += `${hasUpdates ? "," : ""} status = $${paramCount++}, dispatched_qty = $${paramCount++}`;
        updateValues.push(status, currentDispatched + newDispatchQty);
        hasUpdates = true;

        if (transport_type) {
          updateQuery += `, transport_type = $${paramCount++}`;
          updateValues.push(transport_type);
          if (transport_type === "transport") {
            if (transport_name) {
              updateQuery += `, transport_name = $${paramCount++}`;
              updateValues.push(transport_name);
            }
            if (transport_contact) {
              updateQuery += `, transport_contact = $${paramCount++}`;
              updateValues.push(transport_contact);
            }
            if (lr_number) {
              updateQuery += `, lr_number = $${paramCount++}`;
              updateValues.push(lr_number);
            }
          }
        }
      } else if (["cancelled", "canceled"].includes(status.toLowerCase())) {
        // Restock quantity as added in bill
        for (const product of products) {
          const { id: productId, product_type, quantity } = product;
          if (!productId || !quantity) continue;
          const tableName = (product_type || "gift_box_dealers").toLowerCase().replace(/\s+/g, "_");
          try {
            await pool.query(
              `UPDATE public.${tableName} SET stock = stock + $1 WHERE id = $2`,
              [Number(quantity), Number(productId)]
            );
          } catch (err) {
            console.warn(`Could not restore stock for ${tableName}:`, err.message);
          }
        }
        updateQuery += `${hasUpdates ? "," : ""} status = $${paramCount++}`;
        updateValues.push('cancelled');
        hasUpdates = true;
      } else {
        return res.status(400).json({ error: "Invalid status value" });
      }
    }

    if (!hasUpdates) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    updateQuery += ` WHERE id = $${paramCount}`;
    updateValues.push(id);

    await pool.query(updateQuery, updateValues);

    res.json({ message: "Booking updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update booking status" });
  }
};

exports.updateBookingStatusByOrderId = async (req, res) => {
  const { order_id } = req.params
  const { status = "dispatched", products, transport_type, transport_name, transport_contact, lr_number } = req.body
  const allowedStatuses = ["booked", "paid", "dispatched", "delivered", "cancelled", "canceled"]
  try {
    if (validateId(order_id)) return res.status(400).json({ error: validateId(order_id) })
    const { rows } = await pool.query("SELECT * FROM public.dbooking WHERE order_id = $1", [order_id])
    if (!rows.length) return res.status(404).json({ message: "Booking not found" })
    const booking = rows[0]
    const parsedProducts = parseProducts(booking.products)
    if (!parsedProducts) return res.status(400).json({ message: "Invalid product data format" })

    const newStatus = status.toLowerCase()
    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ message: `Invalid status: ${status}. Must be one of ${allowedStatuses.join(", ")}` })
    }

    // Handle cancellation and restock
    if (["cancelled", "canceled"].includes(newStatus)) {
      for (const product of parsedProducts) {
        const { id: productId, product_type, quantity } = product;
        if (!productId || !quantity) continue;
        const tableName = (product_type || "gift_box_dealers").toLowerCase().replace(/\s+/g, "_");
        try {
          await pool.query(
            `UPDATE public.${tableName} SET stock = stock + $1 WHERE id = $2`,
            [Number(quantity), Number(productId)]
          );
        } catch (err) {
          console.warn(`Could not restore stock for ${tableName}:`, err.message);
        }
      }
      await pool.query("UPDATE public.dbooking SET status = 'cancelled' WHERE order_id = $1", [order_id]);
      if (order_id.includes("ORD")) {
        await pool.query("UPDATE public.quotations SET status = 'canceled' WHERE est_id = $1", [order_id.replace("ORD", "QUO")]);
      }
      return res.json({ message: "Order cancelled and stock restored successfully" });
    }
    // Update dispatched quantities and validate totals
    products.forEach(({ index, dispatch_qty, total }) => {
      const parsedTotal = Number.parseFloat(total)
      if (isNaN(parsedTotal) || parsedTotal < 0) {
        throw new Error(`Invalid total for product index ${index}`)
      }
      parsedProducts[index].dispatched = (parsedProducts[index].dispatched || 0) + dispatch_qty
    })
    const totalDispatched = parsedProducts.reduce((sum, p) => sum + (p.dispatched || 0), 0)
    const totalQty = parsedProducts.reduce((sum, p) => sum + (Number.parseInt(p.quantity) || 0), 0)
    // Log for debugging
    console.log("Input status:", newStatus, "Total Dispatched:", totalDispatched, "Total Qty:", totalQty)
    await pool.query(
      `UPDATE public.dbooking SET
         products = $1, dispatched_qty = $2, transport_type = $3, transport_name = $4,
         transport_contact = $5, lr_number = $6, status = $7
       WHERE order_id = $8`,
      [
        JSON.stringify(parsedProducts),
        totalDispatched,
        transport_type || null,
        transport_name || null,
        transport_contact || null,
        lr_number || null,
        newStatus,
        order_id,
      ],
    )
    const insertPromises = products.map(({ index, dispatch_qty, total }) => {
      const product = parsedProducts[index]
      return pool.query(
        `INSERT INTO public.dispatch_logs (
          order_id, booking_id, customer_name, company_name, license_number, address, district, state,
          mobile_number, email, product_index, product_name, quantity, dispatched_qty, admin, customer_type,
          customer_id, amount_paid, balance, payment_method, payment_date, transaction_date, transport_type,
          transport_name, transport_contact, lr_number, total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          booking.order_id,
          booking.id,
          booking.customer_name,
          booking.company_name,
          booking.license_number,
          booking.address,
          booking.district,
          booking.state,
          booking.mobile_number,
          booking.email,
          index,
          product.productname || `Product ${index}`,
          Number.parseInt(product.quantity) || 0,
          dispatch_qty,
          booking.admin,
          booking.customer_type,
          booking.customer_id,
          booking.amount_paid,
          booking.balance,
          booking.payment_method,
          booking.payment_date,
          booking.transaction_date,
          transport_type || null,
          transport_name || null,
          transport_contact || null,
          lr_number || null,
          Number.parseFloat(total) || 0.0,
        ],
      )
    })
    await Promise.all(insertPromises)
    res.json({ message: "Dispatch updated and logged successfully" })
  } catch (err) {
    console.error("Error in updateBookingStatusByOrderId:", err.message)
    res.status(500).json({ message: "Internal server error", error: err.message })
  }
}

exports.getDispatchLogsByOrderId = async (req, res) => {
  const { order_id } = req.params
  try {
    if (validateId(order_id)) return res.status(400).json({ message: validateId(order_id) })
    const { rows: dispatchLogs } = await pool.query(
      "SELECT * FROM public.dispatch_logs WHERE order_id = $1 ORDER BY dispatched_at DESC",
      [order_id],
    )
    let payments = []
    if (dispatchLogs.length) {
      const { rows } = await pool.query(
        `SELECT pt.*, a.username AS admin_username
           FROM public.payment_transactions pt
           LEFT JOIN public.admin a ON pt.admin_id = a.id
           WHERE pt.booking_id = $1 ORDER BY pt.id ASC`,
        [dispatchLogs[0].booking_id],
      )
      payments = rows
    }
    res.json({ dispatch_logs: dispatchLogs, payments })
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch data", error: err.message })
  }
}

const validTables = ["gift_box_dealers"]; // Add other valid table names if needed

exports.createBooking = async (req, res) => {
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
    payment_method,
    amount_paid,
    admin_id,
  } = req.body;
  const order_id = await generateOrderId(pool);

  try {
    if (!products?.length || total <= 0) {
      return res.status(400).json({ message: "Valid products and total required" });
    }
    if (
      payment_method &&
      (!["cash", "bank"].includes(payment_method) || !amount_paid || amount_paid <= 0 || !admin_id)
    ) {
      return res.status(400).json({ message: "Invalid payment details" });
    }

    let finalCustomerType = customer_type || "User";
    let customerDetails = { customer_name, address, mobile_number, email, district, state };
    if (customer_id) {
      let { rows } = await pool.query(
        "SELECT customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1",
        [customer_id],
      );
      if (!rows.length) {
        const userCheck = await pool.query(
          "SELECT username AS customer_name, companyname, address, mobile_number, email, district, state, 'User' AS customer_type FROM public.users WHERE id = $1",
          [customer_id],
        );
        if (userCheck.rows.length) rows = userCheck.rows;
      }
      if (!rows.length) return res.status(404).json({ message: "Customer not found" });
      customerDetails = rows[0];
      finalCustomerType = customer_type || rows[0].customer_type || "User";
    } else if (
      finalCustomerType !== "User" ||
      !customer_name ||
      !address ||
      !district ||
      !state ||
      !mobile_number
    ) {
      return res.status(400).json({ message: "Complete customer details required for non-existing customers" });
    }

    // Start a transaction
    await pool.query("BEGIN");

    // Validate products and check stock
    for (const { id, product_type, quantity } of products) {
      if (!id || !product_type || quantity < 1) {
        await pool.query("ROLLBACK");
        return res.status(400).json({ message: "Invalid product data" });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, "_");
      if (!validTables.includes(tableName)) {
        await pool.query("ROLLBACK");
        return res.status(400).json({ message: `Invalid product_type: ${product_type}. Must be one of ${validTables.join(", ")}` });
      }
      const { rows } = await pool.query(`SELECT id, stock FROM public.${tableName} WHERE id = $1 AND status = 'on'`, [
        id,
      ]);
      if (!rows.length) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ message: `Product ${id} not found` });
      }
      if (quantity > rows[0].stock) {
        await pool.query("ROLLBACK");
        return res.status(400).json({ message: `Insufficient stock for product ${id}` });
      }
    }

    // Update stock for each product
    for (const { id, product_type, quantity } of products) {
      const tableName = product_type.toLowerCase().replace(/\s+/g, "_");
      await pool.query(`UPDATE public.${tableName} SET stock = stock - $1 WHERE id = $2`, [quantity, id]);
    }

    const pdfPath = `/api/hifi/direct/invoice/${order_id}`;

    const bookingQuery = `INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, payment_method, amount_paid, admin_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'booked', NOW(), $12, $13, $14, $15) RETURNING id, created_at, customer_type, pdf, order_id`;
    const bookingValues = [
        customer_id || null,
        order_id,
        JSON.stringify(products),
        Number.parseFloat(total),
        customerDetails.address || null,
        customerDetails.mobile_number || null,
        customerDetails.customer_name || null,
        customerDetails.email || null,
        customerDetails.district || null,
        customerDetails.state || null,
        finalCustomerType,
        pdfPath,
        payment_method || null,
        Number.parseFloat(amount_paid) || 0,
        admin_id || null,
    ];
    let rows;
    try {
      const res = await pool.query(bookingQuery, bookingValues);
      rows = res.rows;
    } catch (bookingDbErr) {
      if (bookingDbErr.code === '23503' || (bookingDbErr.message && bookingDbErr.message.includes('customer_id'))) {
        bookingValues[0] = null;
        const res = await pool.query(bookingQuery, bookingValues);
        rows = res.rows;
      } else {
        throw bookingDbErr;
      }
    }

    // Insert payment transaction if applicable
    if (payment_method && amount_paid) {
      await pool.query(
        "INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date) VALUES ($1, $2, $3, $4, NOW())",
        [rows[0].id, Number.parseFloat(amount_paid), payment_method, admin_id],
      );
    }

    // Commit transaction
    await pool.query("COMMIT");
    res.status(201).json({ message: "Booking created successfully", ...rows[0] });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Error in createBooking:", err.message);
    res.status(500).json({ message: "Failed to create booking", error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    let { order_id } = req.params
    if (order_id.endsWith(".pdf")) order_id = order_id.replace(/\.pdf$/, "")
    if (validateId(order_id)) return res.status(400).json({ message: validateId(order_id) })
    let { rows } = await pool.query(
      "SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id FROM public.dbooking WHERE order_id = $1",
      [order_id],
    )
    if (!rows.length) {
      const possibleOrderId = order_id.split("-").slice(1).join("-")
        ; ({ rows } = await pool.query(
          "SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, order_id FROM public.dbooking WHERE order_id = $1",
          [possibleOrderId],
        ))
    }
    if (!rows.length) return res.status(404).json({ message: `Invoice not found for order_id '${order_id}'` })
    const {
      products,
      total,
      customer_name,
      address,
      mobile_number,
      email,
      district,
      state,
      customer_type,
      pdf,
      order_id: actualOrderId,
    } = rows[0]
    const { buffer } = await generateModernInvoicePDFBuffer(
      { order_id: actualOrderId, customer_type, total },
      { customer_name, address, mobile_number, email, district, state },
      typeof products === "string" ? JSON.parse(products) : products,
    )
    const safeName = (customer_name || 'customer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename=${safeName}-${actualOrderId}.pdf`)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch invoice", error: err.message })
  }
}

exports.getProducts = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, serial_number, productname, price, per, discount, stock, image, status FROM public.gift_box_dealers WHERE status = 'on' AND stock > 0",
    )
    res.json(rows.map((row) => ({ ...row, product_type: "gift_box_dealers" })))
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch products" })
  }
}

exports.bookProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params
    const { quantity } = req.body
    if (tableName !== "gift_box_dealers" || !quantity || quantity <= 0) {
      return res.status(400).json({ message: "Invalid table name or quantity" })
    }
    const { rows } = await pool.query("SELECT stock FROM public.gift_box_dealers WHERE id = $1", [id])
    if (!rows.length || quantity > rows[0].stock) {
      return res.status(404).json({ message: rows.length ? "Insufficient stock" : "Product not found" })
    }
    const newStock = rows[0].stock - quantity
    await pool.query("UPDATE public.gift_box_dealers SET stock = $1 WHERE id = $2", [newStock, id])
    res.json({ message: "Product booked successfully", newStock })
  } catch (err) {
    res.status(500).json({ message: "Failed to book product", error: err.message })
  }
}
function safeParseJSON(data) {
  if (!data) return [];
  if (typeof data === "object") return data; // already an object
  try {
    return JSON.parse(data);
  } catch (err) {
    console.warn("⚠️ Could not parse products JSON:", data);
    return [];
  }
}

exports.deleteBooking = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Valid booking id or order_id is required" });
    }

    await client.query("BEGIN");

    // 1. Get booking
    const bookingRes = await client.query(
      `SELECT id, order_id, products, status FROM public.dbooking WHERE id::text = $1 OR order_id = $1`,
      [id]
    );

    if (bookingRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Booking not found" });
    }

    const booking = bookingRes.rows[0];
    const products = safeParseJSON(booking.products);

    // 2. Try restoring stock if not already cancelled
    if (booking.status !== "cancelled" && booking.status !== "canceled") {
      for (const product of products) {
        const { id: productId, product_type, quantity } = product;
        if (!productId || !quantity) continue;

        const tableName = (product_type || "gift_box_dealers").toLowerCase().replace(/\s+/g, "_");

        try {
          await client.query(
            `UPDATE public.${tableName} SET stock = stock + $1 WHERE id = $2`,
            [Number(quantity), Number(productId)]
          );
        } catch (err) {
          console.warn(`⚠️ Skipping stock restore: table ${tableName} does not exist:`, err.message);
        }
      }
    }

    // 3. Delete booking
    await client.query(`DELETE FROM public.dbooking WHERE id = $1`, [booking.id]);

    await client.query("COMMIT");

    res.status(200).json({ message: "Booking deleted successfully and stock restored" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in deleteBooking:", err);
    res.status(500).json({ message: "Failed to delete booking", error: err.message });
  } finally {
    client.release();
  }
};

exports.cancelBooking = async (req, res) => {
  const client = await pool.connect();
  try {
    const { order_id } = req.params;
    await client.query("BEGIN");

    const { rows } = await client.query(
      "SELECT id, order_id, products, status FROM public.dbooking WHERE order_id = $1 OR id::text = $1",
      [order_id]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Booking not found" });
    }

    const booking = rows[0];
    if (booking.status === "cancelled" || booking.status === "canceled") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Booking is already cancelled" });
    }

    const products = safeParseJSON(booking.products);
    // Restock the quantity as added in bill
    for (const product of products) {
      const { id: productId, product_type, quantity } = product;
      if (!productId || !quantity) continue;
      const tableName = (product_type || "gift_box_dealers").toLowerCase().replace(/\s+/g, "_");
      try {
        await client.query(
          `UPDATE public.${tableName} SET stock = stock + $1 WHERE id = $2`,
          [Number(quantity), Number(productId)]
        );
      } catch (err) {
        console.warn(`Could not restore stock for ${tableName}:`, err.message);
      }
    }

    await client.query(
      "UPDATE public.dbooking SET status = 'cancelled' WHERE id = $1",
      [booking.id]
    );

    // If matching quotation exists, cancel it too
    if (booking.order_id && booking.order_id.includes("ORD")) {
      const quotationEstId = booking.order_id.replace("ORD", "QUO");
      await client.query(
        "UPDATE public.quotations SET status = 'canceled' WHERE est_id = $1",
        [quotationEstId]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Bill / Booking cancelled successfully and stock restored" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in cancelBooking:", err);
    res.status(500).json({ message: "Failed to cancel booking", error: err.message });
  } finally {
    client.release();
  }
};

// helper
function safeParseJSON(data) {
  if (!data) return [];
  if (typeof data === "object") return data;
  try {
    return JSON.parse(data);
  } catch (err) {
    console.warn("⚠️ Could not parse products JSON:", data);
    return [];
  }
}

exports.getBookingsByCustomerName = async (req, res) => {
  try {
    const { customer_name } = req.params;
    if (!customer_name) {
      return res.status(400).json({ message: "Customer name is required" });
    }
    const { rows } = await pool.query(
      `SELECT id, order_id, customer_name, company_name, license_number, address, district, state, mobile_number, email,
              products, status, created_at, pdf, remaining, admin, customer_type, customer_id, balance, amount_paid,
              payment_date, amount_status, payment_method, admin_id, transaction_date, transport_type, transport_name,
              transport_contact, lr_number, extra_charges, total, dispatched_qty, receipt_id
       FROM public.dbooking
       WHERE LOWER(customer_name) = LOWER($1)
       ORDER BY created_at DESC`,
      [customer_name]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error in getBookingsByCustomerName:", err.message);
    res.status(500).json({ message: "Failed to fetch bookings", error: err.message });
  }
};