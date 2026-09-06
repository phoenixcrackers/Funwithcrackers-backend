const express = require('express');
const router = express.Router();
const directController = require('../Controller/HifiDirect.controller');

router.get('/customers', directController.getCustomers);
router.get('/products/types', directController.getProductTypes);
router.get('/products', directController.getProductsByType);
router.post('/bookings', directController.createBooking);
router.get('/invoice/:order_id', directController.getInvoice);

module.exports = router;
