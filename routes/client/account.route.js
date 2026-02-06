const router = require("express").Router();
const accountController = require("../../controllers/client/account.controller");
const accountValidate = require("../../validates/client/account.validate");
const clientAuth = require("../../middlewares/client/auth.middleware");

router.get("/login", clientAuth.ensureGuest, accountController.login);

router.post(
  "/login",
  clientAuth.ensureGuest,
  accountValidate.loginPost,
  accountController.loginPost
);

router.get("/register", clientAuth.ensureGuest, accountController.register);

router.post(
  "/register",
  clientAuth.ensureGuest,
  accountValidate.registerPost,
  accountController.registerPost
);

router.get("/profile", clientAuth.verifyToken, accountController.profile);
router.patch(
  "/profile",
  clientAuth.verifyToken,
  accountController.profilePatch
);

router.post("/logout", clientAuth.verifyToken, accountController.logoutPost);

module.exports = router;
