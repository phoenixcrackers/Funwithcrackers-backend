const express = require("express")
const router = express.Router()
const DBookingController = require("../Controller/HifiDbooking.controller")

router.get("/admins", DBookingController.getAdmins)
router.get("/admins/:adminId/transactions", DBookingController.getAdminTransactions);
router.get("/admins/:username/bank-accounts", DBookingController.getBankAccounts);
router.post("/admins/bank-accounts", DBookingController.addBankAccount)
router.get("/tracking/bookings", DBookingController.getBookings)
router.patch("/tracking/bookings/:id/status", DBookingController.updateBookingStatus)
router.post("/dbooking", DBookingController.createBooking)
router.get("/dbooking/invoice/:order_id", DBookingController.getInvoice)
router.get("/dbooking/receipt/:receipt_id", DBookingController.getReceipt)
router.get("/product", DBookingController.getProducts)
router.patch("/product/:tableName/:id/book", DBookingController.bookProduct)
router.get("/transactions/:bookingId", DBookingController.getTransactions)
router.patch("/tracking/bookings/order/:order_id/status", DBookingController.updateBookingStatusByOrderId)
router.get("/dispatch_logs/:order_id", DBookingController.getDispatchLogsByOrderId)
router.get("/bookings/customer/:customer_name", DBookingController.getBookingsByCustomerName)
router.delete("/dbooking/:id", DBookingController.deleteBooking)
router.patch("/dbooking/:order_id/cancel", DBookingController.cancelBooking)

module.exports = router
