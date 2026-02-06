// middlewares/client/auth.middleware.js
const jwt = require("jsonwebtoken");
const AccountUser = require("../../models/account-user.model");

const COOKIE_NAME = "client_token"; // cookie CHỈ cho client
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SECRET";

// ---- Helpers ----
async function decodeAndLoadUser(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, JWT_SECRET);
  const { id, email } = decoded || {};
  if (!id || !email) return null;
  const user = await AccountUser.findOne({ _id: id, email }).lean();
  if (!user) return null;
  // 🔧 Chuẩn hoá id để pug/FE dùng thống nhất
  return { ...user, id: String(user._id) };
}

// Gắn user vào req/res.locals nếu có (không bắt buộc, không xoá cookie)
module.exports.attachUser = async (req, res, next) => {
  try {
    const bearer = req.headers.authorization || "";
    const token =
      req.cookies?.[COOKIE_NAME] ||
      (bearer.startsWith("Bearer ") ? bearer.slice(7) : null);

    const user = await decodeAndLoadUser(token);
    if (user) {
      req.account = user;
      res.locals.account = user;
    } else {
      res.locals.account = null;
    }
  } catch {
    res.locals.account = null;
  }
  return next();
};

// BẮT BUỘC đăng nhập cho TRANG (redirect nếu chưa đăng nhập)
module.exports.verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    const user = await decodeAndLoadUser(token);
    if (!user) {
      // clear cookie và redirect cho trang
      res.clearCookie(COOKIE_NAME, { path: "/" });
      return res.redirect("/account/login");
    }
    req.account = user;
    res.locals.account = user;
    return next();
  } catch {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.redirect("/account/login");
  }
};

// BẮT BUỘC đăng nhập cho API (trả JSON 401 thay vì redirect)
module.exports.verifyTokenApi = async (req, res, next) => {
  try {
    const bearer = req.headers.authorization || "";
    const token =
      req.cookies?.[COOKIE_NAME] ||
      (bearer.startsWith("Bearer ") ? bearer.slice(7) : null);

    const user = await decodeAndLoadUser(token);
    if (!user) {
      return res
        .status(401)
        .json({ code: "unauth", message: "Bạn chưa đăng nhập" });
    }
    req.account = user;
    res.locals.account = user;
    return next();
  } catch {
    return res
      .status(401)
      .json({ code: "unauth", message: "Bạn chưa đăng nhập" });
  }
};

// Nếu đã login thì chặn vào /account/login, /account/register
module.exports.ensureGuest = (req, res, next) => {
  if (res.locals.account) return res.redirect("/");
  next();
};
