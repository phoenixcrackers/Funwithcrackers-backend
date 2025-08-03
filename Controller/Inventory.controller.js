const express = require("express")
const { Pool } = require("pg")

const app = express()
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  max: 30,
})

app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

const validBase64Pattern = /^data:(image\/(png|jpeg|jpg|gif)|video\/(mp4|webm|ogg));base64,/

let productTypeCache = {
  data: null,
  timestamp: 0,
}

async function getCachedProductTypes() {
  const now = Date.now()
  if (!productTypeCache.data || now - productTypeCache.timestamp > 300000) {
    const client = await pool.connect()
    try {
      const result = await client.query("SELECT product_type FROM public.products")
      productTypeCache = {
        data: result.rows.map((r) => r.product_type),
        timestamp: now,
      }
    } finally {
      client.release()
    }
  }
  return productTypeCache.data
}

exports.addProduct = async (req, res) => {
  const client = await pool.connect()
  try {
    const { serial_number, productname, price, per, discount, product_type, images, description = "" } = req.body

    if (!serial_number || !productname || !price || !per || !discount || !product_type) {
      return res.status(400).json({ message: "All required fields must be provided" })
    }

    if (!["pieces", "box", "pkt"].includes(per)) {
      return res.status(400).json({ message: "Valid per value (pieces, box, or pkt) is required" })
    }

    if (images && Array.isArray(images)) {
      for (const base64 of images) {
        if (!validBase64Pattern.test(base64)) {
          return res.status(400).json({
            message: "One or more files have invalid Base64 format. Only PNG, JPEG, GIF, MP4, WebM, or Ogg allowed.",
          })
        }
      }
    }

    const tableName = product_type.toLowerCase().replace(/\s+/g, "_")
    const cachedTypes = await getCachedProductTypes()

    if (!cachedTypes.includes(product_type)) {
      await client.query("INSERT INTO public.products (product_type) VALUES ($1)", [product_type])
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.${tableName} (
          id SERIAL PRIMARY KEY,
          serial_number VARCHAR(50) NOT NULL,
          productname VARCHAR(100) NOT NULL,
          price NUMERIC(10,2) NOT NULL,
          per VARCHAR(10) NOT NULL CHECK (per IN ('pieces', 'box', 'pkt')),
          discount NUMERIC(5,2) NOT NULL,
          image TEXT,
          description TEXT,
          status VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (status IN ('on', 'off')),
          fast_running BOOLEAN DEFAULT false
        )
      `)
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_serial_number_${tableName} ON public.${tableName}(serial_number) CONCURRENTLY`,
      )
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_productname_${tableName} ON public.${tableName}(productname) CONCURRENTLY`,
      )
      await client.query(`CREATE INDEX IF NOT EXISTS idx_id_${tableName} ON public.${tableName}(id) CONCURRENTLY`)

      productTypeCache.data = [...(productTypeCache.data || []), product_type]
      productTypeCache.timestamp = Date.now()
    }

    const duplicateCheck = await client.query(
      `SELECT id FROM public.${tableName} WHERE serial_number = $1 OR productname = $2`,
      [serial_number, productname],
    )

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ message: "Product already exists" })
    }

    const insertQuery = `
      INSERT INTO public.${tableName}
      (serial_number, productname, price, per, discount, image, status, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `

    const values = [
      serial_number,
      productname,
      Number.parseFloat(price),
      per,
      Number.parseInt(discount, 10),
      images ? JSON.stringify(images) : null,
      "off",
      description,
    ]

    const result = await client.query(insertQuery, values)
    res.status(201).json({ message: "Product saved successfully", id: result.rows[0].id })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to save product" })
  } finally {
    client.release()
  }
}

exports.updateProduct = async (req, res) => {
  const client = await pool.connect()
  try {
    const { tableName, id } = req.params
    const {
      serial_number,
      productname,
      price,
      per,
      discount,
      status,
      description = "",
      existingImages, // Add this to handle existing images
    } = req.body

    let images = req.body.images

    if (!serial_number || !productname || !price || !per || !discount) {
      return res.status(400).json({ message: "All required fields must be provided" })
    }

    if (!["pieces", "box", "pkt"].includes(per)) {
      return res.status(400).json({ message: "Valid per value (pieces, box, or pkt) is required" })
    }

    // Handle image logic with proper combination of existing and new images
    let finalImages = []

    // First, get existing images that should be preserved
    if (req.body.existingImages) {
      try {
        const existingImages =
          typeof req.body.existingImages === "string" ? JSON.parse(req.body.existingImages) : req.body.existingImages
        finalImages = [...existingImages]
      } catch (e) {
        console.error("Error parsing existing images:", e)
        finalImages = []
      }
    }

    // Then, add new images if any
    if (req.files && req.files.length > 0) {
      // New files uploaded via multer - these come as 'images' field
      const newImages = req.files.map((file) => file.path)
      finalImages = [...finalImages, ...newImages]
    } else if (req.body.images && Array.isArray(req.body.images)) {
      // New images provided as Base64 or URLs
      for (const image of req.body.images) {
        if (typeof image === "string" && !image.startsWith("http") && !validBase64Pattern.test(image)) {
          return res.status(400).json({
            message:
              "One or more image URLs are invalid. Only Cloudinary URLs or valid Base64 formats (PNG, JPEG, GIF, MP4, WebM, Ogg) allowed.",
          })
        }
      }
      finalImages = [...finalImages, ...req.body.images]
    }

    // If no existing images and no new images, preserve current images from database
    if (finalImages.length === 0 && !req.body.existingImages) {
      const currentProduct = await client.query(`SELECT image FROM public.${tableName} WHERE id = $1`, [id])

      if (currentProduct.rows.length > 0 && currentProduct.rows[0].image) {
        try {
          finalImages = JSON.parse(currentProduct.rows[0].image) || []
        } catch (e) {
          finalImages = []
        }
      }
    }

    images = finalImages

    let query = `
      UPDATE public.${tableName}
      SET serial_number = $1, productname = $2, price = $3, per = $4, discount = $5
    `

    const values = [serial_number, productname, Number.parseFloat(price), per, Number.parseFloat(discount)]

    let paramIndex = 6

    // Always update images (either new ones or preserved existing ones)
    query += `, image = $${paramIndex}`
    values.push(images ? JSON.stringify(images) : null)
    paramIndex++

    query += `, description = $${paramIndex}`
    values.push(description)
    paramIndex++

    if (status && ["on", "off"].includes(status)) {
      query += `, status = $${paramIndex}`
      values.push(status)
      paramIndex++
    }

    query += ` WHERE id = $${paramIndex} RETURNING id`
    values.push(id)

    const result = await client.query(query, values)

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    res.status(200).json({ message: "Product updated successfully" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to update product" })
  } finally {
    client.release()
  }
}

exports.getProducts = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query
    const offset = (page - 1) * limit
    const productTypes = await getCachedProductTypes()

    const productQueries = productTypes.map(async (productType) => {
      const tableName = productType.toLowerCase().replace(/\s+/g, "_")
      const client = await pool.connect()
      try {
        const result = await client.query(
          `
          SELECT id, serial_number, productname, price, per, discount, status, fast_running, description, image
          FROM public.${tableName}
          ORDER BY id
          LIMIT $1 OFFSET $2
        `,
          [limit, offset],
        )

        return result.rows.map((row) => ({
          id: row.id,
          product_type: productType,
          serial_number: row.serial_number,
          productname: row.productname,
          price: row.price,
          per: row.per,
          discount: row.discount,
          image: row.image,
          status: row.status,
          fast_running: row.fast_running,
          description: row.description || "",
        }))
      } finally {
        client.release()
      }
    })

    const allProducts = (await Promise.all(productQueries)).flat()
    res.status(200).json({
      data: allProducts,
      page: Number.parseInt(page),
      limit: Number.parseInt(limit),
      total: allProducts.length,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to fetch products" })
  }
}

exports.addProductType = async (req, res) => {
  try {
    const { product_type } = req.body
    if (!product_type) {
      return res.status(400).json({ message: "Product type is required" })
    }

    const formattedProductType = product_type.toLowerCase().replace(/\s+/g, "_")
    const typeCheck = await pool.query("SELECT product_type FROM public.products WHERE product_type = $1", [
      formattedProductType,
    ])

    if (typeCheck.rows.length > 0) {
      return res.status(400).json({ message: "Product type already exists" })
    }

    await pool.query("INSERT INTO public.products (product_type) VALUES ($1)", [formattedProductType])

    const tableName = formattedProductType
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.${tableName} (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(50) NOT NULL,
        productname VARCHAR(100) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        per VARCHAR(10) NOT NULL CHECK (per IN ('pieces', 'box', 'pkt')),
        discount NUMERIC(5,2) NOT NULL,
        image TEXT,
        description TEXT,
        status VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (status IN ('on', 'off')),
        fast_running BOOLEAN DEFAULT false
      )
    `)

    res.status(201).json({ message: "Product type created successfully" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to create product type" })
  }
}

exports.getProductTypes = async (req, res) => {
  try {
    const result = await pool.query("SELECT product_type FROM public.products")
    res.status(200).json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to fetch product types" })
  }
}

exports.deleteProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params
    const query = `DELETE FROM public.${tableName} WHERE id = $1 RETURNING id`
    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    res.status(200).json({ message: "Product deleted successfully" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to delete product" })
  }
}

exports.deleteProductType = async (req, res) => {
  const client = await pool.connect()
  try {
    const { productType } = req.params
    const formattedProductType = productType.toLowerCase().replace(/\s+/g, "_")

    const typeCheck = await client.query("SELECT product_type FROM public.products WHERE product_type = $1", [
      formattedProductType,
    ])

    if (typeCheck.rows.length === 0) {
      return res.status(404).json({ message: "Product type not found" })
    }

    await client.query("BEGIN")

    const tableName = formattedProductType
    await client.query(`DELETE FROM public.${tableName}`)
    await client.query(`DROP TABLE IF EXISTS public.${tableName}`)
    await client.query("DELETE FROM public.products WHERE product_type = $1", [formattedProductType])

    productTypeCache.data = (productTypeCache.data || []).filter((type) => type !== formattedProductType)
    productTypeCache.timestamp = Date.now()

    await client.query("COMMIT")
    res.status(200).json({ message: "Product type deleted successfully" })
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(err)
    res.status(500).json({ message: "Failed to delete product type" })
  } finally {
    client.release()
  }
}

exports.toggleFastRunning = async (req, res) => {
  try {
    const { tableName, id } = req.params
    const result = await pool.query(`SELECT fast_running FROM public.${tableName} WHERE id = $1`, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    const current = result.rows[0].fast_running
    const updated = !current

    await pool.query(`UPDATE public.${tableName} SET fast_running = $1 WHERE id = $2`, [updated, id])

    res.status(200).json({ message: "Fast running status updated", fast_running: updated })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to update fast running status" })
  }
}

exports.toggleProductStatus = async (req, res) => {
  try {
    const { tableName, id } = req.params
    const currentStatusQuery = `SELECT status FROM public.${tableName} WHERE id = $1`
    const currentStatusResult = await pool.query(currentStatusQuery, [id])

    if (currentStatusResult.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    const currentStatus = currentStatusResult.rows[0].status
    const newStatus = currentStatus === "on" ? "off" : "on"

    const updateQuery = `UPDATE public.${tableName} SET status = $1 WHERE id = $2 RETURNING id, status`
    const updateResult = await pool.query(updateQuery, [newStatus, id])

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" })
    }

    res.status(200).json({ message: "Status toggled successfully", status: newStatus })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: "Failed to toggle status" })
  }
}
