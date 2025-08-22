const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

exports.getSalesAnalysis = async (req, res) => {
  try {
    // Validate JSONB structure before querying
    const validateProducts = await pool.query(`
      SELECT COUNT(*) AS invalid_count
      FROM public.bookings
      WHERE status = 'booked' AND (products::jsonb IS NULL OR jsonb_typeof(products::jsonb) != 'array')
      UNION ALL
      SELECT COUNT(*) AS invalid_count
      FROM public.fwcquotations
      WHERE status = 'booked' AND (products::jsonb IS NULL OR jsonb_typeof(products::jsonb) != 'array')
    `);
    if (validateProducts.rows.some(row => row.invalid_count > 0)) {
      console.warn('Invalid products JSONB found:', validateProducts.rows);
    }

    // Fetch products using LATERAL join to handle JSONB expansion
    const products = await pool.query(`
      SELECT 
        p.product->>'productname' AS productname,
        COALESCE((p.product->>'quantity')::integer, 0) AS quantity,
        COALESCE((p.product->>'price')::numeric, 0) AS price,
        COALESCE((p.product->>'discount')::numeric, 0) AS discount
      FROM public.bookings b
      CROSS JOIN LATERAL jsonb_array_elements(b.products::jsonb) AS p(product)
      WHERE LOWER(b.status) = 'booked'
      UNION ALL
      SELECT 
        p.product->>'productname' AS productname,
        COALESCE((p.product->>'quantity')::integer, 0) AS quantity,
        COALESCE((p.product->>'price')::numeric, 0) AS price,
        COALESCE((p.product->>'discount')::numeric, 0) AS discount
      FROM public.fwcquotations q
      CROSS JOIN LATERAL jsonb_array_elements(q.products::jsonb) AS p(product)
      WHERE LOWER(q.status) = 'booked'
    `);
    console.log('Products rows:', products.rows.length);

    const productSummary = products.rows.reduce((acc, row) => {
      const { productname, quantity, price, discount } = row;
      if (!productname) {
        console.log('Skipping row with missing productname:', row);
        return acc; // Skip invalid products
      }
      if (!acc[productname]) {
        acc[productname] = { quantity: 0, revenue: 0, discount: 0 };
      }
      const unitPrice = parseFloat(price) || 0;
      const unitDiscount = parseFloat(discount) || 0;
      const unitQuantity = parseInt(quantity) || 0;
      acc[productname].quantity += unitQuantity;
      acc[productname].revenue += unitQuantity * (unitPrice - (unitPrice * unitDiscount / 100));
      acc[productname].discount += unitQuantity * (unitPrice * unitDiscount / 100);
      return acc;
    }, {});

    const productData = Object.entries(productSummary).map(([productname, data]) => ({
      productname,
      quantity: data.quantity,
      revenue: data.revenue,
      avg_discount: data.quantity > 0 ? (data.discount / (data.quantity * (data.revenue + data.discount) / data.quantity)) * 100 : 0
    }));

    // Fetch regional demand (cities)
    const cities = await pool.query(`
      SELECT district, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS revenue
      FROM public.bookings
      WHERE LOWER(status) = 'booked'
      GROUP BY district
      UNION ALL
      SELECT district, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS revenue
      FROM public.fwcquotations
      WHERE LOWER(status) = 'booked'
      GROUP BY district
    `);
    console.log('Cities rows:', cities.rows.length);

    const citySummary = cities.rows.reduce((acc, row) => {
      const district = row.district || 'Unknown';
      if (!acc[district]) {
        acc[district] = { count: 0, revenue: 0 };
      }
      acc[district].count += parseInt(row.count) || 0;
      acc[district].revenue += parseFloat(row.revenue) || 0;
      return acc;
    }, {});

    const cityData = Object.entries(citySummary).map(([district, data]) => ({
      district,
      count: data.count,
      revenue: data.revenue
    }));

    // Fetch historical trends
    // Fetch historical trends from bookings and quotations
const historical = await pool.query(`
  SELECT 
    created_at,
    COALESCE(net_rate::numeric, 0) - COALESCE(you_save::numeric, 0) AS net_revenue
  FROM public.bookings
  WHERE LOWER(status) = 'booked'
  UNION ALL
  SELECT 
    created_at,
    COALESCE(net_rate::numeric, 0) - COALESCE(you_save::numeric, 0) AS net_revenue
  FROM public.fwcquotations
  WHERE LOWER(status) = 'booked'
`);
console.log('Historical rows:', historical.rows.length);

const monthlyTrends = historical.rows.reduce((acc, row) => {
  if (!row.created_at) {
    console.warn('Skipping row with invalid created_at:', row);
    return acc;
  }
  const date = new Date(row.created_at);
  const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  if (!acc[monthYear]) {
    acc[monthYear] = { volume: 0, revenue: 0 };
  }
  acc[monthYear].volume += 1;
  acc[monthYear].revenue += parseFloat(row.net_revenue) || 0;
  return acc;
}, {});

const trendData = Object.entries(monthlyTrends).map(([month, data]) => ({
  month,
  volume: data.volume,
  revenue: data.revenue
})).sort((a, b) => a.month.localeCompare(b.month));

    // Fetch profitability metrics (include fwcquotations)
    const profitability = await pool.query(`
      SELECT 
        SUM(COALESCE(net_rate::numeric, 0)) AS total_revenue,
        SUM(COALESCE(you_save::numeric, 0)) AS total_discounts
      FROM public.bookings
      WHERE LOWER(status) = 'booked'
      UNION ALL
      SELECT 
        SUM(COALESCE(net_rate::numeric, 0)) AS total_revenue,
        SUM(COALESCE(you_save::numeric, 0)) AS total_discounts
      FROM public.fwcquotations
      WHERE LOWER(status) = 'booked'
    `);
    console.log('Profitability rows:', profitability.rows.length);

    const profitData = profitability.rows.reduce((acc, row) => {
      acc.total_revenue += parseFloat(row.total_revenue) || 0;
      acc.total_discounts += parseFloat(row.total_discounts) || 0;
      return acc;
    }, { total_revenue: 0, total_discounts: 0 });

    // Fetch quotation conversion rates
    const quotations = await pool.query(`
      SELECT LOWER(status) AS status, COUNT(*) AS count, SUM(COALESCE(total::numeric, 0)) AS revenue
      FROM public.fwcquotations
      GROUP BY LOWER(status)
    `);
    console.log('Quotations rows:', quotations.rows.length);

    const quotationSummary = quotations.rows.reduce((acc, row) => {
      acc[row.status] = { count: parseInt(row.count), revenue: parseFloat(row.revenue) || 0 };
      return acc;
    }, { pending: { count: 0, revenue: 0 }, booked: { count: 0, revenue: 0 }, canceled: { count: 0, revenue: 0 } });

    // Fetch customer type analysis
    const customerTypes = await pool.query(`
      SELECT 
        customer_type, 
        COUNT(*) AS count, 
        SUM(COALESCE(total::numeric, 0)) AS revenue
      FROM public.bookings
      WHERE LOWER(status) = 'booked'
      GROUP BY customer_type
    `);
    console.log('Customer types rows:', customerTypes.rows.length);

    const customerTypeData = customerTypes.rows.map(row => ({
      customer_type: row.customer_type || 'Unknown',
      count: parseInt(row.count),
      revenue: parseFloat(row.revenue) || 0
    }));

    // Fetch cancellations
    const cancellations = await pool.query(`
      SELECT 
        'booking' AS type, 
        order_id, 
        COALESCE(total::numeric, 0) AS total, 
        created_at
      FROM public.bookings
      WHERE LOWER(status) = 'canceled'
      UNION ALL
      SELECT 
        'quotation' AS type, 
        quotation_id AS order_id, 
        COALESCE(total::numeric, 0) AS total, 
        created_at
      FROM public.fwcquotations
      WHERE LOWER(status) = 'canceled'
    `);
    console.log('Cancellations rows:', cancellations.rows.length);

    const cancellationData = cancellations.rows.map(row => ({
      type: row.type,
      order_id: row.order_id,
      total: parseFloat(row.total) || 0,
      created_at: row.created_at
    }));

    res.status(200).json({
      products: productData,
      cities: cityData,
      trends: trendData,
      profitability: {
        total_revenue: profitData.total_revenue,
        total_discounts: profitData.total_discounts,
        estimated_profit: profitData.total_revenue - profitData.total_discounts
      },
      quotations: quotationSummary,
      customer_types: customerTypeData,
      cancellations: cancellationData
    });
  } catch (err) {
    console.error('Failed to fetch sales analysis:', {
      message: err.message,
      stack: err.stack,
      query: err.query || 'N/A'
    });
    res.status(500).json({ message: 'Failed to fetch sales analysis', error: err.message });
  }
};