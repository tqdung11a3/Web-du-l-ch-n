// validates/admin/hotel.validate.js
const Joi = require("joi");

module.exports.createPost = async (req, res, next) => {
  // Cho phép truyền 1 string hoặc 1 array string (roomTypes, FAQ,...)
  const stringOrArray = Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  );

  const numberLike = Joi.alternatives().try(Joi.number(), Joi.string()); // server sẽ parse sang Number sau

  const schema = Joi.object({
    // ===== Thông tin cơ bản =====
    name: Joi.string().required().messages({
      "string.empty": "Vui lòng nhập tên khách sạn!",
    }),
    cityName: Joi.string().allow(""),
    address: Joi.string().allow(""),
    starRating: numberLike.allow(""),
    basePrice: numberLike.allow(""),
    currency: Joi.string().allow(""),
    shortDescription: Joi.string().allow(""),
    description: Joi.string().allow(""),
    amenities: Joi.string().allow(""),
    status: Joi.string().allow(""),

    // Khách sạn nổi bật – checkbox
    isFeatured: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("on", "off", "true", "false", ""))
      .optional(),

    // ===== Điểm nổi bật / khuyến mại / di chuyển =====
    highlights: Joi.string().allow(""), // textarea nhiều dòng
    promotionShortText: Joi.string().allow(""),

    // ===== Điểm đánh giá =====
    ratingOverall: numberLike.allow(""),
    ratingCount: numberLike.allow(""),
    ratingLocation: numberLike.allow(""),
    ratingCleanliness: numberLike.allow(""),
    ratingFacilities: numberLike.allow(""),
    ratingService: numberLike.allow(""),
    ratingValue: numberLike.allow(""),

    // ===== Quy định chỗ nghỉ & thông tin hữu ích =====
    checkinTimeFrom: Joi.string().allow(""),
    checkoutTimeTo: Joi.string().allow(""),
    numberOfRooms: numberLike.allow(""),

    // ===== FAQ =====
    faqQuestions: stringOrArray.optional(),
    faqAnswers: stringOrArray.optional(),

    // ===== Loại phòng =====
    roomTypeNames: stringOrArray.optional(),
    roomTypeMaxGuests: stringOrArray.optional(),
    roomTypeBasePrices: stringOrArray.optional(),
    roomTypeDescriptions: stringOrArray.optional(),

    // avatar / images là file nên body chỉ là chuỗi path sau multer
    avatar: Joi.string().allow(""),
    images: Joi.any(),
  }).unknown(true); // cho phép thêm field khác nếu sau này mở rộng

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
