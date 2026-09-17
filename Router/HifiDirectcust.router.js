const express = require('express');
const router = express.Router();
const directCustController = require('../Controller/HifiDirectcust.controller');

router.post('/customers', directCustController.addCustomer);
router.get('/customers', directCustController.getAllCustomers);
router.get('/customers/:id', directCustController.getCustomerById);
router.put('/customers/:id/name', directCustController.updateCustomerName);
router.patch('/customers/:id/name', directCustController.updateCustomerName);
router.put('/customers/:id', directCustController.updateCustomer);
router.delete('/customers/:id', directCustController.deleteCustomer);
router.get('/customers/:id/bookings', directCustController.getCustomerBookings);
router.post('/customers/:id/bills/:order_id/regenerate', directCustController.regenerateCustomerBill);
router.get('/agents', directCustController.getAgents);

module.exports = router;
