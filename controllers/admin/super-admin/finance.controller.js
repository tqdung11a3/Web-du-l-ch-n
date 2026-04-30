// controllers/admin/super-admin/finance.controller.js
const mongoose = require("mongoose");
const Company = require("../../../models/company.model");
const Order = require("../../../models/order.model");
const HotelBooking = require("../../../models/hotel-booking.model");
const Hotel = require("../../../models/hotel.model");
const moment = require("moment");

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

function parseDateRange(query) {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const start = query.startDate
    ? moment(query.startDate).startOf("day").toDate()
    : defaultStart;
  const end = query.endDate
    ? moment(query.endDate).endOf("day").toDate()
    : now;
  return { start, end };
}

async function aggregateTourRevenue({ start, end, companyId }) {
  const match = {
    deleted: { $ne: true },
    paymentStatus: "paid",
    createdAt: { $gte: start, $lte: end },
  };
  const pipeline = [
    { $match: match },
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
  ];
  if (companyId) {
    pipeline.push({
      $match: {
        itemsCompanyOid: new mongoose.Types.ObjectId(companyId),
      },
    });
  }
  pipeline.push(
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
    { $sort: { revenue: -1 } }
  );
  return await Order.aggregate(pipeline);
}

async function aggregateHotelRevenue({ start, end, companyId }) {
  // Lấy hotels kèm companyId để map
  const hotelFilter = { deleted: { $ne: true } };
  if (companyId) hotelFilter.companyId = companyId;
  const hotels = await Hotel.find(hotelFilter).select("_id companyId").lean();
  const hotelIds = hotels.map((h) => h._id);
  const hotelCompany = Object.fromEntries(
    hotels.map((h) => [String(h._id), String(h.companyId || "")])
  );

  const bookings = await HotelBooking.aggregate([
    {
      $match: {
        deleted: { $ne: true },
        paymentStatus: "paid",
        "hotel.hotelId": { $in: hotelIds },
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $project: {
        hotelId: "$hotel.hotelId",
        totalAmount: { $ifNull: ["$totalAmount", 0] },
      },
    },
  ]);

  // Gộp theo companyId
  const byCompany = {};
  for (const b of bookings) {
    const cid = hotelCompany[String(b.hotelId)] || "";
    if (!cid) continue;
    if (!byCompany[cid])
      byCompany[cid] = { revenue: 0, bookingCount: 0, companyId: cid };
    byCompany[cid].revenue += b.totalAmount || 0;
    byCompany[cid].bookingCount += 1;
  }

  const ids = Object.keys(byCompany).map((c) => new mongoose.Types.ObjectId(c));
  const cos = await Company.find({ _id: { $in: ids } })
    .select("_id name logo")
    .lean();
  const coMap = Object.fromEntries(cos.map((c) => [String(c._id), c]));

  return Object.values(byCompany)
    .map((it) => ({
      ...it,
      company: coMap[it.companyId] || null,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * GET /admin/super-admin/finance
 */
module.exports.index = async (req, res) => {
  try {
    const { start, end } = parseDateRange(req.query);
    const companyId = req.query.companyId || "";
    const type = req.query.type || "all"; // 'tour'|'hotel'|'all'

    const allCompanies = await Company.find({ deleted: false })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    const [tourAgg, hotelAgg] =
      type === "hotel"
        ? [[], await aggregateHotelRevenue({ start, end, companyId })]
        : type === "tour"
        ? [await aggregateTourRevenue({ start, end, companyId }), []]
        : [
            await aggregateTourRevenue({ start, end, companyId }),
            await aggregateHotelRevenue({ start, end, companyId }),
          ];

    // Gộp theo công ty để ra bảng tổng
    const merged = new Map();
    for (const t of tourAgg) {
      const cid = String(t._id);
      const name = t.company ? t.company.name : "(đã xoá)";
      const logo = t.company ? t.company.logo : "";
      merged.set(cid, {
        companyId: cid,
        companyName: name,
        companyLogo: logo,
        tourRevenue: t.revenue || 0,
        tourOrderCount: t.orderCount || 0,
        hotelRevenue: 0,
        hotelBookingCount: 0,
      });
    }
    for (const h of hotelAgg) {
      const cid = h.companyId;
      const row = merged.get(cid) || {
        companyId: cid,
        companyName: h.company ? h.company.name : "(đã xoá)",
        companyLogo: h.company ? h.company.logo : "",
        tourRevenue: 0,
        tourOrderCount: 0,
        hotelRevenue: 0,
        hotelBookingCount: 0,
      };
      row.hotelRevenue = h.revenue || 0;
      row.hotelBookingCount = h.bookingCount || 0;
      merged.set(cid, row);
    }

    const rows = Array.from(merged.values()).map((r) => ({
      ...r,
      totalRevenue: (r.tourRevenue || 0) + (r.hotelRevenue || 0),
    }));
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totals = rows.reduce(
      (acc, r) => {
        acc.tourRevenue += r.tourRevenue;
        acc.hotelRevenue += r.hotelRevenue;
        acc.tourOrderCount += r.tourOrderCount;
        acc.hotelBookingCount += r.hotelBookingCount;
        return acc;
      },
      { tourRevenue: 0, hotelRevenue: 0, tourOrderCount: 0, hotelBookingCount: 0 }
    );
    totals.totalRevenue = totals.tourRevenue + totals.hotelRevenue;

    // Export CSV
    if (req.query.export === "csv") {
      const lines = [
        "Công ty,Doanh thu tour,Số đơn tour,Doanh thu khách sạn,Số booking,Tổng doanh thu",
      ];
      for (const r of rows) {
        lines.push(
          [
            '"' + (r.companyName || "").replace(/"/g, '""') + '"',
            r.tourRevenue,
            r.tourOrderCount,
            r.hotelRevenue,
            r.hotelBookingCount,
            r.totalRevenue,
          ].join(",")
        );
      }
      lines.push(
        [
          '"TỔNG"',
          totals.tourRevenue,
          totals.tourOrderCount,
          totals.hotelRevenue,
          totals.hotelBookingCount,
          totals.totalRevenue,
        ].join(",")
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=finance-${moment(start).format("YYYYMMDD")}-${moment(
          end
        ).format("YYYYMMDD")}.csv`
      );
      return res.send("\ufeff" + lines.join("\n"));
    }

    res.render("admin/pages/super-admin/finance", {
      pageTitle: "Báo cáo doanh thu",
      allCompanies,
      rows,
      totals,
      startDate: moment(start).format("YYYY-MM-DD"),
      endDate: moment(end).format("YYYY-MM-DD"),
      companyFilter: companyId,
      typeFilter: type,
    });
  } catch (error) {
    console.error("Super Admin Finance Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};
