const express = require('express');
const router = express.Router();
const directCustController = require('../Controller/HifiDirectcust.controller');

router.post('/customers', directCustController.addCustomer);
router.get('/customers', directCustController.getAllCustomers);
router.get('/agents', directCustController.getAgents);

module.exports = router;
