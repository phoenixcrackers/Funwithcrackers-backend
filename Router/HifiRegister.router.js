const express = require('express');
const router = express.Router();
const authController = require('../Controller/HifiRegister.controller');

router.post('/register', authController.registerUser);
router.post('/loginus', authController.loginUser);
router.get('/users', authController.getAllUsers);
router.get('/user/:username', authController.getUserDetails);
router.put('/user/:username', authController.updateUserDetails);

module.exports = router;
