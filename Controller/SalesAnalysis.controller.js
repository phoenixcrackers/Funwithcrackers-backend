const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function getProductTypeCatalog() {
  const typesResult = await pool.query('SELECT product_type FROM public.products');
  const types = typesResult.rows.map((r) => r.product_type);

  const catalog = {};
  await Promise.all(
    types.map(async (type) => {
      const tableName = type.toLowerCase().replace(/\s+/g, '_');
      try {
        const result = await pool.query(
          `SELECT productname, COALESCE(price, 0) AS price, COALESCE(dprice, 0) AS dprice FROM public.${tableName}`
        );
        result.rows.forEach((row) => {
          const key = (row.productname || '').trim().toLowerCase();
          if (!key) return;
          catalog[key] = {
            product_type: type,
            price: parseFloat(row.price) || 0,
            dprice: parseFloat(row.dprice) || 0,
          };
        });
      } catch (e) {
        console.warn(`Could not read catalog table for type "${type}":`, e.message);
      }
    })
  );
  return catalog;
}

exports.getSalesAnalysis = async (req, res) => {
  try {
    const catalog = await getProductTypeCatalog();

    const validateProducts = await pool.query(`
      SELECT COUNT(*) AS invalid_count
      FROM public.bookings
      WHERE status IN ('booked', 'paid', 'dispatched', 'packed', 'delivered') AND (products::jsonb IS NULL OR jsonb_typeof(products::jsonb) != 'array')
      UNION ALL
      SELECT COUNT(*) AS invalid_count
      FROM public.fwcquotations
      WHERE status IN ('booked', 'pending') AND (products::jsonb IS NULL OR jsonb_typeof(products::jsonb) != 'array')
    `);
    if (validateProducts.rows.some(row => row.invalid_count > 0)) {
      console.warn('Invalid products JSONB found:', validateProducts.rows);
    }

    const products = await pool.query(`
      SELECT 
        p.product->>'productname' AS productname,
        COALESCE((p.product->>'quantity')::integer, 0) AS quantity
      FROM public.bookings b
      CROSS JOIN LATERAL jsonb_array_elements(b.products::jsonb) AS p(product)
      WHERE LOWER(b.status) IN ('booked', 'paid', 'dispatched', 'packed', 'delivered')
    `);

    const productSummary = products.rows.reduce((acc, row) => {
      const { productname, quantity } = row;
      if (!productname) return acc;
      const catalogEntry = catalog[productname.trim().toLowerCase()];
      const product_type = catalogEntry?.product_type || 'Uncategorized';
      const unitPrice = catalogEntry?.price || 0;
      const key = `${productname}__${product_type}`;
      if (!acc[key]) acc[key] = { productname, product_type, quantity: 0, est_revenue: 0 };
      const qty = parseInt(quantity) || 0;
      acc[key].quantity += qty;
      acc[key].est_revenue += qty * unitPrice;
      return acc;
    }, {});

    const productData = Object.values(productSummary)
      .map((p) => ({ ...p, est_revenue: round2(p.est_revenue) }))
      .sort((a, b) => b.quantity - a.quantity);

    const productTypeSummary = productData.reduce((acc, row) => {
      const type = row.product_type;
      if (!acc[type]) acc[type] = { product_type: type, quantity: 0, est_revenue: 0 };
      acc[type].quantity += row.quantity;
      acc[type].est_revenue += row.est_revenue;
      return acc;
    }, {});
    const productTypeTotalRevenue = Object.values(productTypeSummary).reduce((s, t) => s + t.est_revenue, 0);
    const productTypeData = Object.values(productTypeSummary)
      .map((t) => ({
        ...t,
        est_revenue: round2(t.est_revenue),
        share: productTypeTotalRevenue > 0 ? round2((t.est_revenue / productTypeTotalRevenue) * 100) : 0,
      }))
      .sort((a, b) => b.est_revenue - a.est_revenue);

    const cities = await pool.query(`
      SELECT district, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS total_amount
      FROM public.bookings
      WHERE LOWER(status) IN ('booked', 'paid', 'dispatched', 'packed', 'delivered')
      GROUP BY district
      UNION ALL
      SELECT district, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS total_amount
      FROM public.fwcquotations
      WHERE LOWER(status) IN ('booked', 'pending')
      GROUP BY district
    `);

    const citySummary = cities.rows.reduce((acc, row) => {
      const district = row.district || 'Unknown';
      if (!acc[district]) acc[district] = { count: 0, total_amount: 0 };
      acc[district].count += parseInt(row.count) || 0;
      acc[district].total_amount += parseFloat(row.total_amount) || 0;
      return acc;
    }, {});

    const cityData = Object.entries(citySummary)
      .map(([district, data]) => ({ district, count: data.count, total_amount: data.total_amount }))
      .sort((a, b) => b.total_amount - a.total_amount);

    const historical = await pool.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) AS volume,
        SUM(COALESCE(total::numeric, 0)) AS total_amount,
        SUM(COALESCE(amount_paid::numeric, 0)) AS amount_paid
      FROM public.bookings
      WHERE LOWER(status) IN ('booked', 'paid', 'dispatched', 'packed', 'delivered')
      GROUP BY TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM')
      ORDER BY month
    `);

    const trendDataArray = historical.rows
      .map(row => ({
        month: row.month,
        volume: parseInt(row.volume) || 0,
        total_amount: parseFloat(row.total_amount) || 0,
        amount_paid: parseFloat(row.amount_paid) || 0,
        unpaid_amount: (parseFloat(row.total_amount) || 0) - (parseFloat(row.amount_paid) || 0),
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row, i, arr) => {
        const prev = arr[i - 1];
        const growth = prev && prev.total_amount > 0
          ? round2(((row.total_amount - prev.total_amount) / prev.total_amount) * 100)
          : null;
        return {
          ...row,
          avg_order_value: row.volume > 0 ? round2(row.total_amount / row.volume) : 0,
          mom_growth: growth,
        };
      });

    const profitability = await pool.query(`
      SELECT 
        SUM(COALESCE(total::numeric, 0)) AS total_amount,
        SUM(COALESCE(amount_paid::numeric, 0)) AS amount_paid,
        COUNT(*) AS volume
      FROM public.bookings
      WHERE LOWER(status) IN ('booked', 'paid', 'dispatched', 'packed', 'delivered')
    `);

    const profitRow = profitability.rows[0] || { total_amount: 0, amount_paid: 0, volume: 0 };
    const totalAmount = parseFloat(profitRow.total_amount) || 0;
    const amountPaid = parseFloat(profitRow.amount_paid) || 0;
    const bookingVolume = parseInt(profitRow.volume) || 0;

    const profitData = {
      total_amount: totalAmount,
      amount_paid: amountPaid,
      unpaid_amount: totalAmount - amountPaid,
      collection_rate: totalAmount > 0 ? round2((amountPaid / totalAmount) * 100) : 0,
      avg_order_value: bookingVolume > 0 ? round2(totalAmount / bookingVolume) : 0,
    };

    const quotations = await pool.query(`
      SELECT LOWER(status) AS status, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS total_amount
      FROM public.fwcquotations
      WHERE LOWER(status) IN ('pending', 'booked')
      GROUP BY LOWER(status)
    `);

    const quotationSummary = quotations.rows.reduce((acc, row) => {
      acc[row.status] = { count: parseInt(row.count), total_amount: parseFloat(row.total_amount) || 0 };
      return acc;
    }, { pending: { count: 0, total_amount: 0 }, booked: { count: 0, total_amount: 0 } });

    const totalQuotations = quotationSummary.pending.count + quotationSummary.booked.count;
    const conversionRate = totalQuotations > 0 ? round2((quotationSummary.booked.count / totalQuotations) * 100) : 0;

    const customerTypes = await pool.query(`
      SELECT customer_type, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS total_amount
      FROM public.bookings
      WHERE LOWER(status) IN ('booked', 'paid', 'dispatched', 'packed', 'delivered') AND customer_type IS NOT NULL
      GROUP BY customer_type
    `);

    const customerTypeRevenue = customerTypes.rows.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
    const customerTypeData = customerTypes.rows
      .map(row => ({
        customer_type: row.customer_type || 'Unknown',
        count: parseInt(row.count),
        total_amount: parseFloat(row.total_amount) || 0,
        share: customerTypeRevenue > 0 ? round2(((parseFloat(row.total_amount) || 0) / customerTypeRevenue) * 100) : 0,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);

    const cancellations = await pool.query(`
      SELECT 'booking' AS type, order_id, COALESCE(total::numeric, 0) AS total, created_at
      FROM public.bookings
      WHERE LOWER(status) = 'canceled'
      UNION ALL
      SELECT 'quotation' AS type, quotation_id AS order_id, COALESCE(total::numeric, 0) AS total, created_at
      FROM public.fwcquotations
      WHERE LOWER(status) = 'canceled'
    `);

    const cancellationData = cancellations.rows
      .map(row => ({ type: row.type, order_id: row.order_id, total: parseFloat(row.total) || 0, created_at: row.created_at }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const cancelledAmount = cancellationData.reduce((s, c) => s + c.total, 0);
    const latestMonth = trendDataArray[trendDataArray.length - 1];
    const topProduct = productData[0] || null;
    const topDistrict = cityData[0] || null;
    const topProductType = productTypeData[0] || null;

    res.status(200).json({
      products: productData,
      product_types: productTypeData,
      cities: cityData,
      trends: trendDataArray,
      profitability: profitData,
      quotations: quotationSummary,
      customer_types: customerTypeData,
      cancellations: cancellationData,
      summary: {
        total_revenue: totalAmount,
        total_paid: amountPaid,
        total_unpaid: totalAmount - amountPaid,
        collection_rate: profitData.collection_rate,
        booking_volume: bookingVolume,
        avg_order_value: profitData.avg_order_value,
        conversion_rate: conversionRate,
        cancelled_orders: cancellationData.length,
        cancelled_amount: cancelledAmount,
        mom_growth: latestMonth ? latestMonth.mom_growth : null,
        top_product: topProduct ? topProduct.productname : null,
        top_district: topDistrict ? topDistrict.district : null,
        top_product_type: topProductType ? topProductType.product_type : null,
      },
    });
  } catch (err) {
    console.error('Failed to fetch sales analysis:', {
      message: err.message,
      stack: err.stack,
      query: err.query || 'N/A',
    });
    res.status(500).json({ message: 'Failed to fetch sales analysis', error: err.message });
  }
};