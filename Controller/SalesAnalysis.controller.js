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
    // Fetch latest record
    const latest = await pool.query('SELECT * FROM public.sales_analysis ORDER BY created_at DESC LIMIT 1');
    const latestData = latest.rows[0] || {};

    // Fetch top 10 highest and lowest products
    const products = await pool.query(`
      SELECT jsonb_array_elements(products::jsonb)->>'productname' AS productname, COUNT(*) AS count
      FROM public.bookings
      GROUP BY jsonb_array_elements(products::jsonb)->>'productname'
      UNION ALL
      SELECT jsonb_array_elements(products::jsonb)->>'productname' AS productname, COUNT(*) AS count
      FROM public.fwcquotations
      GROUP BY jsonb_array_elements(products::jsonb)->>'productname'
    `);
    const productCounts = products.rows.reduce((acc, row) => {
      acc[row.productname] = (acc[row.productname] || 0) + row.count;
      return acc;
    }, {});
    const top_10_highest_products = Object.entries(productCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([productname, count]) => ({ productname, count }));
    const top_10_lowest_products = Object.entries(productCounts)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 10)
      .map(([productname, count]) => ({ productname, count }));

    // Fetch top 10 highest and lowest cities
    const cities = await pool.query(`
      SELECT district, COUNT(*) AS count
      FROM public.bookings
      GROUP BY district
      UNION ALL
      SELECT district, COUNT(*) AS count
      FROM public.fwcquotations
      GROUP BY district
    `);
    const cityCounts = cities.rows.reduce((acc, row) => {
      acc[row.district] = (acc[row.district] || 0) + row.count;
      return acc;
    }, {});
    const top_10_highest_cities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([district, count]) => ({ district, count }));
    const top_10_lowest_cities = Object.entries(cityCounts)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 10)
      .map(([district, count]) => ({ district, count }));

    // Fetch historical highest totals
    const historical = await pool.query('SELECT analysis_date, highest_total FROM public.sales_analysis ORDER BY analysis_date DESC LIMIT 10');

    res.status(200).json({
      ...latestData,
      top_10_highest_products,
      top_10_lowest_products,
      top_10_highest_cities,
      top_10_lowest_cities,
      historical_totals: historical.rows
    });
  } catch (err) {
    console.error('Failed to fetch sales analysis:', err.message);
    res.status(500).json({ message: 'Failed to fetch sales analysis', error: err.message });
  }
};