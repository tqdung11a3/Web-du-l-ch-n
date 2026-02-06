const router = require("express").Router();
const companyController = require("../../controllers/client/company.controller");
const tourController = require("../../controllers/client/tour.controller");

router.get("/", companyController.listCompanies);

// Đặt route dài hơn trước để tránh conflict
router.get("/:slug/tour/detail/:tourSlug", tourController.detail);
router.get("/:slug/tours", companyController.toursByCompany);
router.get("/:slug/hotels", companyController.hotelsByCompany);
router.get("/:slug/flights", companyController.flightsByCompany);
router.get("/:slug/discount", companyController.discountTourList);
router.get("/:slug", companyController.companyDetail);

module.exports = router;
