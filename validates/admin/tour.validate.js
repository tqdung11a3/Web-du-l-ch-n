const Joi = require("joi");

// helper: chấp nhận số hoặc chuỗi rỗng (""), để form-data không bị fail
const numericOrEmpty = Joi.alternatives().try(
  Joi.number().integer().min(0),
  Joi.string().valid("")
);

module.exports.createPost = async (req, res, next) => {
  const schema = Joi.object({
    name: Joi.string().required().messages({
      "string.empty": "Vui lòng nhập tên tour!",
    }),

    category: Joi.string().allow(""),
    position: numericOrEmpty,
    status: Joi.string().allow(""),
    avatar: Joi.string().allow(""),

    // Giá
    priceAdult: numericOrEmpty,
    priceChildren: numericOrEmpty,
    priceBaby: numericOrEmpty,
    priceNewAdult: numericOrEmpty,
    priceNewChildren: numericOrEmpty,

    // priceNewBaby: yêu cầu khi fixed
    priceNewBaby: Joi.alternatives().conditional("babyPricingMode", {
      is: "fixed",
      then: Joi.number().integer().min(0).messages({
        "number.base": "Giá mới Em bé phải là số!",
        "number.min": "Giá mới Em bé phải ≥ 0!",
      }),
      otherwise: numericOrEmpty, // tiered -> bỏ qua (không bắt buộc)
    }),

    // Ghế (thay cho stock*)
    seatsTotal: numericOrEmpty,
    seatsRemaining: numericOrEmpty
      .custom((value, helpers) => {
        // nếu rỗng, cho qua; nếu là số, kiểm tra ≤ seatsTotal
        if (value === "") return value;
        const v = Number(value);
        const totalRaw = helpers?.state?.ancestors?.[0]?.seatsTotal;
        const total = totalRaw === "" ? 0 : Number(totalRaw || 0);
        if (Number.isFinite(v) && Number.isFinite(total) && v > total) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "seatsRemaining <= seatsTotal")
      .messages({
        "any.invalid": "Số ghế còn lại không được lớn hơn tổng số ghế!",
      }),

    // ==== Thời hạn khuyến mãi (giảm theo giá cố định) ====
    // Gửi dạng chuỗi 'YYYY-MM-DD' hoặc để rỗng
    discountFrom: Joi.string().allow(""),
    discountTo: Joi.string().allow(""),

    // Khác
    locations: Joi.string().allow(""),
    time: Joi.string().allow(""),
    vehicle: Joi.string().allow(""),
    departureDate: Joi.string().allow(""), // Giữ lại để tương thích
    departureDates: Joi.alternatives().try(
      Joi.string().allow(""), // JSON string
      Joi.array().items(Joi.string().allow("")) // Array of date strings
    ).allow(""),

    // 👇 THÊM FIELD NÀY ĐỂ KHÔNG BỊ "departureCity is not allowed"
    departureCity: Joi.string().allow(""),

    information: Joi.string().allow(""),
    schedules: Joi.string().allow(""),
    images: Joi.string().allow(""),

    // Điểm nổi bật, bao gồm, không bao gồm
    highlights: Joi.string().allow(""),
    includes: Joi.string().allow(""),
    excludes: Joi.string().allow(""),

    // Tags (loại hình trải nghiệm) - có thể là mảng hoặc string
    tags: Joi.alternatives().try(
      Joi.array().items(Joi.string().valid("phiêu lưu", "biển", "văn hóa", "leo núi", "tham quan thành phố")),
      Joi.string().allow("")
    ).optional(),

    // Cấu hình giá em bé
    babyPricingMode: Joi.string().valid("fixed", "tiered").default("fixed"),
    babyPricingRulesJson: Joi.alternatives().conditional("babyPricingMode", {
      is: "tiered",
      then: Joi.string()
        .required()
        .custom((val, helpers) => {
          try {
            const parsed = JSON.parse(val);
            if (!Array.isArray(parsed) || parsed.length === 0) {
              return helpers.error("any.invalid");
            }
            return val;
          } catch {
            return helpers.error("any.invalid");
          }
        }, "JSON array for baby pricing rules")
        .messages({
          "string.empty":
            "Vui lòng nhập Quy tắc (JSON) khi chọn chế độ Theo bậc!",
          "any.invalid":
            "Quy tắc (JSON) phải là một mảng JSON hợp lệ và không rỗng!",
        }),
      otherwise: Joi.string().allow(""),
    }),
  }).prefs({ convert: true }); // cho phép Joi chuyển '123' -> 123 với các field number

  const { error } = schema.validate(req.body);
  if (error) {
    return res.json({
      code: "error",
      message: error.details[0].message,
    });
  }
  next();
};

module.exports.bulkDiscount = (req, res, next) => {
  const schema = Joi.object({
    // giới hạn 1–90% để tránh thao tác nhầm
    percent: Joi.number().min(1).max(90).required().messages({
      "any.required": "Vui lòng nhập phần trăm giảm!",
      "number.base": "Phần trăm giảm phải là số!",
      "number.min": "Phần trăm giảm phải ≥ 1!",
      "number.max": "Phần trăm giảm phải ≤ 90!",
    }),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.json({ code: "error", message: error.details[0].message });
  }
  next();
};
