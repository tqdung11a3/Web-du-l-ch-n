const mongoose = require("mongoose");
const AccountAdmin = require("../../models/account-admin.model");
const Company = require("../../models/company.model");
const Hotel = require("../../models/hotel.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateRandomNumber } = require("../../helpers/generate.helper");
const ForgotPassword = require("../../models/forgot-password.model");
const mailHelper = require("../../helpers/mail.helper");

// backup nếu chưa thêm Company.slugify trong model:
const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** URL đích sau đăng nhập cho company admin (theo phạm vi menu / nhóm quyền). */
async function getCompanyAdminLoginRedirect(account) {
  const pathAdmin = global.pathAdmin || "admin";
  const base = `/${pathAdmin}`;

  const scope = account.tabAccessScope || "full";

  async function firstHotelDashboardUrl() {
    const firstHotel = await Hotel.findOne({
      companyId: account.companyId,
      deleted: { $ne: true },
    })
      .sort({ name: 1 })
      .select("_id")
      .lean();
    if (firstHotel?._id) {
      return `${base}/hotel/dashboard?hotelId=${firstHotel._id}`;
    }
    return `${base}/hotel/dashboard`;
  }

  if (scope === "hotel_staff") {
    const hid = account.assignedHotelId;
    return hid
      ? `${base}/hotel/dashboard?hotelId=${hid}`
      : firstHotelDashboardUrl();
  }

  if (scope === "hotel_only") {
    return firstHotelDashboardUrl();
  }

  // full / inherit (backward compat) / mặc định: toàn quyền → vào dashboard tour
  return `${base}/dashboard`;
}

module.exports.login = async (req, res) => {
  res.render("admin/pages/login", {
    pageTitle: "Đăng nhập",
  });
};

module.exports.loginPost = async (req, res) => {
  const { email, password, rememberPassword } = req.body;

  const existAccount = await AccountAdmin.findOne({
    email: email,
  });

  if (!existAccount) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!",
    });
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, existAccount.password);

  if (!isPasswordValid) {
    res.json({
      code: "error",
      message: "Mật khẩu không đúng!",
    });
    return;
  }

  if (existAccount.status != "active") {
    res.json({
      code: "error",
      message: "Tài khoản chưa được kích hoạt!",
    });
    return;
  }

  const token = jwt.sign(
    {
      id: existAccount.id,
      email: existAccount.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: rememberPassword ? "7d" : "1d",
    }
  );

  res.cookie("token", token, {
    maxAge: rememberPassword ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "strict",
  });

  let redirectUrl;
  if (existAccount.isSuperAdmin) {
    redirectUrl = `/${global.pathAdmin}/super-admin/dashboard`;
  } else {
    redirectUrl = await getCompanyAdminLoginRedirect(existAccount);
  }

  res.json({
    code: "success",
    message: "Đăng nhập thành công!",
    redirectUrl: redirectUrl,
  });
};

module.exports.register = async (req, res) => {
  res.render("admin/pages/register", {
    pageTitle: "Đăng ký",
  });
};

module.exports.registerPost = async (req, res) => {
  try {
    const { fullName, email, password, companyName } = req.body;

    const emailNorm = String(email || "")
      .trim()
      .toLowerCase();
    const companyNameNorm = String(companyName || "").trim();

    // 1) Check email
    if (await AccountAdmin.findOne({ email: emailNorm })) {
      return res.json({
        code: "error",
        message: "Email đã tồn tại trong hệ thống!",
      });
    }

    // 2) Find-or-create Company
    const companySlug = Company.slugify
      ? Company.slugify(companyNameNorm)
      : slugify(companyNameNorm);
    let company = await Company.findOne({ slug: companySlug });
    if (!company) {
      company = await Company.create({
        name: companyNameNorm,
        slug: companySlug,
        status: "active",
      });
    } else if (company.status === "inactive") {
      return res.json({
        code: "error",
        message:
          "Công ty này đang tạm dừng hoạt động. Vui lòng liên hệ quản trị viên.",
      });
    }

    // 3) Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4) Tạo _id trước và gán createdBy/updatedBy = chính mình (String)
    const _id = new mongoose.Types.ObjectId();

    await AccountAdmin.create({
      _id,
      fullName: fullName.trim(),
      email: emailNorm,
      password: passwordHash,
      status: "initial",
      companyId: company._id,
      createdBy: _id.toString(),
      updatedBy: _id.toString(),
      deleted: false,
    });

    return res.json({
      code: "success",
      message: "Đăng ký tài khoản thành công!",
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const key = Object.keys(err.keyValue || {})[0] || "dữ liệu";
      return res.json({
        code: "error",
        message: `Giá trị ${key} đã tồn tại, vui lòng dùng giá trị khác!`,
      });
    }
    console.error("registerPost error:", err);
    return res
      .status(500)
      .json({ code: "error", message: "Có lỗi xảy ra, vui lòng thử lại!" });
  }
};

module.exports.registerInitial = async (req, res) => {
  res.render("admin/pages/register-initial", {
    pageTitle: "Tài khoản đã được khởi tạo",
  });
};

module.exports.forgotPassword = async (req, res) => {
  res.render("admin/pages/forgot-password", {
    pageTitle: "Quên mật khẩu",
  });
};

module.exports.forgotPasswordPost = async (req, res) => {
  const { email } = req.body;

  // Kiểm tra email có tồn tại trong CSDL
  const existAccount = await AccountAdmin.findOne({
    email: email,
    status: "active",
  });

  if (!existAccount) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!",
    });
    return;
  }

  // Kiểm tra email đã tồn tại trong ForgotPassword hay chưa
  const existEmailInForgotPassword = await ForgotPassword.findOne({
    email: email,
  });

  if (existEmailInForgotPassword) {
    res.json({
      code: "error",
      message: "Vui lòng gửi lại yêu cầu sau 5 phút!",
    });
    return;
  }

  // Tạo mã OTP
  const otp = generateRandomNumber(6);

  // Lưu vào CSDL: email và otp (lưu trong 5 phút)
  const newRecord = new ForgotPassword({
    email: email,
    otp: otp,
    expireAt: Date.now() + 5 * 60 * 1000,
  });
  await newRecord.save();

  // Gửi mã OTP qua email
  const title = `Mã OTP lấy lại mật khẩu`;
  const content = `Mã OTP của bạn là <b style="color: green; font-size: 20px;">${otp}</b>. Mã OTP có hiệu lực trong 5 phút, vui lòng không cung cấp cho bất kỳ ai.`;
  mailHelper.sendMail(email, title, content);

  res.json({
    code: "success",
    message: "Đã gửi mã OTP qua email!",
  });
};

module.exports.otpPassword = async (req, res) => {
  res.render("admin/pages/otp-password", {
    pageTitle: "Nhập mã OTP",
  });
};

module.exports.otpPasswordPost = async (req, res) => {
  const { email, otp } = req.body;

  // Kiểm tra email có tồn tại trong CSDL
  const existAccount = await AccountAdmin.findOne({
    email: email,
    status: "active",
  });

  if (!existAccount) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!",
    });
    return;
  }

  // Xác thực mã OTP
  const existRecordInForgotPassword = await ForgotPassword.findOne({
    email: email,
    otp: otp,
  });

  if (!existRecordInForgotPassword) {
    res.json({
      code: "error",
      message: "Mã OTP không hợp lệ!",
    });
    return;
  }

  const token = jwt.sign(
    {
      id: existAccount.id,
      email: existAccount.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );

  res.cookie("token", token, {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "strict",
  });

  res.json({
    code: "success",
    message: "Xác thực thành công!",
  });
};

module.exports.resetPassword = async (req, res) => {
  res.render("admin/pages/reset-password", {
    pageTitle: "Đổi mật khẩu",
  });
};

module.exports.resetPasswordPost = async (req, res) => {
  const { password } = req.body;

  // Mã hóa mật khẩu
  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);

  await AccountAdmin.updateOne(
    {
      _id: req.account.id,
    },
    {
      password: hashPassword,
    }
  );

  res.json({
    code: "success",
    message: "Đã đổi mật khẩu thành công!",
  });
};

module.exports.logoutPost = async (req, res) => {
  res.clearCookie("token");
  res.json({
    code: "success",
    message: "Đã đăng xuất!",
  });
};
