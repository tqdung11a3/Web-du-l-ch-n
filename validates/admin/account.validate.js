const Joi = require("joi");

module.exports.registerPost = async (req, res, next) => {
  const schema = Joi.object({
    fullName: Joi.string().trim().min(5).max(50).required().messages({
      "string.empty": "Vui lòng nhập họ tên!",
      "string.min": "Họ tên phải có ít nhất 5 ký tự!",
      "string.max": "Họ tên không được vượt quá 50 ký tự!",
    }),

    email: Joi.string().trim().lowercase().email().required().messages({
      "string.empty": "Vui lòng nhập email!",
      "string.email": "Email không đúng định dạng!",
    }),

    // NEW: tên công ty khi đăng ký
    companyName: Joi.string().trim().min(2).max(100).required().messages({
      "string.empty": "Vui lòng nhập tên công ty!",
      "string.min": "Tên công ty phải có ít nhất 2 ký tự!",
      "string.max": "Tên công ty không được vượt quá 100 ký tự!",
    }),

    password: Joi.string()
      .min(8)
      .custom((value, helpers) => {
        if (!/[A-Z]/.test(value)) {
          return helpers.error("password.uppercase");
        }
        if (!/[a-z]/.test(value)) {
          return helpers.error("password.lowercase");
        }
        if (!/\d/.test(value)) {
          return helpers.error("password.number");
        }
        if (!/[~!@#$%^&*]/.test(value)) {
          return helpers.error("password.special");
        }
        return value;
      })
      .required()
      .messages({
        "string.empty": "Vui lòng nhập mật khẩu!",
        "string.min": "Mật khẩu phải có ít nhất 8 ký tự!",
        "password.uppercase": "Mật khẩu phải có ít nhất một chữ cái viết hoa!",
        "password.lowercase":
          "Mật khẩu phải có ít nhất một chữ cái viết thường!",
        "password.number": "Mật khẩu phải có ít nhất một chữ số!",
        "password.special":
          "Mật khẩu phải có ít nhất một ký tự đặc biệt! (~!@#$%^&*)",
      }),

    // NEW: xác nhận mật khẩu khớp password
    confirmPassword: Joi.any().valid(Joi.ref("password")).required().messages({
      "any.only": "Xác nhận mật khẩu không khớp!",
      "any.required": "Vui lòng nhập xác nhận mật khẩu!",
    }),

    // tuỳ chọn nếu form có gửi checkbox điều khoản
    agree: Joi.boolean().optional(),
  });

  const { error } = schema.validate(req.body); // abortEarly mặc định: trả lỗi đầu tiên

  if (error) {
    const errorMessage = error.details[0].message;
    res.json({
      code: "error",
      message: errorMessage,
    });
    return;
  }

  next();
};

module.exports.loginPost = async (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.empty": "Vui lòng nhập email!",
      "string.email": "Email không đúng định dạng!",
    }),
    password: Joi.string().required().messages({
      "string.empty": "Vui lòng nhập mật khẩu!",
    }),
    rememberPassword: Joi.boolean(),
  });

  const { error } = schema.validate(req.body);

  if (error) {
    const errorMessage = error.details[0].message;

    res.json({
      code: "error",
      message: errorMessage,
    });
    return;
  }

  next();
};

module.exports.forgotPasswordPost = async (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.empty": "Vui lòng nhập email!",
      "string.email": "Email không đúng định dạng!",
    }),
  });

  const { error } = schema.validate(req.body);

  if (error) {
    const errorMessage = error.details[0].message;

    res.json({
      code: "error",
      message: errorMessage,
    });
    return;
  }

  next();
};

module.exports.otpPasswordPost = async (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.empty": "Vui lòng nhập email!",
      "string.email": "Email không đúng định dạng!",
    }),
    otp: Joi.string().required().messages({
      "string.empty": "Vui lòng nhập mã OTP!",
    }),
  });

  const { error } = schema.validate(req.body);

  if (error) {
    const errorMessage = error.details[0].message;

    res.json({
      code: "error",
      message: errorMessage,
    });
    return;
  }

  next();
};

module.exports.resetPasswordPost = async (req, res, next) => {
  const schema = Joi.object({
    password: Joi.string()
      .min(8)
      .custom((value, helpers) => {
        if (!/[A-Z]/.test(value)) {
          return helpers.error("password.uppercase");
        }
        if (!/[a-z]/.test(value)) {
          return helpers.error("password.lowercase");
        }
        if (!/\d/.test(value)) {
          return helpers.error("password.number");
        }
        if (!/[~!@#$%^&*]/.test(value)) {
          return helpers.error("password.special");
        }
        return value;
      })
      .required()
      .messages({
        "string.empty": "Vui lòng nhập mật khẩu!",
        "string.min": "Mật khẩu phải có ít nhất 8 ký tự!",
        "password.uppercase": "Mật khẩu phải có ít nhất một chữ cái viết hoa!",
        "password.lowercase":
          "Mật khẩu phải có ít nhất một chữ cái viết thường!",
        "password.number": "Mật khẩu phải có ít nhất một chữ số!",
        "password.special":
          "Mật khẩu phải có ít nhất một ký tự đặc biệt! (~!@#$%^&*)",
      }),
  });

  const { error } = schema.validate(req.body);

  if (error) {
    const errorMessage = error.details[0].message;

    res.json({
      code: "error",
      message: errorMessage,
    });
    return;
  }

  next();
};
