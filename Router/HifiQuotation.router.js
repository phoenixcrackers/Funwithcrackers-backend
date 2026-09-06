const express = require('express');
const router = express.Router();
const quotationController = require('../Controller/HifiQuotation.controller');

router.post('/quotations', quotationController.createQuotation);
router.get('/quotations', quotationController.getQuotations);
router.get('/quotations/:est_id', quotationController.getQuotation);
router.post('/quotations/book', quotationController.bookQuotation);
router.patch('/quotations/:est_id/cancel', quotationController.cancelQuotation);
router.patch('/quotations/:est_id/edit', quotationController.editQuotation);
router.delete("/quotations/:est_id", quotationController.deleteQuotation);

module.exports = router;
