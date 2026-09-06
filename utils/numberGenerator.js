/**
 * Number Generator Utility
 * Generates year-based sequential numbers:
 * - Quotations: ${year}QUO${number}  (e.g., 2026QUO1, 2026QUO2)
 * - Orders/Bills: ${year}ORD${number} (e.g., 2026ORD1, 2026ORD2)
 * - Guarantees that when quotation 2026QUO1 is booked, its order is 2026ORD1!
 */

/**
 * Get highest sequence number used in the current year across both quotations and dbooking tables
 * @param {import('pg').Pool} pool
 * @param {number} year
 * @returns {Promise<number>}
 */
async function getNextSequenceNumber(pool, year = new Date().getFullYear()) {
  try {
    const quoResult = await pool.query(
      `SELECT est_id FROM public.quotations WHERE est_id LIKE $1`,
      [`${year}QUO%`]
    );

    const ordResult = await pool.query(
      `SELECT order_id FROM public.dbooking WHERE order_id LIKE $1`,
      [`${year}ORD%`]
    );

    let maxNum = 0;

    quoResult.rows.forEach((row) => {
      if (row.est_id) {
        const match = row.est_id.match(new RegExp(`^${year}QUO(\\d+)`, 'i'));
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
    });

    ordResult.rows.forEach((row) => {
      if (row.order_id) {
        const match = row.order_id.match(new RegExp(`^${year}ORD(\\d+)`, 'i'));
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
    });

    return maxNum + 1;
  } catch (err) {
    console.error('Error calculating next sequence number:', err.message);
    return Date.now() % 100000;
  }
}

/**
 * Generate next quotation ID: e.g. 2026QUO1
 */
async function generateQuotationId(pool, year = new Date().getFullYear()) {
  const nextSeq = await getNextSequenceNumber(pool, year);
  return `${year}QUO${nextSeq}`;
}

/**
 * Generate next order ID: e.g. 2026ORD1
 */
async function generateOrderId(pool, year = new Date().getFullYear()) {
  const nextSeq = await getNextSequenceNumber(pool, year);
  return `${year}ORD${nextSeq}`;
}

/**
 * Convert quotation ID to order ID, preserving the exact same sequence number:
 * e.g. 2026QUO1 -> 2026ORD1
 * e.g. 2026QUO42 -> 2026ORD42
 * Also handles legacy EST- -> DORD-
 */
function quotationIdToOrderId(est_id) {
  if (!est_id) return `ORD-${Date.now()}`;
  if (est_id.includes('QUO')) {
    return est_id.replace(/QUO/i, 'ORD');
  }
  return est_id.replace(/^EST-?/i, 'DORD-');
}

/**
 * Extract sequence number from ID
 */
function extractSequenceNumber(id) {
  if (!id) return null;
  const match = id.match(/(?:QUO|ORD)(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

module.exports = {
  getNextSequenceNumber,
  generateQuotationId,
  generateOrderId,
  quotationIdToOrderId,
  extractSequenceNumber,
};
