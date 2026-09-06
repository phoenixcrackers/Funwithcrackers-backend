const express = require('express');
const router = express.Router();
const {
  addGiftBoxProduct,
  getGiftBoxProducts,
  updateGiftBoxProduct,
  deleteGiftBoxProduct,
  toggleGiftBoxProductStatus,
  toggleGiftBoxFastRunning,
  bookProduct,
  addStock,
  getStockHistory
} = require('../Controller/HifiInventory.controller');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure CloudinaryStorage for Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'hifi_products',
    allowed_formats: ['jpg', 'png'],
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, JPG, and PNG images are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 1000000, files: 5 }, // 1MB limit, max 5 files
});

router.post('/gift-box-products', upload.array('images'), addGiftBoxProduct);
router.get('/gift-box-products', getGiftBoxProducts);
router.put('/gift-box-products/:id', upload.array('images'), updateGiftBoxProduct);
router.delete('/gift-box-products/:id', deleteGiftBoxProduct);
router.patch('/gift-box-products/:id/toggle-status', toggleGiftBoxProductStatus);
router.patch('/gift-box-products/:id/toggle-fast-running', toggleGiftBoxFastRunning);
router.post('/gift-box-products/:id/book', bookProduct);
router.post('/gift-box-products/:id/add-stock', addStock);
router.get('/gift-box-products/:id/stock-history', getStockHistory);

module.exports = router;
