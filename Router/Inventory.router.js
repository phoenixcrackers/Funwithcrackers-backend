const express = require('express');
const router = express.Router();
const { addProduct, getProducts, addProductType, getProductTypes, updateProduct, deleteProduct, toggleProductStatus,toggleFastRunning } = require('../Controller/Inventory.controller');
const multer = require('multer');

const upload = multer({
  dest: './Uploads/',
});

router.post('/products', upload.single('image'), addProduct);
router.get('/products', getProducts);
router.post('/product-types', addProductType);
router.get('/product-types', getProductTypes);
router.put('/products/:tableName/:id', upload.single('image'), updateProduct);
router.delete('/products/:tableName/:id', deleteProduct);
router.patch('/products/:tableName/:id/toggle-status', toggleProductStatus);
router.patch('/products/:tableName/:id/toggle-fast-running', toggleFastRunning);

module.exports = router;