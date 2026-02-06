// controllers/admin/super-admin/order.controller.js
const Order = require("../../../models/order.model");
const Tour = require("../../../models/tour.model");
const AccountUser = require("../../../models/account-user.model");
const City = require("../../../models/city.model");
const {
  paymentMethodList,
  paymentStatusList,
  statusList,
} = require("../../../config/variable.config");
const moment = require("moment");

// Chuẩn hoá rules như phía client/cart.controller.js
function normalizeRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  return rawRules
    .map((r) => ({
      from: Number(r.from),
      to: r.to === "inf" || r.to === Infinity ? "inf" : Number(r.to),
      percent: Number(r.percent),
      ref: r.ref === "adult" ? "adult" : "children",
    }))
    .filter(
      (r) =>
        Number.isFinite(r.from) &&
        (r.to === "inf" || Number.isFinite(r.to)) &&
        Number.isFinite(r.percent) &&
        r.percent >= 0 &&
        r.percent <= 100
    );
}

// Lấy context pricing cho 1 item
function getBabyPricingCtx(item, tourById) {
  const tour = tourById?.[String(item.tourId)] || null;

  const priceNewAdult =
    Number(item.priceNewAdult ?? (tour ? tour.priceNewAdult : 0)) || 0;
  const priceNewChildren =
    Number(item.priceNewChildren ?? (tour ? tour.priceNewChildren : 0)) || 0;
  const priceNewBaby =
    Number(item.priceNewBaby ?? (tour ? tour.priceNewBaby : 0)) || 0;

  const mode = (
    item.babyPricingMode ??
    tour?.babyPricingMode ??
    "fixed"
  ).trim();

  const rules = normalizeRules(
    (item.babyPricingRules && item.babyPricingRules.length
      ? item.babyPricingRules
      : tour?.babyPricingRules) || []
  );

  return { priceNewAdult, priceNewChildren, priceNewBaby, mode, rules };
}

// Đơn giá cho em bé thứ idx (1-based)
function babyUnitAt(ctx, idx) {
  const { mode, rules, priceNewAdult, priceNewChildren, priceNewBaby } = ctx;
  if (mode !== "tiered" || !rules.length) return priceNewBaby;

  const rule = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!rule) return 0;

  const base = rule.ref === "adult" ? priceNewAdult : priceNewChildren;
  const pct = Number(rule.percent) || 0;
  return Math.round((base * pct) / 100);
}

/**
 * GET: Danh sách tất cả đơn hàng (Super Admin)
 */
module.exports.list = async (req, res) => {
  try {
    const filter = { deleted: { $ne: true } };

    // Search by order code
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.code = regex;
    }

    // Filter by payment status
    if (req.query.paymentStatus) {
      filter.paymentStatus = req.query.paymentStatus;
    }

    // Filter by status
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Phân trang
    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }
    const skip = (page - 1) * limitItems;

    const totalRecord = await Order.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      currentPage: page,
      skip: skip,
      totalRecord: totalRecord,
      totalPage: totalPage,
    };

    const rawOrders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limitItems)
      .skip(skip)
      .lean();

    // Thu thập các tourId cần fallback rule
    const needTourIds = new Set();
    for (const o of rawOrders) {
      const items = o.items || [];
      items.forEach((it) => {
        const hasRules =
          (it.babyPricingMode && it.babyPricingMode !== "fixed") ||
          (Array.isArray(it.babyPricingRules) && it.babyPricingRules.length > 0);
        if (!hasRules && it.tourId) needTourIds.add(String(it.tourId));
      });
    }
    
    let tourById = {};
    if (needTourIds.size) {
      const tours = await Tour.find({
        _id: { $in: Array.from(needTourIds) },
        deleted: { $ne: true },
      })
        .select(
          "_id priceNewAdult priceNewChildren priceNewBaby babyPricingMode babyPricingRules"
        )
        .lean();

      tourById = tours.reduce((acc, t) => {
        acc[String(t._id)] = t;
        return acc;
      }, {});
    }

    const orderList = rawOrders.map((o) => {
      let subTotalView = 0;

      // Tính lại từng item
      const itemsForView = (o.items || []).map((it) => {
        const qAdult = Number(it.quantityAdult || 0);
        const qChild = Number(it.quantityChildren || 0);
        const qBaby = Number(it.quantityBaby || 0);

        const unitAdult = Number(it.priceNewAdult || 0);
        const unitChild = Number(it.priceNewChildren || 0);

        const ctx = getBabyPricingCtx(it, tourById);

        // Cộng dồn tiền em bé theo bậc
        let babyTotal = 0;
        for (let i = 1; i <= qBaby; i++) {
          babyTotal += babyUnitAt(ctx, i);
        }

        const babyUnitForUi = babyUnitAt(ctx, Math.max(1, qBaby || 1));

        // Cộng vào tạm tính
        subTotalView += qAdult * unitAdult + qChild * unitChild + babyTotal;

        return {
          ...it,
          babyUnitForUi,
        };
      });

      const discountView = 0;
      const totalView = subTotalView - discountView;

      // Gắn lại các nhãn trạng thái
      const pm = paymentMethodList.find((i) => i.value === o.paymentMethod);
      const ps = paymentStatusList.find((i) => i.value === o.paymentStatus);
      const st = statusList.find((i) => i.value === o.status);

      return {
        ...o,
        items: itemsForView,
        subTotalView,
        discountView,
        totalView,
        paymentMethodName: pm ? pm.label : "Không xác định",
        paymentStatusName: ps ? ps.label : "Không xác định",
        statusInfo: st || { label: "Không xác định", color: "secondary" },
        createdAtTime: moment(o.createdAt).format("HH:mm"),
        createdAtDate: moment(o.createdAt).format("DD/MM/YYYY"),
      };
    });

    res.render("admin/pages/super-admin/order-list", {
      pageTitle: "Tất cả Đơn hàng",
      orderList,
      pagination,
      keyword: req.query.keyword || "",
      paymentStatusFilter: req.query.paymentStatus || "",
      statusFilter: req.query.status || "",
      paymentMethodList,
      paymentStatusList,
      statusList,
    });
  } catch (error) {
    console.error("Super Admin - Order List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET: Chi tiết đơn hàng (Super Admin)
 */
module.exports.detail = async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await Order.findOne({
      _id: orderId,
      deleted: { $ne: true },
    })
      .populate("userId", "fullName email phone")
      .lean();

    if (!order) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/customers`);
    }

    // Populate thông tin tour cho từng item
    if (order.items && order.items.length > 0) {
      for (const item of order.items) {
        if (item.tourId) {
          const tour = await Tour.findOne({
            _id: item.tourId,
            deleted: { $ne: true },
          })
            .populate("companyId", "name")
            .populate("departureCity", "name")
            .lean();
          if (tour) {
            item.tour = tour;
            // Đảm bảo có thông tin pricing (ưu tiên từ item snapshot, fallback sang tour)
            if (!item.babyPricingMode) {
              item.babyPricingMode = tour.babyPricingMode || "fixed";
            }
            if (!item.babyPricingRules || !item.babyPricingRules.length) {
              item.babyPricingRules = tour.babyPricingRules || [];
            }
          }
        }
        
        // Populate departureCity nếu là ObjectId
        if (item.departureCity && typeof item.departureCity === 'object') {
          const city = await City.findById(item.departureCity).lean();
          if (city) {
            item.departureCity = city.name;
          }
        } else if (item.tour && item.tour.departureCity) {
          if (typeof item.tour.departureCity === 'object') {
            item.departureCity = item.tour.departureCity.name || "N/A";
          } else {
            item.departureCity = item.tour.departureCity;
          }
        }
      }
    }

    res.render("admin/pages/super-admin/order-detail", {
      pageTitle: `Đơn hàng: ${order.code}`,
      order,
    });
  } catch (error) {
    console.error("Super Admin - Order Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

