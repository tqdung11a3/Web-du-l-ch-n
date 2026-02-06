const { generateRandomNumber } = require("../../helpers/generate.helper");
const Order = require("../../models/order.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const {
  paymentMethodList,
  paymentStatusList,
  statusList,
} = require("../../config/variable.config");
const moment = require("moment");

// === Helpers: tính giá em bé theo bậc (theo vị trí bé #1, #2, ...) ===
function babyUnitAt(idx, mode, rules, priceAdult, priceChild, priceBabyFixed) {
  if (mode !== "tiered" || !Array.isArray(rules) || !rules.length) {
    return Number(priceBabyFixed || 0);
  }
  const found = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!found) return 0;
  const base =
    found.ref === "adult" ? Number(priceAdult || 0) : Number(priceChild || 0);
  const pct = Number(found.percent || 0);
  return Math.round((base * pct) / 100);
}

function babyTotalQty(
  qty,
  mode,
  rules,
  priceAdult,
  priceChild,
  priceBabyFixed
) {
  let sum = 0;
  qty = Number(qty || 0);
  for (let i = 1; i <= qty; i++) {
    sum += babyUnitAt(i, mode, rules, priceAdult, priceChild, priceBabyFixed);
  }
  return sum;
}

module.exports.createPost = async (req, res) => {
  try {
    const body = req.body || {};
    const incomingItems = Array.isArray(body.items) ? body.items : [];
    if (!incomingItems.length) {
      return res.json({ code: "error", message: "Không có tour nào để đặt!" });
    }

    // Nhóm item theo companyId
    const groups = Object.create(null);

    for (const raw of incomingItems) {
      const { tourId } = raw || {};
      if (!tourId) continue;

      // Tour đang active
      const tourInfo = await Tour.findOne({
        _id: tourId,
        deleted: false,
        status: "active",
      }).lean();
      if (!tourInfo) continue;

      // Chuẩn hoá số lượng
      const quantityAdult = Number(raw.quantityAdult || 0);
      const quantityChildren = Number(raw.quantityChildren || 0);
      const quantityBaby = Number(raw.quantityBaby || 0);
      const babySeat = !!raw.babySeat;

      // Chụp thông tin giá tại thời điểm đặt
      const priceAdult = Number(tourInfo.priceNewAdult || 0);
      const priceChild = Number(tourInfo.priceNewChildren || 0);
      const priceBabyFix = Number(tourInfo.priceNewBaby || 0);

      // Cấu hình tiered (nếu có)
      const babyMode = (tourInfo.babyPricingMode || "fixed").trim();
      const babyRules = Array.isArray(tourInfo.babyPricingRules)
        ? tourInfo.babyPricingRules
        : [];

      // ==== TÍNH TIỀN DÒNG ====
      const moneyAdult = quantityAdult * priceAdult;
      const moneyChild = quantityChildren * priceChild;
      const moneyBaby = babyTotalQty(
        quantityBaby,
        babyMode,
        babyRules,
        priceAdult,
        priceChild,
        priceBabyFix
      );
      const lineSubTotal = moneyAdult + moneyChild + moneyBaby;

      // ==== TÍNH GHẾ & CẬP NHẬT GHẾ CÒN LẠI ====
      const seatsUsed =
        quantityAdult + quantityChildren + (babySeat ? quantityBaby : 0);

      let seatsBefore;
      if (typeof tourInfo.seatsRemaining === "number") {
        seatsBefore = tourInfo.seatsRemaining;
      } else {
        const a = Number(tourInfo.stockAdult || 0);
        const c = Number(tourInfo.stockChildren || 0);
        const b = Number(tourInfo.stockBaby || 0);
        seatsBefore = a + c + b;
      }
      let seatsAfter = seatsBefore - seatsUsed;
      if (seatsAfter < 0) seatsAfter = 0;

      await Tour.updateOne(
        { _id: tourInfo._id, deleted: false, status: "active" },
        {
          stockAdult: Math.max(
            0,
            Number(tourInfo.stockAdult || 0) - quantityAdult
          ),
          stockChildren: Math.max(
            0,
            Number(tourInfo.stockChildren || 0) - quantityChildren
          ),
          stockBaby: Math.max(
            0,
            Number(tourInfo.stockBaby || 0) - quantityBaby
          ),
          seatsRemaining: seatsAfter,
        }
      );

      // Gom theo công ty
      const companyId = String(tourInfo.companyId || "");
      if (!groups[companyId]) groups[companyId] = { items: [], subTotal: 0 };

      groups[companyId].items.push({
        tourId: String(tourInfo._id),

        // KHÔNG dùng locationFrom nữa, lưu departureCity
        departureCity: tourInfo.departureCity || null,

        // Lưu lại ngày khởi hành mà client đã chọn (nếu có)
        // cart item gửi lên có trường departureDateDisplay (DD/MM/YYYY)
        departureDateDisplay:
          (raw.departureDateDisplay &&
            String(raw.departureDateDisplay).trim()) || null,

        quantityAdult,
        quantityChildren,
        quantityBaby,
        babySeat,

        // Giá snapshot
        priceNewAdult: priceAdult,
        priceNewChildren: priceChild,
        priceNewBaby: priceBabyFix,

        // Chụp cấu hình tính giá em bé để các màn hiển thị dùng lại
        babyPricingMode: babyMode,
        babyPricingRules: babyRules,

        // Thông tin render
        // Vẫn lưu departureDate gốc từ tour để tham chiếu,
        // nhưng khi hiển thị sẽ ưu tiên departureDateDisplay
        departureDate: tourInfo.departureDate,
        avatar: tourInfo.avatar,
        name: tourInfo.name,
        slug: tourInfo.slug,

        // Quyền theo công ty
        companyId: tourInfo.companyId || null,
      });

      groups[companyId].subTotal += lineSubTotal;
    }

    const companyIds = Object.keys(groups);
    if (!companyIds.length) {
      return res.json({
        code: "error",
        message: "Các tour bạn chọn hiện không khả dụng!",
      });
    }

    // Lấy user đang đăng nhập (nếu có) từ middleware attachUser
    const currentUser = req.account || null;
    const userId = currentUser?._id || null;
    const userName = currentUser?.fullName || currentUser?.email || "";

    // Tạo đơn cho từng công ty
    const createdOrders = [];
    for (const cid of companyIds) {
      const { items, subTotal } = groups[cid];

      const code = "OD" + generateRandomNumber(10);
      const discount = 0;
      const total = subTotal - discount;

      const newRecord = new Order({
        code,
        fullName: (body.fullName || "").trim(),
        phone: (body.phone || "").trim(),
        note: body.note || "",
        items,
        subTotal,
        discount,
        total,
        paymentMethod: body.paymentMethod, // money | bank | vnpay | ...
        paymentStatus: "unpaid",
        status: "initial",

        // Gắn user
        ...(userId ? { userId } : {}),
        ...(userName ? { userName } : {}),
      });

      await newRecord.save();

      createdOrders.push({
        orderCode: code,
        companyId: cid || null,
        phone: body.phone,
        total,
      });
    }

    return res.json({
      code: "success",
      message: "Tạo đơn hàng thành công!",
      isMulti: createdOrders.length > 1,
      orders: createdOrders,
    });
  } catch (error) {
    console.error("order.createPost error:", error);
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * GET /order/success?orderCode=...&phone=...
 * Hiển thị trang "Đặt hàng thành công"
 */
module.exports.success = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.redirect("/");
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!orderDetail) {
      return res.redirect("/");
    }

    // Gắn tên hiển thị cho method/status (tránh lỗi khi không tìm thấy)
    const pm = paymentMethodList.find(
      (item) => item.value === orderDetail.paymentMethod
    );
    const ps = paymentStatusList.find(
      (item) => item.value === orderDetail.paymentStatus
    );
    const st = statusList.find((item) => item.value === orderDetail.status);

    orderDetail.paymentMethodName = pm ? pm.label : "Không xác định";
    orderDetail.paymentStatusName = ps ? ps.label : "Không xác định";
    orderDetail.statusName = st ? st.label : "Không xác định";

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format(
      "HH:mm - DD/MM/YYYY"
    );

    // Lấy company slugs cho các tour
    const tourSlugs = orderDetail.items
      .map((it) => it.slug)
      .filter(Boolean);
    let companySlugMap = {};
    if (tourSlugs.length > 0) {
      const Tour = require("../../models/tour.model");
      const Company = require("../../models/company.model");
      const tours = await Tour.find({ slug: { $in: tourSlugs } })
        .select("slug companyId")
        .lean();
      const companyIds = [...new Set(tours.map((t) => t.companyId).filter(Boolean))];
      if (companyIds.length > 0) {
        const companies = await Company.find({ _id: { $in: companyIds } })
          .select("_id slug")
          .lean();
        const companyMap = Object.fromEntries(
          companies.map((c) => [String(c._id), c.slug])
        );
        companySlugMap = Object.fromEntries(
          tours.map((t) => [t.slug, companyMap[String(t.companyId)] || null])
        );
      }
    }

    // Bổ sung cityName + format ngày khởi hành cho từng item
    for (const item of orderDetail.items) {
      // Ưu tiên ngày khởi hành mà khách đã chọn khi đặt (departureDateDisplay),
      // nếu không có thì fallback về departureDate (ngày mặc định của tour)
      const departureDisplay =
        (item.departureDateDisplay &&
          String(item.departureDateDisplay).trim()) ||
        (item.departureDate
          ? moment(item.departureDate).format("DD/MM/YYYY")
          : "");
      item.departureDateFormat = departureDisplay;

      // Ưu tiên departureCity, fallback locationFrom để không lỗi đơn cũ
      const cityId = item.departureCity || item.locationFrom || null;

      if (cityId) {
        const city = await City.findOne({ _id: cityId });
        item.cityName = city ? city.name : "";
      } else {
        item.cityName = "";
      }

      // Thêm company slug
      item.companySlug = item.slug ? (companySlugMap[item.slug] || null) : null;
    }

    return res.render("client/pages/order-success", {
      pageTitle: "Đặt hàng thành công",
      orderDetail,
    });
  } catch (error) {
    console.error("order.success error:", error);
    return res.redirect("/");
  }
};

module.exports.paymentVNPay = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode && !phone) {
      res.redirect("/");
      return;
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!orderDetail) {
      res.redirect("/");
      return;
    }

    let date = new Date();
    let createDate = moment(date).utcOffset(7).format("YYYYMMDDHHmmss");

    let ipAddr =
      req.headers["x-forwarded-for"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.connection.socket.remoteAddress;

    let tmnCode = process.env.VNPAY_TMNCODE;
    let secretKey = process.env.VNPAY_SECRET;
    let vnpUrl = process.env.VNPAY_URL;
    let returnUrl = `${process.env.WEBSITE_DOMAIN}/order/payment-vnpay-result`;
    let orderId = `${orderCode}-${phone}-${Date.now()}`;
    let amount = orderDetail.total;
    let bankCode = "";

    let locale = "vn";
    let currCode = "VND";
    let vnp_Params = {};
    vnp_Params["vnp_Version"] = "2.1.0";
    vnp_Params["vnp_Command"] = "pay";
    vnp_Params["vnp_TmnCode"] = tmnCode;
    vnp_Params["vnp_Locale"] = locale;
    vnp_Params["vnp_CurrCode"] = currCode;
    vnp_Params["vnp_TxnRef"] = orderId;
    vnp_Params["vnp_OrderInfo"] = "Thanh toan cho ma GD:" + orderId;
    vnp_Params["vnp_OrderType"] = "other";
    vnp_Params["vnp_Amount"] = amount * 100;
    vnp_Params["vnp_ReturnUrl"] = returnUrl;
    vnp_Params["vnp_IpAddr"] = ipAddr;
    vnp_Params["vnp_CreateDate"] = createDate;
    if (bankCode !== null && bankCode !== "") {
      vnp_Params["vnp_BankCode"] = bankCode;
    }

    vnp_Params = sortObject(vnp_Params);

    let querystring = require("qs");
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let crypto = require("crypto");
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(new Buffer(signData, "utf-8")).digest("hex");
    vnp_Params["vnp_SecureHash"] = signed;
    vnpUrl += "?" + querystring.stringify(vnp_Params, { encode: false });

    res.redirect(vnpUrl);
  } catch (error) {
    console.log(error);
    res.redirect("/");
  }
};

module.exports.paymentVNPayResult = async (req, res) => {
  try {
    let vnp_Params = req.query;

    let secureHash = vnp_Params["vnp_SecureHash"];

    delete vnp_Params["vnp_SecureHash"];
    delete vnp_Params["vnp_SecureHashType"];

    vnp_Params = sortObject(vnp_Params);

    let secretKey = process.env.VNPAY_SECRET;

    let querystring = require("qs");
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let crypto = require("crypto");
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(new Buffer(signData, "utf-8")).digest("hex");

    if (secureHash === signed) {
      //Kiem tra xem du lieu trong db co hop le hay khong va thong bao ket qua
      const [orderCode, phone] = vnp_Params["vnp_TxnRef"].split("-");
      
      // Kiểm tra mã phản hồi từ VNPay
      const responseCode = vnp_Params["vnp_ResponseCode"];
      
      if (responseCode === "00") {
        // Giao dịch thành công
        await Order.updateOne(
          {
            code: orderCode,
            phone: phone,
          },
          {
            paymentStatus: "paid",
          }
        );
        return res.redirect(
          `${process.env.WEBSITE_DOMAIN}/order/success?orderCode=${orderCode}&phone=${phone}`
        );
      } else {
        // Giao dịch thất bại
        console.log("VNPay payment failed with response code:", responseCode);
        return res.redirect("/?message=Thanh toán không thành công. Vui lòng thử lại.");
      }
    } else {
      // Chữ ký không hợp lệ - có thể bị giả mạo
      console.error("VNPay signature verification failed");
      return res.redirect("/?message=Xác thực thanh toán thất bại. Vui lòng liên hệ hỗ trợ.");
    }
  } catch (error) {
    console.log(error);
    res.redirect("/");
  }
};

function sortObject(obj) {
  if (typeof obj !== "object" || obj === null) {
    throw new TypeError("Input must be a plain object");
  }

  let sorted = {};
  let str = [];
  let key;

  // Duyệt qua các thuộc tính của đối tượng
  for (key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      str.push(encodeURIComponent(key));
    }
  }

  // Sắp xếp các khóa
  str.sort();

  // Tạo đối tượng mới với các khóa đã sắp xếp
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
  }

  return sorted;
}
