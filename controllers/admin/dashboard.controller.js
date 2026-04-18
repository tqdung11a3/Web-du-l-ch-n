// controllers/admin/dashboard.controller.js
const mongoose = require("mongoose");
const Company = require("../../models/company.model");
const AccountAdmin = require("../../models/account-admin.model");
const Order = require("../../models/order.model");
const Hotel = require("../../models/hotel.model");
const HotelBooking = require("../../models/hotel-booking.model");
const moment = require("moment");

module.exports.dashboard = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    const isScoped = !!companyId;

    // --- Đếm admin ---
    const adminFilter = { deleted: false, ...(isScoped ? { companyId } : {}) };
    const totalAdmin = await AccountAdmin.countDocuments(adminFilter);

    // --- Tổng số đơn & Doanh thu ---
    let totalOrder = 0;
    let totalRevenue = 0;

    if (isScoped) {
      const cId = mongoose.Types.ObjectId.isValid(String(companyId))
        ? new mongoose.Types.ObjectId(String(companyId))
        : companyId;

      // Số đơn có ÍT NHẤT 1 item thuộc công ty
      totalOrder = await Order.countDocuments({
        deleted: false,
        "items.companyId": cId,
      });

      // Doanh thu = cộng TIỀN CỦA CÁC ITEM thuộc công ty
      const agg = await Order.aggregate([
        { $match: { deleted: false, "items.companyId": cId } },
        { $unwind: "$items" },
        { $match: { "items.companyId": cId } },
        {
          $addFields: {
            lineTotal: {
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
            },
          },
        },
        { $group: { _id: null, sum: { $sum: "$lineTotal" } } },
      ]);
      totalRevenue = agg[0]?.sum || 0;
    } else {
      // Super admin: giữ logic cũ (tổng toàn hệ thống)
      const ord = await Order.find({ deleted: false }).select("total");
      totalOrder = ord.length;
      totalRevenue = ord.reduce((s, o) => s + (o.total || 0), 0);
    }

    // Tên công ty
    let companyName = res.locals.companyName || "";
    if (!companyName && isScoped) {
      const c = await Company.findById(companyId).select("name").lean();
      companyName = c?.name || "";
    }

    // ===== DỮ LIỆU HOTEL PERFORMANCE VÀ RECENT ACTIVITIES =====
    let hotelPerformance = [];
    let recentActivities = [];

    if (isScoped) {
      const cId = mongoose.Types.ObjectId.isValid(String(companyId))
        ? new mongoose.Types.ObjectId(String(companyId))
        : companyId;

      // Lấy danh sách hotels của company (bao gồm numberOfRooms)
      const hotels = await Hotel.find({ companyId: cId, deleted: false }).select("_id name numberOfRooms").lean();
      const hotelIds = hotels.map(h => h._id);
      const hotelNames = hotels.reduce((acc, h) => {
        acc[h._id.toString()] = h.name;
        return acc;
      }, {});

      // Tính toán thời gian (tháng hiện tại)
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      // Lấy hotel bookings trong tháng (match với hotels của company qua hotel name)
      // Vì HotelBooking không có companyId, ta sẽ match qua hotel name
      const hotelNamesList = Object.values(hotelNames);
      const bookings = await HotelBooking.find({
        status: { $in: ["pending", "confirmed"] },
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        "hotel.name": { $in: hotelNamesList }
      }).lean();

      // Tính toán performance cho từng hotel
      for (const hotel of hotels) {
        const hotelBookings = bookings.filter(b => {
          const bookingHotelName = b.hotel?.name || "";
          return bookingHotelName.trim().toLowerCase() === hotel.name.trim().toLowerCase();
        });
        
        // Doanh thu tháng (chỉ tính các booking đã thanh toán)
        const revenue = hotelBookings
          .filter(b => b.paymentStatus === "paid")
          .reduce((sum, b) => sum + (b.totalAmount || 0), 0);

        // Số đặt phòng
        const bookingCount = hotelBookings.length;

        // Tỷ lệ lấp đầy (tính dựa trên số đêm đã đặt)
        // Sử dụng số phòng thực tế từ hotel.numberOfRooms
        const totalNights = hotelBookings.reduce((sum, b) => sum + (b.totalNights || 0), 0);
        const totalRooms = hotel.numberOfRooms || 0;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const occupancyRate = totalRooms > 0 
          ? Math.min(100, Math.round((totalNights / (totalRooms * daysInMonth)) * 100))
          : 0;

        // Xu hướng (so với tháng trước)
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        const prevBookings = await HotelBooking.countDocuments({
          "hotel.name": { $regex: new RegExp(`^${hotel.name}$`, "i") },
          status: { $in: ["pending", "confirmed"] },
          createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd }
        });
        
        let trend = 0;
        if (prevBookings > 0) {
          trend = ((bookingCount - prevBookings) / prevBookings * 100);
        } else if (bookingCount > 0) {
          trend = 100; // Tăng 100% so với tháng trước (từ 0 lên bookingCount)
        }

        hotelPerformance.push({
          hotelId: hotel._id,
          hotelName: hotel.name,
          revenue,
          bookingCount,
          occupancyRate,
          trend: Math.round(trend * 10) / 10 // Làm tròn 1 chữ số thập phân
        });
      }

      // Sắp xếp theo doanh thu giảm dần
      hotelPerformance.sort((a, b) => b.revenue - a.revenue);

      // Lấy recent activities (hoạt động gần đây - 24 giờ qua)
      const recentBookings = await HotelBooking.find({
        "hotel.name": { $in: hotelNamesList },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

      recentActivities = recentBookings.map(booking => {
        const timeAgo = moment(booking.createdAt).fromNow();
        let activity = "";
        let color = "blue";

        if (booking.status === "confirmed" && booking.paymentStatus === "paid") {
          activity = `Thanh toán hoàn tất tại ${booking.hotel?.name || "Khách sạn"}`;
          color = "purple";
        } else if (booking.status === "confirmed") {
          activity = `Check-in khách tại ${booking.hotel?.name || "Khách sạn"}`;
          color = "green";
        } else if (booking.status === "pending") {
          activity = `Đặt phòng mới tại ${booking.hotel?.name || "Khách sạn"}`;
          color = "blue";
        } else if (booking.status === "cancelled") {
          activity = `Hủy đặt phòng tại ${booking.hotel?.name || "Khách sạn"}`;
          color = "red";
        }

        return {
          activity,
          timeAgo,
          color
        };
      });
    }

    return res.render("admin/pages/dashboard", {
      pageTitle: isScoped ? `Tổng quan - ${companyName}` : "Tổng quan",
      overview: { totalAdmin, totalOrder, totalRevenue },
      companyName,
      isScoped,
      hotelPerformance: hotelPerformance || [],
      recentActivities: recentActivities || [],
    });
  } catch (err) {
    console.error("dashboard error:", err);
    return res.render("admin/pages/dashboard", {
      pageTitle: "Tổng quan",
      overview: { totalAdmin: 0, totalOrder: 0, totalRevenue: 0 },
      companyName: "",
      isScoped: false,
      hotelPerformance: [],
      recentActivities: [],
    });
  }
};

module.exports.revenueChartPost = async (req, res) => {
  try {
    const { currentMonth, currentYear, prevMonth, prevYear, arrayDay } =
      req.body;
    const companyId = req.account?.companyId || null;

    const rangeOfMonth = (y, m) => ({
      start: new Date(Number(y), Number(m) - 1, 1, 0, 0, 0, 0),
      end: new Date(Number(y), Number(m), 1, 0, 0, 0, 0),
    });
    const rNow = rangeOfMonth(currentYear, currentMonth);
    const rPrev = rangeOfMonth(prevYear, prevMonth);

    const buildSeries = async (r) => {
      if (!companyId) {
        // Super admin (nếu gọi API không gắn company): chỉ đơn đã thanh toán
        const rows = await Order.aggregate([
          {
            $match: {
              deleted: false,
              paymentStatus: "paid",
              createdAt: { $gte: r.start, $lt: r.end },
            },
          },
          { $project: { d: { $dayOfMonth: "$createdAt" }, total: "$total" } },
          { $group: { _id: "$d", revenue: { $sum: "$total" } } },
        ]);
        return Object.fromEntries(
          rows.map((x) => [x._id, Number(x.revenue || 0)])
        );
      }

      // Company admin: chỉ cộng tiền item của công ty
      const cId = mongoose.Types.ObjectId.isValid(String(companyId))
        ? new mongoose.Types.ObjectId(String(companyId))
        : companyId;

      const rows = await Order.aggregate([
        {
          $match: {
            deleted: false,
            paymentStatus: "paid",
            createdAt: { $gte: r.start, $lt: r.end },
            "items.companyId": cId,
          },
        },
        { $unwind: "$items" },
        { $match: { "items.companyId": cId } },
        {
          $addFields: {
            day: { $dayOfMonth: "$createdAt" },
            lineTotal: {
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
            },
          },
        },
        { $group: { _id: "$day", revenue: { $sum: "$lineTotal" } } },
        { $sort: { _id: 1 } },
      ]);

      return Object.fromEntries(
        rows.map((x) => [x._id, Number(x.revenue || 0)])
      );
    };

    const curMap = await buildSeries(rNow);
    const prevMap = await buildSeries(rPrev);

    const dataCurrentMonth = arrayDay.map((d) => curMap[d] || 0);
    const dataPrevMonth = arrayDay.map((d) => prevMap[d] || 0);

    return res.json({
      code: "success",
      message: "Thành công!",
      dataCurrentMonth,
      dataPrevMonth,
    });
  } catch (err) {
    console.error("revenueChartPost error:", err);
    return res.json({
      code: "error",
      message: "Không lấy được dữ liệu biểu đồ!",
    });
  }
};
