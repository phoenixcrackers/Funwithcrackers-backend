const express = require('express');
const router = express.Router();
const authController = require('../Controller/HifiAdmin.controller');

router.post('/loginad', authController.loginUser);

module.exports = router;
