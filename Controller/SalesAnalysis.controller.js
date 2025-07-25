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
    // Fetch latest sales analysis record
    const latest = await pool.query('SELECT * FROM public.sales_analysis ORDER BY created_at DESC LIMIT 1');
    const latestData = latest.rows[0] || {};

    // Fetch all products from bookings and quotations
    const products = await pool.query(`
      SELECT 
        jsonb_array_elements(products::jsonb)->>'productname' AS productname,
        (jsonb_array_elements(products::jsonb)->>'quantity')::integer AS quantity,
        (jsonb_array_elements(products::jsonb)->>'price')::numeric AS price,
        (jsonb_array_elements(products::jsonb)->>'discount')::numeric AS discount
      FROM public.bookings
      WHERE status = 'booked'
      UNION ALL
      SELECT 
        jsonb_array_elements(products::jsonb)->>'productname' AS productname,
        (jsonb_array_elements(products::jsonb)->>'quantity')::integer AS quantity,
        (jsonb_array_elements(products::jsonb)->>'price')::numeric AS price,
        (jsonb_array_elements(products::jsonb)->>'discount')::numeric AS discount
      FROM public.fwcquotations
      WHERE status = 'booked'
    `);
    const productSummary = products.rows.reduce((acc, row) => {
      const { productname, quantity, price, discount } = row;
      if (!acc[productname]) {
        acc[productname] = { quantity: 0, revenue: 0, discount: 0 };
      }
      const unitPrice = parseFloat(price) || 0;
      const unitDiscount = parseFloat(discount) || 0;
      const unitQuantity = parseInt(quantity) || 1;
      acc[productname].quantity += unitQuantity;
      acc[productname].revenue += unitQuantity * (unitPrice - (unitPrice * unitDiscount / 100));
      acc[productname].discount += unitQuantity * (unitPrice * unitDiscount / 100);
      return acc;
    }, {});
    const productData = Object.entries(productSummary).map(([productname, data]) => ({
      productname,
      quantity: data.quantity,
      revenue: data.revenue,
      avg_discount: data.quantity > 0 ? (data.discount / (data.quantity * data.revenue / (data.quantity - data.discount))) * 100 : 0
    }));

    // Fetch all cities from bookings and quotations
    const cities = await pool.query(`
      SELECT district, COUNT(*) AS count, SUM(total::numeric) AS revenue
      FROM public.bookings
      WHERE status = 'booked'
      GROUP BY district
      UNION ALL
      SELECT district, COUNT(*) AS count, SUM(total::numeric) AS revenue
      FROM public.fwcquotations
      WHERE status = 'booked'
      GROUP BY district
    `);
    const citySummary = cities.rows.reduce((acc, row) => {
      if (!acc[row.district]) {
        acc[row.district] = { count: 0, revenue: 0 };
      }
      acc[row.district].count += parseInt(row.count);
      acc[row.district].revenue += parseFloat(row.revenue) || 0;
      return acc;
    }, {});
    const cityData = Object.entries(citySummary).map(([district, data]) => ({
      district,
      count: data.count,
      revenue: data.revenue
    }));

    // Fetch historical sales data for trends
    const historical = await pool.query(`
      SELECT 
        created_at,
        highest_total
      FROM public.sales_analysis 
      ORDER BY created_at ASC
    `);
    const monthlyTrends = historical.rows.reduce((acc, row) => {
      const date = new Date(row.created_at);
      const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[monthYear]) {
        acc[monthYear] = { volume: 0, revenue: 0 };
      }
      acc[monthYear].volume += 1;
      acc[monthYear].revenue += parseFloat(row.highest_total) || 0;
      return acc;
    }, {});
    const trendData = Object.entries(monthlyTrends).map(([month, data]) => ({
      month,
      volume: data.volume,
      revenue: data.revenue
    })).sort((a, b) => a.month.localeCompare(b.month));

    // Fetch profitability metrics (excluding processing_fee)
    const profitability = await pool.query(`
      SELECT 
        SUM(total::numeric) AS total_revenue,
        SUM(you_save::numeric) AS total_discounts
      FROM public.bookings
      WHERE status = 'booked'
    `);
    const profitData = profitability.rows[0] || { total_revenue: 0, total_discounts: 0 };

    // Fetch quotation conversion rates
    const quotations = await pool.query(`
      SELECT status, COUNT(*) AS count, SUM(total::numeric) AS revenue
      FROM public.fwcquotations
      GROUP BY status
    `);
    const quotationSummary = quotations.rows.reduce((acc, row) => {
      acc[row.status] = { count: parseInt(row.count), revenue: parseFloat(row.revenue) || 0 };
      return acc;
    }, { pending: { count: 0, revenue: 0 }, booked: { count: 0, revenue: 0 }, canceled: { count: 0, revenue: 0 } });

    // Fetch customer type analysis
    const customerTypes = await pool.query(`
      SELECT 
        customer_type, 
        COUNT(*) AS count, 
        SUM(total::numeric) AS revenue
      FROM public.bookings
      WHERE status = 'booked'
      GROUP BY customer_type
    `);
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
        total::numeric AS total, 
        created_at
      FROM public.bookings
      WHERE status = 'canceled'
      UNION ALL
      SELECT 
        'quotation' AS type, 
        quotation_id AS order_id, 
        total::numeric AS total, 
        created_at
      FROM public.fwcquotations
      WHERE status = 'canceled'
    `);
    const cancellationData = cancellations.rows.map(row => ({
      type: row.type,
      order_id: row.order_id,
      total: parseFloat(row.total) || 0,
      created_at: row.created_at
    }));

    res.status(200).json({
      ...latestData,
      products: productData,
      cities: cityData,
      trends: trendData,
      profitability: {
        total_revenue: parseFloat(profitData.total_revenue) || 0,
        total_discounts: parseFloat(profitData.total_discounts) || 0,
        estimated_profit: (parseFloat(profitData.total_revenue) || 0) - (parseFloat(profitData.total_discounts) || 0)
      },
      quotations: quotationSummary,
      customer_types: customerTypeData,
      cancellations: cancellationData
    });
  } catch (err) {
    console.error('Failed to fetch sales analysis:', err.message);
    res.status(500).json({ message: 'Failed to fetch sales analysis', error: err.message });
  }
};