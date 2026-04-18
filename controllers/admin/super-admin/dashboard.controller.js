// controllers/admin/super-admin/dashboard.controller.js
const mongoose = require("mongoose");
const Company = require("../../../models/company.model");
const Tour = require("../../../models/tour.model");
const Hotel = require("../../../models/hotel.model");
const Order = require("../../../models/order.model");
const HotelBooking = require("../../../models/hotel-booking.model");
const AccountAdmin = require("../../../models/account-admin.model");
const AccountUser = require("../../../models/account-user.model");

/** 12 tháng gần nhất (mỗi phần tử: { key: 'YYYY-MM', label: 'MM/YYYY', start, end }) */
function buildLast12MonthBuckets() {
  const now = new Date();
  const buckets = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    buckets.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${String(m).padStart(2, "0")}/${y}`,
      start,
      end,
    });
  }
  return buckets;
}

const orderItemLineTotal = {
  $add: [
    {
      $multiply: [
        { $ifNull: ["$items.quantityAdult", 0] },
        { $ifNull: ["$items.priceNewAdult", 0] },
      ],
    },
    {
      $multiply: [
        { $ifNull: ["$items.quantityChildren", 0] },
        { $ifNull: ["$items.priceNewChildren", 0] },
      ],
    },
    {
      $multiply: [
        { $ifNull: ["$items.quantityBaby", 0] },
        { $ifNull: ["$items.priceNewBaby", 0] },
      ],
    },
  ],
};

/**
 * Super Admin Dashboard - Tổng quan toàn hệ thống
 */
module.exports.index = async (req, res) => {
  try {
    const monthBuckets = buildLast12MonthBuckets();
    const rangeStart = monthBuckets[0].start;
    const rangeEnd = new Date();

    // Thống kê tổng quan
    const stats = {
      totalCompanies: await Company.countDocuments({ deleted: { $ne: true } }),
      activeCompanies: await Company.countDocuments({
        deleted: { $ne: true },
        status: "active",
      }),
      totalTours: await Tour.countDocuments({ deleted: { $ne: true } }),
      activeTours: await Tour.countDocuments({
        deleted: { $ne: true },
        status: "active",
      }),
      totalHotels: await Hotel.countDocuments({ deleted: { $ne: true } }),
      activeHotels: await Hotel.countDocuments({
        deleted: { $ne: true },
        status: "active",
      }),
      totalOrders: await Order.countDocuments({ deleted: { $ne: true } }),
      completedOrders: await Order.countDocuments({
        deleted: { $ne: true },
        paymentStatus: "paid",
        status: "done",
      }),
      totalRevenue: 0,
      totalCompanyAdmins: await AccountAdmin.countDocuments({
        deleted: { $ne: true },
        isSuperAdmin: { $ne: true },
      }),
      activeCompanyAdmins: await AccountAdmin.countDocuments({
        deleted: { $ne: true },
        isSuperAdmin: { $ne: true },
        status: "active",
      }),
      pendingCompanyAdmins: await AccountAdmin.countDocuments({
        deleted: { $ne: true },
        isSuperAdmin: { $ne: true },
        status: "initial",
      }),
      totalCustomers: await AccountUser.countDocuments({}),
    };

    res.locals.pendingAdminCount = stats.pendingCompanyAdmins;

    const revenueResult = await Order.aggregate([
      {
        $match: {
          deleted: { $ne: true },
          paymentStatus: "paid",
          status: "done",
        },
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]);
    stats.totalRevenue = revenueResult[0]?.total || 0;

    // --- Doanh thu TOUR theo công ty (cộng từng dòng item; chỉ đơn đã thanh toán — không yêu cầu status done) ---
    const tourRevenueByCompany = await Order.aggregate([
      {
        $match: {
          deleted: { $ne: true },
          paymentStatus: "paid",
        },
      },
      { $unwind: "$items" },
      {
        $addFields: {
          itemsCompanyOid: {
            $convert: {
              input: "$items.companyId",
              to: "objectId",
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $match: { itemsCompanyOid: { $ne: null } } },
      { $addFields: { lineTotal: orderItemLineTotal } },
      {
        $group: {
          _id: "$itemsCompanyOid",
          revenue: { $sum: "$lineTotal" },
          orderIds: { $addToSet: "$_id" },
        },
      },
      {
        $project: {
          revenue: 1,
          orderCount: { $size: "$orderIds" },
        },
      },
      {
        $lookup: {
          from: "companies",
          localField: "_id",
          foreignField: "_id",
          as: "company",
        },
      },
      { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
      { $sort: { revenue: -1 } },
      {
        $project: {
          companyId: { $toString: "$_id" },
          companyName: "$company.name",
          companyLogo: "$company.logo",
          revenue: 1,
          orderCount: 1,
        },
      },
    ]);

    // --- Chuỗi 12 tháng: tour (theo createdAt đơn hàng; chỉ paid — đồng bộ biểu đồ /admin/dashboard) ---
    const tourMonthlyAgg = await Order.aggregate([
      {
        $match: {
          deleted: { $ne: true },
          paymentStatus: "paid",
          createdAt: { $gte: rangeStart, $lte: rangeEnd },
        },
      },
      { $unwind: "$items" },
      {
        $addFields: {
          itemsCompanyOid: {
            $convert: {
              input: "$items.companyId",
              to: "objectId",
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $match: { itemsCompanyOid: { $ne: null } } },
      { $addFields: { lineTotal: orderItemLineTotal } },
      {
        $addFields: {
          ym: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" },
          },
        },
      },
      {
        $group: {
          _id: {
            companyId: "$itemsCompanyOid",
            ym: "$ym",
          },
          revenue: { $sum: "$lineTotal" },
        },
      },
    ]);

    // --- Chuỗi 12 tháng: theo từng khách sạn (hotelId) ---
    const hotelMonthlyAgg = await HotelBooking.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          status: { $ne: "cancelled" },
          createdAt: { $gte: rangeStart, $lte: rangeEnd },
        },
      },
      {
        $lookup: {
          from: "hotels",
          localField: "hotel.hotelId",
          foreignField: "_id",
          as: "hotelDoc",
        },
      },
      { $match: { "hotelDoc.0": { $exists: true } } },
      { $unwind: "$hotelDoc" },
      {
        $match: {
          "hotelDoc.deleted": { $ne: true },
          "hotelDoc.companyId": { $exists: true, $ne: null },
        },
      },
      {
        $addFields: {
          ym: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" },
          },
        },
      },
      {
        $group: {
          _id: {
            hotelId: "$hotelDoc._id",
            ym: "$ym",
          },
          revenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
        },
      },
    ]);

    // Tổng doanh thu + số booking trong 12 tháng (theo từng KS)
    const hotelStats12m = await HotelBooking.aggregate([
      {
        $match: {
          paymentStatus: "paid",
          status: { $ne: "cancelled" },
          createdAt: { $gte: rangeStart, $lte: rangeEnd },
        },
      },
      {
        $lookup: {
          from: "hotels",
          localField: "hotel.hotelId",
          foreignField: "_id",
          as: "hotelDoc",
        },
      },
      { $match: { "hotelDoc.0": { $exists: true } } },
      { $unwind: "$hotelDoc" },
      {
        $match: {
          "hotelDoc.deleted": { $ne: true },
          "hotelDoc.companyId": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$hotelDoc._id",
          revenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          bookingCount: { $sum: 1 },
        },
      },
    ]);

    const tourMonthMap = new Map();
    for (const row of tourMonthlyAgg) {
      const cid = String(row._id.companyId);
      const key = `${cid}|${row._id.ym}`;
      tourMonthMap.set(key, row.revenue);
    }

    const hotelIdMonthMap = new Map();
    for (const row of hotelMonthlyAgg) {
      const hid = String(row._id.hotelId);
      const key = `${hid}|${row._id.ym}`;
      hotelIdMonthMap.set(key, row.revenue);
    }

    const hotelStatsMap = new Map();
    for (const row of hotelStats12m) {
      hotelStatsMap.set(String(row._id), {
        revenue: row.revenue || 0,
        bookingCount: row.bookingCount || 0,
      });
    }

    const allCompanies = await Company.find({ deleted: { $ne: true } })
      .select("_id name logo status")
      .sort({ name: 1 })
      .lean();

    const allHotels = await Hotel.find({ deleted: { $ne: true } })
      .select("_id name companyId")
      .sort({ name: 1 })
      .lean();

    const hotelsByCompanyId = new Map();
    for (const h of allHotels) {
      const cid = String(h.companyId);
      if (!hotelsByCompanyId.has(cid)) hotelsByCompanyId.set(cid, []);
      hotelsByCompanyId.get(cid).push({
        _id: String(h._id),
        name: h.name || "Khách sạn",
      });
    }

    const monthLabels = monthBuckets.map((b) => b.label);

    const companiesWithCharts = allCompanies.map((c) => {
      const idStr = String(c._id);
      const tourByMonth = monthBuckets.map(
        (b) => tourMonthMap.get(`${idStr}|${b.key}`) || 0
      );
      const tourTotal = tourByMonth.reduce((s, v) => s + v, 0);
      return {
        _id: idStr,
        name: c.name,
        logo: c.logo || "",
        status: c.status,
        tourByMonth,
        tourTotal12m: tourTotal,
      };
    });

    const companiesWithHotelCharts = allCompanies.map((c) => {
      const cid = String(c._id);
      const hotelList = hotelsByCompanyId.get(cid) || [];
      const hotels = hotelList.map((h) => {
        const hotelByMonth = monthBuckets.map(
          (b) => hotelIdMonthMap.get(`${h._id}|${b.key}`) || 0
        );
        const st = hotelStatsMap.get(h._id) || {
          revenue: 0,
          bookingCount: 0,
        };
        return {
          _id: h._id,
          name: h.name,
          hotelByMonth,
          total12m: st.revenue,
          bookingCount12m: st.bookingCount,
        };
      });
      return {
        _id: cid,
        name: c.name,
        logo: c.logo || "",
        hotels,
      };
    });

    const pendingAdmins = await AccountAdmin.find({
      deleted: { $ne: true },
      isSuperAdmin: { $ne: true },
      status: "initial",
    })
      .populate("companyId", "name logo")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return res.render("admin/pages/super-admin/dashboard", {
      pageTitle: "Super Admin Dashboard",
      stats,
      tourRevenueByCompany,
      companiesWithCharts,
      companiesWithHotelCharts,
      monthLabels,
      pendingAdmins,
    });
  } catch (error) {
    console.error("Super Admin Dashboard Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};
