// controllers/admin/hotel.controller.js

const Hotel = require("../../models/hotel.model");
const AccountAdmin = require("../../models/account-admin.model");
const City = require("../../models/city.model");
const HotelReview = require("../../models/hotel-review.model");
const HotelBooking = require("../../models/hotel-booking.model");
const moment = require("moment");
const { pathAdmin } = require("../../config/variable.config");

// ============== Helpers chung ==============
const toArr = (v) =>
  Array.isArray(v) ? v : v !== undefined && v !== null && v !== "" ? [v] : [];

// tách textarea nhiều dòng thành mảng
function parseLines(str) {
  return (str || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

// amenities: tách chuỗi bằng dấu phẩy
function parseAmenities(str) {
  return (str || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// Map category sang icon FontAwesome
function getFacilityIconByCategory(category) {
  const iconMap = {
    internet: "fa-wifi",
    relaxation: "fa-spa",
    services: "fa-concierge-bell",
    safety: "fa-shield-alt",
    food: "fa-utensils",
    children: "fa-child",
    accessibility: "fa-wheelchair",
    transport: "fa-car",
    language: "fa-language",
    other: "fa-star"
  };
  return iconMap[category] || iconMap.other;
}

// roomTypeNames, roomTypeMaxGuests,... có thể là string HOẶC array
function parseRoomTypes(body = {}) {
  const names = toArr(body.roomTypeNames);
  const basePrices = toArr(body.roomTypeBasePrices);
  const descriptions = toArr(body.roomTypeDescriptions);
  const sizes = toArr(body.roomTypeSizes);
  const bedInfos = toArr(body.roomTypeBedInfos);
  const views = toArr(body.roomTypeViews);
  const smokingPolicies = toArr(body.roomTypeSmokingPolicies);
  const bathroomAmenities = toArr(body.roomTypeBathroomAmenities);
  const roomAmenities = toArr(body.roomTypeRoomAmenities);
  
  // Occupancy fields
  const baseOccupancies = toArr(body.roomTypeBaseOccupancies);
  const maxOccupancies = toArr(body.roomTypeMaxOccupancies);
  const maxExtraBedsList = toArr(body.roomTypeMaxExtraBeds);
  const extraBedFees = toArr(body.roomTypeExtraBedFees);

  const result = [];
  
  // Parse amenities: giả sử amenities được gửi liên tiếp cho từng phòng
  // Cần đếm số lượng amenities cho mỗi phòng
  // Tạm thời: phân bổ đều amenities cho tất cả phòng (sẽ cải thiện sau nếu cần)
  // Hoặc có thể gửi kèm số lượng amenities trong form submission
  
  let bathroomAmenityIndex = 0;
  let roomAmenityIndex = 0;
  
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    
    const sizeM2 = sizes[i] ? parseInt(sizes[i]) : null;
    
    // Lấy amenities cho phòng này
    // Giả sử amenities được gửi liên tiếp, mỗi phòng có số lượng amenities khác nhau
    // Tạm thời: lấy tất cả amenities và phân bổ đều (hoặc có thể cải thiện logic này)
    // Để đơn giản, ta sẽ lưu tất cả amenities vào mỗi phòng
    // Nếu cần phân bổ chính xác, có thể gửi kèm số lượng amenities cho mỗi phòng
    
    result.push({
      name: names[i],
      basePrice: parseInt(basePrices[i]) || 0,
      description: descriptions[i] || "",
      sizeM2: sizeM2,
      bedInfo: bedInfos[i] || "",
      view: views[i] || "",
      smokingPolicy: smokingPolicies[i] || "",
      bathroomAmenities: [], // Sẽ được cập nhật sau
      roomAmenities: [], // Sẽ được cập nhật sau
      
      // Occupancy
      baseOccupancy: parseInt(baseOccupancies[i]) || 2,
      maxOccupancy: parseInt(maxOccupancies[i]) || 3,
      maxExtraBeds: parseInt(maxExtraBedsList[i]) || 1,
      extraBedFeePerNight: parseInt(extraBedFees[i]) || 0,
    });
  }
  
  // Phân bổ amenities: tạm thời lấy tất cả amenities cho tất cả phòng
  // (Có thể cải thiện logic này nếu cần phân bổ chính xác)
  result.forEach((room) => {
    room.bathroomAmenities = [...bathroomAmenities];
    room.roomAmenities = [...roomAmenities];
  });
  
  return result;
}

// FAQ: từ 2 mảng câu hỏi + trả lời => array {question, answer}
function parseFaqs(body = {}) {
  const qs = toArr(body.faqQuestions);
  const as = toArr(body.faqAnswers);
  const len = Math.max(qs.length, as.length);
  const result = [];

  for (let i = 0; i < len; i++) {
    const q = (qs[i] || "").trim();
    const a = (as[i] || "").trim();
    if (!q && !a) continue;
    result.push({ question: q, answer: a });
  }
  return result;
}

// Parse Age Bands từ form data
function parseAgeBands(body = {}) {
  const bandNames = toArr(body.ageBandNames);
  const minAges = toArr(body.ageBandMinAges);
  const maxAges = toArr(body.ageBandMaxAges);
  const bandTypes = toArr(body.ageBandTypes);
  
  // C.1 - Occupancy counting
  const countInOccupancies = toArr(body.ageBandCountInOccupancies);
  const occupancyWeights = toArr(body.ageBandOccupancyWeights);
  
  // C.2 - Breakfast (Khách hàng tự chọn đăng ký, admin chỉ cấu hình phí)
  const breakfastIsFrees = toArr(body.ageBandBreakfastIsFrees);
  const breakfastFees = toArr(body.ageBandBreakfastFees);
  
  // C.3 - Extra person charge (chỉ hiện khi countInOccupancy = true)
  const extraPersonFeePerNights = toArr(body.ageBandExtraPersonFeePerNights);

  const result = [];
  
  for (let i = 0; i < bandNames.length; i++) {
    const name = (bandNames[i] || "").trim();
    if (!name) continue;
    
    const minAge = parseInt(minAges[i]) || 0;
    const maxAgeStr = (maxAges[i] || "").trim();
    const maxAge = maxAgeStr === "" || maxAgeStr === "unlimited" ? null : parseInt(maxAges[i]);
    
    const band = {
      bandName: name,
      minAge: minAge,
      maxAge: maxAge,
      bandType: bandTypes[i] || "other",
      
      // C.1
      countInOccupancy: countInOccupancies[i] === "on" || countInOccupancies[i] === "true",
      occupancyWeight: parseFloat(occupancyWeights[i]) || 1,
      
      // C.2 (Khách hàng tự chọn đăng ký, admin chỉ cấu hình phí)
      breakfastIsFree: breakfastIsFrees[i] === "free" || breakfastIsFrees[i] === "true" || breakfastIsFrees[i] === "",
      breakfastFeePerPersonPerMeal: breakfastIsFrees[i] === "paid" ? (parseInt(breakfastFees[i]) || 0) : 0,
      
      // C.3 - Extra person charge (chỉ hiện khi countInOccupancy = true)
      // Nếu countInOccupancy = true thì tự động áp dụng phụ thu
      applyExtraPersonFee: countInOccupancies[i] === "on" || countInOccupancies[i] === "true",
      extraPersonFeePerNight: parseInt(extraPersonFeePerNights[i]) || 0,
    };
    
    result.push(band);
  }
  
  return result;
}

// Ép các field number (nếu có)
function normalizeNumeric(body, keys = []) {
  keys.forEach((k) => {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") {
      const v = Number(body[k]);
      body[k] = Number.isNaN(v) ? undefined : v;
    }
  });
}

// Tìm 1 roomType trong hotel theo roomId
function findRoomTypeById(hotelDoc, roomId) {
  if (!hotelDoc || !hotelDoc.roomTypes) return null;
  const idStr = String(roomId);

  // Nếu dùng subdocument của Mongoose
  if (typeof hotelDoc.roomTypes.id === "function") {
    const found = hotelDoc.roomTypes.id(idStr);
    if (found) return found;
  }

  // Fallback: so sánh _id hoặc index (phòng trường hợp cũ chưa có _id)
  const found2 = hotelDoc.roomTypes.find((rt, idx) => {
    return String(rt._id) === idStr || String(idx) === idStr;
  });

  return found2 || null;
}

// ============== LIST ==============
module.exports.overview = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    // Dữ liệu fix cứng theo ảnh
    const overviewData = {
      // Summary cards hàng 1
      bookingsToday: 12,
      checkInsToday: 8,
      checkOutsToday: 5,
      occupancyRate: 78,
      
      // Summary cards hàng 2
      revenueToday: 116000000, // 116.000.000₫
      roomsToClean: 15,
      maintenance: 3,
      
      // Khách đến hôm nay
      arrivalsToday: [
        {
          bookingId: "BK-1234",
          status: "Đã xác nhận",
          statusColor: "blue",
          guestName: "Nguyễn Thị Hoa",
          roomNumber: "301",
          roomType: "Deluxe King",
          arrivalTime: "14:00"
        },
        {
          bookingId: "BK-1235",
          status: "Đã xác nhận",
          statusColor: "blue",
          guestName: "Trần Văn Nam",
          roomNumber: "405",
          roomType: "Suite",
          arrivalTime: "15:30"
        },
        {
          bookingId: "BK-1236",
          status: "Chờ xác nhận",
          statusColor: "yellow",
          guestName: "Lê Minh Anh",
          roomNumber: "TBA",
          roomType: "Standard Queen",
          arrivalTime: "16:00"
        }
      ],
      
      // Khách trả phòng hôm nay
      checkoutsToday: [
        {
          bookingId: "BK-1201",
          status: "Đã nhận phòng",
          statusColor: "green",
          guestName: "Phạm Văn Đức",
          roomNumber: "202",
          roomType: "Deluxe King",
          checkoutTime: "11:00"
        },
        {
          bookingId: "BK-1202",
          status: "Đã nhận phòng",
          statusColor: "green",
          guestName: "Hoàng Thu Hà",
          roomNumber: "308",
          roomType: "Suite",
          checkoutTime: "10:30"
        }
      ],
      
      // Thanh toán chờ xử lý
      pendingPayments: [
        {
          bookingId: "BK-1240",
          status: "Chờ xác nhận",
          statusColor: "yellow",
          guestName: "Vũ Minh Tuấn",
          totalAmount: 10800000,
          remainingAmount: 10800000
        },
        {
          bookingId: "BK-1241",
          status: "Đã thanh toán 1 phần",
          statusColor: "orange",
          guestName: "Đặng Thu Hương",
          totalAmount: 16320000,
          remainingAmount: 4800000
        }
      ]
    };

    return res.render("admin/pages/hotel-overview", {
      pageTitle: "Tổng quan",
      overviewData,
      pathAdmin,
    });
  } catch (error) {
    console.error("hotel overview error:", error);
    return res.render("admin/pages/hotel-overview", {
      pageTitle: "Tổng quan",
      overviewData: null,
      pathAdmin,
    });
  }
};

module.exports.dashboard = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;

    if (!companyId) {
      return res.render("admin/pages/hotel-dashboard", {
        pageTitle: "Dashboard",
        dashboardData: null,
        pathAdmin,
        hotelList: [],
        selectedHotelId: null,
        isBookingManagement: true,
      });
    }

    // Lấy tất cả khách sạn của company để hiển thị selector
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name rooms")
      .lean();

    if (!hotels || hotels.length === 0) {
      return res.render("admin/pages/hotel-dashboard", {
        pageTitle: "Dashboard",
        dashboardData: null,
        pathAdmin,
        hotelList: [],
        selectedHotelId: null,
        isBookingManagement: true,
      });
    }

    // Lấy hotelId từ query, nếu chưa có thì redirect với hotel đầu tiên
    let selectedHotelId = req.query.hotelId || null;
    if (!selectedHotelId || selectedHotelId === "all") {
      selectedHotelId = String(hotels[0]._id);
      const urlParams = new URLSearchParams(req.query);
      urlParams.set("hotelId", selectedHotelId);
      return res.redirect(`/${pathAdmin}/hotel/dashboard?${urlParams.toString()}`);
    }

    // Lấy thông tin hotel được chọn
    const selectedHotel = hotels.find(h => String(h._id) === String(selectedHotelId));
    if (!selectedHotel) {
      return res.render("admin/pages/hotel-dashboard", {
        pageTitle: "Dashboard",
        dashboardData: null,
        pathAdmin,
        hotelList: hotels.map(h => ({ _id: h._id, name: h.name })),
        selectedHotelId,
        isBookingManagement: true,
      });
    }

    // Lấy tất cả bookings của hotel được chọn
    const allBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Tính toán metrics
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Bookings tháng này
    const currentMonthBookings = allBookings.filter(b => new Date(b.createdAt) >= startOfMonth);
    // Bookings tháng trước
    const lastMonthBookings = allBookings.filter(b => {
      const createdAt = new Date(b.createdAt);
      return createdAt >= startOfLastMonth && createdAt <= endOfLastMonth;
    });

    // Helper function để extract base code
    const extractBaseCode = (code) => {
      let baseCode = code;
      baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
      while (baseCode.match(/-\d+$/)) {
        baseCode = baseCode.replace(/-\d+$/, '');
      }
      return baseCode;
    };

    // Tính tổng revenue tháng này (group theo mã gốc để tránh cộng trùng)
    const currentMonthRevenueGroups = {};
    currentMonthBookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!currentMonthRevenueGroups[baseCode]) {
        currentMonthRevenueGroups[baseCode] = Number(b.orderTotal || b.totalAmount || 0);
      }
    });
    const totalRevenue = Object.values(currentMonthRevenueGroups).reduce((sum, amount) => sum + amount, 0);
    
    const lastMonthRevenueGroups = {};
    lastMonthBookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!lastMonthRevenueGroups[baseCode]) {
        lastMonthRevenueGroups[baseCode] = Number(b.orderTotal || b.totalAmount || 0);
      }
    });
    const lastMonthRevenue = Object.values(lastMonthRevenueGroups).reduce((sum, amount) => sum + amount, 0);
    const revenueTrend = lastMonthRevenue > 0 ? Math.round(((totalRevenue - lastMonthRevenue) / lastMonthRevenue) * 100) : 0;

    // Tính tổng bookings (group theo mã gốc để tránh đếm trùng)
    const currentMonthBookingGroups = {};
    currentMonthBookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!currentMonthBookingGroups[baseCode]) {
        currentMonthBookingGroups[baseCode] = true;
      }
    });
    const totalBookings = Object.keys(currentMonthBookingGroups).length;
    
    const lastMonthBookingGroups = {};
    lastMonthBookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!lastMonthBookingGroups[baseCode]) {
        lastMonthBookingGroups[baseCode] = true;
      }
    });
    const lastMonthBookingsCount = Object.keys(lastMonthBookingGroups).length;
    const bookingsTrend = lastMonthBookingsCount > 0 ? Math.round(((totalBookings - lastMonthBookingsCount) / lastMonthBookingsCount) * 100) : 0;

    // Group bookings theo mã gốc (loại bỏ tất cả suffix) để tránh trùng lặp
    const bookingGroups = {};
    allBookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!bookingGroups[baseCode]) {
        bookingGroups[baseCode] = b; // Lưu booking đầu tiên (mới nhất) của mỗi group
      }
    });

    // Chuyển groups thành array và sắp xếp theo thời gian tạo (mới nhất trước)
    const uniqueBookings = Object.values(bookingGroups).sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Recent activities (5 hoạt động gần nhất - đã được group)
    const recentActivities = uniqueBookings.slice(0, 5).map(b => {
      let activity = "";
      let color = "blue";
      
      if (b.status === "pending") {
        activity = `Đặt phòng mới - ${b.guest?.fullName || "Khách"}`;
        color = "blue";
      } else if (b.status === "checked_in") {
        activity = `Check-in - ${b.guest?.fullName || "Khách"}`;
        color = "green";
      } else if (b.status === "checked_out") {
        activity = `Check-out - ${b.guest?.fullName || "Khách"}`;
        color = "purple";
      } else if (b.status === "cancelled") {
        activity = `Hủy đặt phòng - ${b.guest?.fullName || "Khách"}`;
        color = "red";
      }
      
      const timeAgo = moment(b.createdAt).fromNow();
      return { activity, timeAgo, color };
    });

    const dashboardData = {
      totalHotels: 1, // Chỉ hiển thị 1 hotel được chọn
      totalRevenue,
      revenueTrend,
      totalBookings,
      bookingsTrend,
      hotelPerformance: [], // Không cần vì chỉ hiển thị 1 hotel
      topBookingSources: [
        { source: "Website", count: Object.keys(bookingGroups).length }
      ],
      recentActivities,
    };

    return res.render("admin/pages/hotel-dashboard", {
      pageTitle: `Dashboard - ${selectedHotel.name}`,
      dashboardData,
      pathAdmin,
      hotelList: hotels.map(h => ({ _id: h._id, name: h.name })),
      selectedHotelId,
      isBookingManagement: true, // dùng để ẩn 'Tất cả khách sạn' trong selector
    });
  } catch (error) {
    console.error("hotel dashboard error:", error);
    return res.render("admin/pages/hotel-dashboard", {
      pageTitle: "Dashboard",
      dashboardData: null,
      pathAdmin,
      hotelList: [],
      selectedHotelId: null,
      isBookingManagement: true,
    });
  }
};

module.exports.list = async (req, res) => {
  try {
    const companyId = req.account && req.account.companyId;
    const find = { deleted: false };
    if (companyId) find.companyId = companyId;
    
    // Lấy tất cả hotels của company
    const allHotels = await Hotel.find(find).sort({ createdAt: "desc" }).lean();
    
    // Nếu không có hotelId trong URL, redirect đến hotel đầu tiên
    if (!req.query.hotelId && allHotels.length > 0) {
      const firstHotelId = allHotels[0]._id;
      return res.redirect(`/${pathAdmin}/hotel/list?hotelId=${firstHotelId}`);
    }
    
    // Lọc hotels để hiển thị theo hotelId
    let selectedHotelId = req.query.hotelId;
    let hotelList = allHotels;
    
    if (selectedHotelId) {
      // Kiểm tra xem hotelId có thuộc company này không
      const hotelExists = allHotels.some(h => String(h._id) === String(selectedHotelId));
      
      if (!hotelExists && allHotels.length > 0) {
        // Nếu hotelId không thuộc company này, redirect về hotel đầu tiên
        const firstHotelId = allHotels[0]._id;
        return res.redirect(`/${pathAdmin}/hotel/list?hotelId=${firstHotelId}`);
      }
      
      hotelList = allHotels.filter(h => String(h._id) === String(selectedHotelId));
    }

    // Populate data cho các hotels được lọc
    const hotelIds = hotelList.map(h => h._id);
    const populatedHotels = await Hotel.find({ _id: { $in: hotelIds } })
      .populate('province', 'name') // Populate tỉnh thành
      .sort({ createdAt: "desc" });
    
    // Lấy điểm trung bình từ reviews cho tất cả hotels
    const reviewsStats = await HotelReview.aggregate([
      {
        $match: {
          hotelId: { $in: hotelIds },
          deleted: false,
        },
      },
      {
        $group: {
          _id: "$hotelId",
          avgRating: { $avg: "$ratingOverall" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Tạo map để tra cứu nhanh
    const ratingMap = {};
    reviewsStats.forEach((stat) => {
      ratingMap[String(stat._id)] = {
        avg: Math.round(stat.avgRating * 10) / 10,
        count: stat.count,
      };
    });

    for (const item of populatedHotels) {
      if (item.createdBy) {
        const acc = await AccountAdmin.findOne({ _id: item.createdBy });
        if (acc) item.createdByFullName = acc.fullName;
      }

      if (item.updatedBy) {
        const acc = await AccountAdmin.findOne({ _id: item.updatedBy });
        if (acc) item.updatedByFullName = acc.fullName;
      }

      item.createdAtFormat = moment(item.createdAt).format(
        "HH:mm - DD/MM/YYYY"
      );
      item.updatedAtFormat = moment(item.updatedAt).format(
        "HH:mm - DD/MM/YYYY"
      );

      // Gắn điểm đánh giá trung bình
      const ratingInfo = ratingMap[String(item._id)];
      if (ratingInfo && ratingInfo.avg > 0) {
        item.ratingAverage = ratingInfo.avg;
        item.ratingCount = ratingInfo.count;
      } else {
        item.ratingAverage = null;
        item.ratingCount = 0;
      }
      
      // Gắn tên tỉnh thành
      if (item.province && item.province.name) {
        item.cityName = item.province.name;
      } else {
        item.cityName = null;
      }
    }

    res.render("admin/pages/hotel-list", {
      pageTitle: "Quản lý khách sạn",
      hotelList: populatedHotels, // Hotels được filter để hiển thị trong table
      selectedHotelId: req.query.hotelId || null,
      // res.locals.hotelList từ middleware sẽ được dùng cho hotel-selector dropdown
    });
  } catch (error) {
    console.log("admin hotel list error:", error);
    res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== CREATE GET ==============
module.exports.create = async (req, res) => {
  try {
    // Lấy danh sách tỉnh thành trong nước (Việt Nam) - giống tour
    const cityList = await City.find({
      $or: [
        { countryId: null },
        { countryName: { $exists: false } },
        { countryName: "" },
      ],
      deleted: { $ne: true },
    }).sort({ name: 1 });

    res.render("admin/pages/hotel-create", {
      pageTitle: "Thêm khách sạn",
      hotelDetail: {}, // dùng chung cho create + edit
      cityList,
    });
  } catch (error) {
    console.log("admin hotel create error:", error);
    res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== TRASH LIST ==============
module.exports.trash = async (req, res) => {
  try {
    const companyId = req.account && req.account.companyId;
    const find = { deleted: true };
    if (companyId) find.companyId = companyId;

    const hotelList = await Hotel.find(find).sort({ deletedAt: "desc" });

    for (const item of hotelList) {
      if (item.createdBy) {
        const acc = await AccountAdmin.findOne({ _id: item.createdBy });
        if (acc) item.createdByFullName = acc.fullName;
      }

      if (item.deletedBy) {
        const acc = await AccountAdmin.findOne({ _id: item.deletedBy });
        if (acc) item.deletedByFullName = acc.fullName;
      }

      item.createdAtFormat = moment(item.createdAt).format(
        "HH:mm - DD/MM/YYYY"
      );
      item.deletedAtFormat = moment(item.deletedAt).format(
        "HH:mm - DD/MM/YYYY"
      );
    }

    res.render("admin/pages/hotel-trash", {
      pageTitle: "Thùng rác khách sạn",
      hotelList,
    });
  } catch (error) {
    console.log("admin hotel trash error:", error);
    res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== CREATE POST ==============
module.exports.createPost = async (req, res) => {
  try {
    const companyId = req.account && req.account.companyId;
    if (!companyId) {
      res.json({
        code: "error",
        message: "Không xác định được công ty của admin!",
      });
      return;
    }

    // Chuẩn hóa numeric cơ bản
    normalizeNumeric(req.body, [
      "starRating",
      "basePrice",
      "ratingOverall",
      "ratingCount",
      "ratingLocation",
      "ratingCleanliness",
      "ratingFacilities",
      "ratingService",
      "ratingValue",
      "numberOfRooms",
    ]);

    req.body.currency = req.body.currency || "VND";
    req.body.status = req.body.status || "active";
    req.body.isFeatured =
      req.body.isFeatured === "on" || req.body.isFeatured === "true";

    // Parse danh sách
    // Parse amenities: từ arrays thành array of objects
    const amenityNames = toArr(req.body.amenityNames);
    const amenityFeaturesArrays = toArr(req.body.amenityFeatures);
    
    req.body.amenities = [];
    for (let i = 0; i < amenityNames.length; i++) {
      const name = (amenityNames[i] || "").trim();
      if (!name) continue; // Bỏ qua nếu không có tên
      
      const featuresText = amenityFeaturesArrays[i] || "";
      const features = parseLines(featuresText);
      
      req.body.amenities.push({
        name,
        icon: "", // Không dùng nữa
        description: "", // Không dùng nữa
        features
      });
    }
    
    req.body.roomTypes = parseRoomTypes(req.body);
    
    // Parse facilities: từ arrays thành array of objects
    const facilityNames = toArr(req.body.facilityNames);
    const facilityCategories = toArr(req.body.facilityCategories);
    const uploadedFacilityImages = req.files && req.files.facilityImages ? req.files.facilityImages : [];
    
    req.body.facilities = [];
    for (let i = 0; i < facilityNames.length; i++) {
      const name = (facilityNames[i] || "").trim();
      if (!name) continue; // Bỏ qua nếu không có tên
      
      const category = (facilityCategories[i] || "other").trim();
      const icon = getFacilityIconByCategory(category); // Tự động set icon dựa trên category
      const imageFile = uploadedFacilityImages[i];
      const image = imageFile ? imageFile.path : "";
      
      req.body.facilities.push({
        name,
        icon,
        image,
        category,
        isAvailable: true // Mặc định là có sẵn
      });
    }
    
    // Parse highlights: từ array of images (upload) và titles thành array of objects
    const highlightTitles = toArr(req.body.highlightTitles);
    const uploadedHighlightImages = req.files && req.files.highlightImages ? req.files.highlightImages : [];
    req.body.highlights = [];
    
    const maxItems = Math.max(highlightTitles.length, uploadedHighlightImages.length);
    
    for (let i = 0; i < maxItems; i++) {
      const title = (highlightTitles[i] || "").trim();
      const imageFile = uploadedHighlightImages[i];
      const image = imageFile ? imageFile.path : "";
      
      if (image || title) {
        req.body.highlights.push({ image, title });
      }
    }
    
    req.body.transportOptions = parseLines(req.body.transportOptions);
    req.body.faqs = parseFaqs(req.body);
    
    // Parse Age Bands (Mức tuổi)
    req.body.ageBands = parseAgeBands(req.body);
    
    // Parse childrenPolicy (GIỮ LẠI ĐỂ TƯƠNG THÍCH NGƯỢC - nhưng ưu tiên dùng ageBands)
    req.body.childrenPolicy = {
      infant0to1: {
        freeWithExistingBed: req.body.infant0to1FreeWithExistingBed === "on",
        cribAvailable: req.body.infant0to1CribAvailable === "on",
        note: (req.body.infant0to1Note || "").trim()
      },
      child2to5: {
        freeWithExistingBed: req.body.child2to5FreeWithExistingBed === "on",
        extraBedCharge: parseInt(req.body.child2to5ExtraBedCharge) || 0,
        note: (req.body.child2to5Note || "").trim()
      },
      guest6Plus: {
        consideredAdult: req.body.guest6PlusConsideredAdult === "on",
        extraBedRequired: req.body.guest6PlusExtraBedRequired === "on",
        extraBedCharge: parseInt(req.body.guest6PlusExtraBedCharge) || 0,
        note: (req.body.guest6PlusNote || "").trim()
      }
    };
    
    // Parse usefulInfo
    req.body.usefulInfo = {
      distanceFromCityCenter: (req.body.distanceFromCityCenter || "").trim(),
      timeToAirport: (req.body.timeToAirport || "").trim(),
      airportTransferFee: parseInt(req.body.airportTransferFee) || 0,
      wifiFee: parseInt(req.body.wifiFee) || 0,
      breakfastFee: parseInt(req.body.breakfastFee) || 0,
      builtYear: parseInt(req.body.builtYear) || 0,
      numberOfFloors: parseInt(req.body.numberOfFloors) || 0,
      inRoomVoltage: (req.body.inRoomVoltage || "").trim(),
      nonSmokingRooms: req.body.nonSmokingRooms === "on",
      numberOfRestaurants: parseInt(req.body.numberOfRestaurants) || 0,
      numberOfBars: parseInt(req.body.numberOfBars) || 0,
      licenseNumber: (req.body.licenseNumber || "").trim()
    };

    // Xử lý phone và googleMapsLink
    req.body.phone = (req.body.phone || "").trim();
    req.body.googleMapsLink = (req.body.googleMapsLink || "").trim();
    
    // Xử lý tỉnh thành
    if (req.body.province) {
      req.body.province = req.body.province.trim() || null;
    } else {
      req.body.province = null;
    }
    
    // Xử lý Nhận phòng sớm và Trả phòng muộn
    req.body.earlyCheckinTime = (req.body.earlyCheckinTime || "").trim();
    req.body.earlyCheckinFee = parseInt(req.body.earlyCheckinFee) || 0;
    req.body.lateCheckoutTime = (req.body.lateCheckoutTime || "").trim();
    req.body.lateCheckoutFee = parseInt(req.body.lateCheckoutFee) || 0;

    // Gắn multi–tenant + audit
    req.body.companyId = companyId;
    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;

    // avatar
    if (req.files && req.files.avatar && req.files.avatar.length > 0) {
      req.body.avatar = req.files.avatar[0].path;
    } else {
      req.body.avatar = "";
    }

    // images (gallery)
    if (req.files && req.files.images && req.files.images.length > 0) {
      req.body.images = req.files.images.map((item) => item.path);
    } else {
      req.body.images = [];
    }

    const newRecord = new Hotel(req.body);
    await newRecord.save();

    res.json({
      code: "success",
      message: "Tạo khách sạn thành công!",
      hotelId: newRecord._id, // Trả về ID của khách sạn vừa tạo
    });
  } catch (error) {
    console.log("admin hotel createPost error:", error);
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== EDIT GET ==============
module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account && req.account.companyId;

    const find = { _id: id, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotelDetail = await Hotel.findOne(find).populate('province', 'name');

    if (!hotelDetail) {
      res.redirect(`/${pathAdmin}/hotel/list`);
      return;
    }

    // Lấy danh sách tỉnh thành trong nước (Việt Nam) - giống tour
    const cityList = await City.find({
      $or: [
        { countryId: null },
        { countryName: { $exists: false } },
        { countryName: "" },
      ],
      deleted: { $ne: true },
    }).sort({ name: 1 });

    res.render("admin/pages/hotel-edit", {
      pageTitle: "Chỉnh sửa khách sạn",
      hotelDetail,
      cityList,
    });
  } catch (error) {
    console.log("admin hotel edit error:", error);
    res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== EDIT PATCH ==============
module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account && req.account.companyId;

    // Lấy hotel hiện tại từ DB để giữ lại các dữ liệu cũ
    const find = { _id: id, deleted: false };
    if (companyId) find.companyId = companyId;
    
    const existed = await Hotel.findOne(find);
    if (!existed) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn!",
      });
    }

    normalizeNumeric(req.body, [
      "starRating",
      "basePrice",
      "ratingOverall",
      "ratingCount",
      "ratingLocation",
      "ratingCleanliness",
      "ratingFacilities",
      "ratingService",
      "ratingValue",
      "numberOfRooms",
    ]);

    req.body.currency = req.body.currency || "VND";
    req.body.status = req.body.status || "active";
    req.body.isFeatured =
      req.body.isFeatured === "on" || req.body.isFeatured === "true";

    // Xử lý phone và googleMapsLink
    req.body.phone = (req.body.phone || "").trim();
    req.body.googleMapsLink = (req.body.googleMapsLink || "").trim();
    
    // Xử lý tỉnh thành
    if (req.body.province) {
      req.body.province = req.body.province.trim() || null;
    } else {
      req.body.province = null;
    }
    
    // Xử lý Nhận phòng sớm và Trả phòng muộn
    req.body.earlyCheckinTime = (req.body.earlyCheckinTime || "").trim();
    req.body.earlyCheckinFee = parseInt(req.body.earlyCheckinFee) || 0;
    req.body.lateCheckoutTime = (req.body.lateCheckoutTime || "").trim();
    req.body.lateCheckoutFee = parseInt(req.body.lateCheckoutFee) || 0;

    // Parse amenities: từ arrays thành array of objects
    const amenityNames = toArr(req.body.amenityNames);
    const amenityFeaturesArrays = toArr(req.body.amenityFeatures);
    
    req.body.amenities = [];
    for (let i = 0; i < amenityNames.length; i++) {
      const name = (amenityNames[i] || "").trim();
      if (!name) continue; // Bỏ qua nếu không có tên
      
      const featuresText = amenityFeaturesArrays[i] || "";
      const features = parseLines(featuresText);
      
      req.body.amenities.push({
        name,
        icon: "", // Không dùng nữa
        description: "", // Không dùng nữa
        features
      });
    }
    
    // Chỉ cập nhật roomTypes nếu có dữ liệu mới từ form
    // Nếu không có dữ liệu, giữ nguyên room types cũ (vì room types được quản lý ở trang riêng)
    const parsedRoomTypes = parseRoomTypes(req.body);
    if (parsedRoomTypes && parsedRoomTypes.length > 0) {
      req.body.roomTypes = parsedRoomTypes;
    } else {
      // Không có dữ liệu room types mới -> không cập nhật field này
      delete req.body.roomTypes;
    }
    
    // Parse facilities: từ arrays thành array of objects
    const facilityNames = toArr(req.body.facilityNames);
    const facilityCategories = toArr(req.body.facilityCategories);
    const uploadedFacilityImages = req.files && req.files.facilityImages ? req.files.facilityImages : [];
    
    // Nếu có facilities cũ (từ DB), giữ lại ảnh cũ nếu không upload ảnh mới
    const existingFacilities = existed.facilities || [];
    
    req.body.facilities = [];
    const maxItems = Math.max(facilityNames.length, uploadedFacilityImages.length, existingFacilities.length);
    
    for (let i = 0; i < maxItems; i++) {
      const name = (facilityNames[i] || "").trim();
      if (!name) continue; // Bỏ qua nếu không có tên
      
      const category = (facilityCategories[i] || "other").trim();
      const icon = getFacilityIconByCategory(category); // Tự động set icon dựa trên category
      const imageFile = uploadedFacilityImages[i];
      const existingFacility = existingFacilities[i];
      
      // Ưu tiên ảnh mới upload, nếu không có thì giữ ảnh cũ
      const image = imageFile ? imageFile.path : (existingFacility?.image || "");
      
      req.body.facilities.push({
        name,
        icon,
        image,
        category,
        isAvailable: true // Mặc định là có sẵn
      });
    }
    
    // Parse highlights: từ array of images (upload) và titles thành array of objects
    const highlightTitles = toArr(req.body.highlightTitles);
    const uploadedHighlightImages = req.files && req.files.highlightImages ? req.files.highlightImages : [];
    
    // Nếu có highlights cũ (từ DB), giữ lại ảnh cũ nếu không upload ảnh mới
    const existingHighlights = existed.highlights || [];
    
    req.body.highlights = [];
    const maxHighlightItems = Math.max(highlightTitles.length, uploadedHighlightImages.length, existingHighlights.length);
    
    for (let i = 0; i < maxHighlightItems; i++) {
      const title = (highlightTitles[i] || "").trim();
      const imageFile = uploadedHighlightImages[i];
      const existingHighlight = existingHighlights[i];
      
      // Ưu tiên ảnh mới upload, nếu không có thì giữ ảnh cũ
      const image = imageFile ? imageFile.path : (existingHighlight?.image || "");
      
      if (image || title) {
        req.body.highlights.push({ image, title });
      }
    }
    
    req.body.transportOptions = parseLines(req.body.transportOptions);
    req.body.faqs = parseFaqs(req.body);
    
    // Parse Age Bands (Mức tuổi)
    req.body.ageBands = parseAgeBands(req.body);
    
    // Parse childrenPolicy (GIỮ LẠI ĐỂ TƯƠNG THÍCH NGƯỢC - nhưng ưu tiên dùng ageBands)
    req.body.childrenPolicy = {
      infant0to1: {
        freeWithExistingBed: req.body.infant0to1FreeWithExistingBed === "on",
        cribAvailable: req.body.infant0to1CribAvailable === "on",
        note: (req.body.infant0to1Note || "").trim()
      },
      child2to5: {
        freeWithExistingBed: req.body.child2to5FreeWithExistingBed === "on",
        extraBedCharge: parseInt(req.body.child2to5ExtraBedCharge) || 0,
        note: (req.body.child2to5Note || "").trim()
      },
      guest6Plus: {
        consideredAdult: req.body.guest6PlusConsideredAdult === "on",
        extraBedRequired: req.body.guest6PlusExtraBedRequired === "on",
        extraBedCharge: parseInt(req.body.guest6PlusExtraBedCharge) || 0,
        note: (req.body.guest6PlusNote || "").trim()
      }
    };
    
    // Parse usefulInfo
    req.body.usefulInfo = {
      distanceFromCityCenter: (req.body.distanceFromCityCenter || "").trim(),
      timeToAirport: (req.body.timeToAirport || "").trim(),
      airportTransferFee: parseInt(req.body.airportTransferFee) || 0,
      wifiFee: parseInt(req.body.wifiFee) || 0,
      breakfastFee: parseInt(req.body.breakfastFee) || 0,
      builtYear: parseInt(req.body.builtYear) || 0,
      numberOfFloors: parseInt(req.body.numberOfFloors) || 0,
      inRoomVoltage: (req.body.inRoomVoltage || "").trim(),
      nonSmokingRooms: req.body.nonSmokingRooms === "on",
      numberOfRestaurants: parseInt(req.body.numberOfRestaurants) || 0,
      numberOfBars: parseInt(req.body.numberOfBars) || 0,
      licenseNumber: (req.body.licenseNumber || "").trim()
    };
    
    req.body.updatedBy = req.account.id;

    // avatar
    if (req.files && req.files.avatar && req.files.avatar.length > 0) {
      req.body.avatar = req.files.avatar[0].path;
    } else {
      // Không gửi avatar mới -> giữ nguyên
      delete req.body.avatar;
    }

    // images
    if (req.files && req.files.images && req.files.images.length > 0) {
      req.body.images = req.files.images.map((item) => item.path);
    } else {
      delete req.body.images;
    }

    // Đảm bảo phone và googleMapsLink được cập nhật (kể cả khi là empty string)
    const updateData = { ...req.body };
    // Đảm bảo phone và googleMapsLink luôn được set (kể cả khi rỗng)
    if (updateData.phone === undefined) {
      updateData.phone = existed.phone || "";
    }
    if (updateData.googleMapsLink === undefined) {
      updateData.googleMapsLink = existed.googleMapsLink || "";
    }
    
    // Đảm bảo các field Nhận phòng sớm và Trả phòng muộn được cập nhật
    if (updateData.earlyCheckinTime === undefined) {
      updateData.earlyCheckinTime = existed.earlyCheckinTime || "";
    }
    if (updateData.earlyCheckinFee === undefined) {
      updateData.earlyCheckinFee = existed.earlyCheckinFee || 0;
    }
    if (updateData.lateCheckoutTime === undefined) {
      updateData.lateCheckoutTime = existed.lateCheckoutTime || "";
    }
    if (updateData.lateCheckoutFee === undefined) {
      updateData.lateCheckoutFee = existed.lateCheckoutFee || 0;
    }

    await Hotel.updateOne(find, { $set: updateData });

    res.json({
      code: "success",
      message: "Cập nhật khách sạn thành công!",
    });
  } catch (error) {
    console.log("admin hotel editPatch error:", error);
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== DELETE (soft) ==============
module.exports.deletePatch = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account && req.account.companyId;

    const find = { _id: id };
    if (companyId) find.companyId = companyId;

    await Hotel.updateOne(find, {
      deleted: true,
      deletedAt: Date.now(),
      deletedBy: req.account.id,
    });

    res.json({
      code: "success",
      message: "Xóa khách sạn thành công!",
    });
  } catch (error) {
    console.log("admin hotel deletePatch error:", error);
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== UNDO (khôi phục) ==============
module.exports.undoPatch = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account && req.account.companyId;

    const find = { _id: id };
    if (companyId) find.companyId = companyId;

    await Hotel.updateOne(find, {
      deleted: false,
    });

    res.json({
      code: "success",
      message: "Đã khôi phục khách sạn!",
    });
  } catch (error) {
    console.log("admin hotel undoPatch error:", error);
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== DESTROY (xóa vĩnh viễn) ==============
module.exports.destroyDelete = async (req, res) => {
  try {
    const id = req.params.id;
    const companyId = req.account && req.account.companyId;

    const find = { _id: id };
    if (companyId) find.companyId = companyId;

    await Hotel.deleteOne(find);

    res.json({
      code: "success",
      message: "Đã xóa vĩnh viễn khách sạn!",
    });
  } catch (error) {
    console.log("admin hotel destroyDelete error:", error);
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== CHANGE MULTI (trạng thái / xóa / undo / destroy) ==============
module.exports.changeMultiPatch = async (req, res) => {
  try {
    const { value, ids } = req.body;
    const companyId = req.account && req.account.companyId;

    const baseFilter = { _id: { $in: ids } };
    if (companyId) baseFilter.companyId = companyId;

    switch (value) {
      case "active":
      case "inactive":
        await Hotel.updateMany(baseFilter, { status: value });
        res.json({
          code: "success",
          message: "Đổi trạng thái thành công!",
        });
        break;

      case "delete":
        await Hotel.updateMany(baseFilter, {
          deleted: true,
          deletedAt: Date.now(),
          deletedBy: req.account.id,
        });
        res.json({
          code: "success",
          message: "Đã xóa thành công!",
        });
        break;

      case "undo":
        await Hotel.updateMany(baseFilter, { deleted: false });
        res.json({
          code: "success",
          message: "Đã khôi phục thành công!",
        });
        break;

      case "destroy":
        await Hotel.deleteMany(baseFilter);
        res.json({
          code: "success",
          message: "Đã xóa vĩnh viễn!",
        });
        break;

      default:
        res.json({
          code: "error",
          message: "Dữ liệu không hợp lệ!",
        });
        break;
    }
  } catch (error) {
    console.log("admin hotel changeMultiPatch error:", error);
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== ROOM TYPE DETAIL: EDIT PAGE ==============
module.exports.roomTypeEditPage = async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;
    const companyId = req.account && req.account.companyId;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.redirect(`/${pathAdmin}/hotel/list`);
    }

    const roomType = findRoomTypeById(hotel, roomId);
    if (!roomType) {
      // Không tìm được loại phòng – quay lại trang edit khách sạn
      return res.redirect(`/${pathAdmin}/hotel/edit/${hotelId}`);
    }

    // Age Bands chỉ lấy từ hotel level (không còn override ở room type level)
    const ageBands = hotel.ageBands || [];

    // Render trang riêng để chỉnh chi tiết loại phòng
    // Sử dụng view hotel-room-create với mode edit
    res.render("admin/pages/hotel-room-create", {
      pageTitle: `Chi tiết loại phòng - ${roomType.name}`,
      hotel,
      roomType, // truyền thẳng subdocument cho Pug
      ageBands, // Age Bands từ hotel level
      isEditMode: true, // Đánh dấu đang ở chế độ edit
      hotelId: hotel._id.toString(),
      roomTypeId: roomType._id.toString(),
    });
  } catch (error) {
    console.log("admin hotel roomTypeEditPage error:", error);
    return res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== ROOM TYPE DETAIL: EDIT POST ==============
module.exports.roomTypeEditPost = async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;
    const companyId = req.account && req.account.companyId;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn!",
      });
    }

    const roomType = findRoomTypeById(hotel, roomId);
    if (!roomType) {
      return res.json({
        code: "error",
        message: "Không tìm thấy loại phòng!",
      });
    }

    // Ép số cho một vài field
    normalizeNumeric(req.body, ["basePrice", "sizeM2", "rating", "baseOccupancy", "maxOccupancy", "maxExtraBeds", "extraBedFeePerNight"]);

    // Cập nhật các trường cơ bản
    if (req.body.name !== undefined) roomType.name = req.body.name;
    if (req.body.basePrice !== undefined)
      roomType.basePrice = req.body.basePrice || 0;
    if (req.body.description !== undefined)
      roomType.description = req.body.description || "";
    
    // Cập nhật Occupancy
    if (req.body.baseOccupancy !== undefined)
      roomType.baseOccupancy = req.body.baseOccupancy || 2;
    if (req.body.maxOccupancy !== undefined)
      roomType.maxOccupancy = req.body.maxOccupancy || 3;
    if (req.body.maxExtraBeds !== undefined)
      roomType.maxExtraBeds = req.body.maxExtraBeds || 1;
    if (req.body.extraBedFeePerNight !== undefined)
      roomType.extraBedFeePerNight = req.body.extraBedFeePerNight || 0;

    // Các trường chi tiết
    if (req.body.sizeM2 !== undefined) roomType.sizeM2 = req.body.sizeM2 || 0;
    if (req.body.bedInfo !== undefined)
      roomType.bedInfo = req.body.bedInfo || "";
    if (req.body.view !== undefined) roomType.view = req.body.view || "";
    if (req.body.smokingPolicy !== undefined)
      roomType.smokingPolicy = req.body.smokingPolicy || "";

    // Xử lý amenities: có thể là array hoặc string
    if (req.body.bathroomAmenities !== undefined) {
      if (Array.isArray(req.body.bathroomAmenities)) {
        roomType.bathroomAmenities = req.body.bathroomAmenities.filter(a => a && a.trim());
      } else {
        roomType.bathroomAmenities = parseLines(req.body.bathroomAmenities);
      }
    }
    if (req.body.roomAmenities !== undefined) {
      if (Array.isArray(req.body.roomAmenities)) {
        roomType.roomAmenities = req.body.roomAmenities.filter(a => a && a.trim());
      } else {
        roomType.roomAmenities = parseLines(req.body.roomAmenities);
      }
    }
    if (req.body.otherAmenities !== undefined) {
      if (Array.isArray(req.body.otherAmenities)) {
        roomType.otherAmenities = req.body.otherAmenities.filter(a => a && a.trim());
      } else {
        roomType.otherAmenities = parseLines(req.body.otherAmenities);
      }
    }

    // Đánh giá và đề xuất
    if (req.body.rating !== undefined) roomType.rating = req.body.rating || 0;
    if (req.body.ratingCategory !== undefined)
      roomType.ratingCategory = req.body.ratingCategory || "";
    if (req.body.isRecommended !== undefined)
      roomType.isRecommended = req.body.isRecommended === "true" || req.body.isRecommended === true;
    if (req.body.soloTravelerFavorite !== undefined)
      roomType.soloTravelerFavorite = req.body.soloTravelerFavorite === "true" || req.body.soloTravelerFavorite === true;


    // Upload ảnh phòng
    // Xử lý ảnh mới upload (từ req.files)
    const newUploadedImages = [];
    if (req.files && req.files.roomImages && req.files.roomImages.length > 0) {
      newUploadedImages.push(...req.files.roomImages.map((file) => file.path));
    }
    
    // Xử lý URL ảnh đã có (từ req.body.roomImagesUrls - FilePond gửi URL của ảnh đã upload)
    const existingImageUrls = [];
    if (req.body.roomImagesUrls) {
      // Nếu là array, lấy tất cả
      if (Array.isArray(req.body.roomImagesUrls)) {
        existingImageUrls.push(...req.body.roomImagesUrls);
      } else {
        // Nếu là string, thêm vào array
        existingImageUrls.push(req.body.roomImagesUrls);
      }
    }
    
    // Kết hợp ảnh mới và ảnh cũ
    // Luôn cập nhật mảng images dựa trên dữ liệu từ FilePond
    // FilePond sẽ gửi tất cả ảnh (cả cũ và mới) qua roomImagesUrls
    if (existingImageUrls.length > 0 || newUploadedImages.length > 0) {
      // Kết hợp: ảnh cũ (existingImageUrls) + ảnh mới upload
      roomType.images = [...existingImageUrls, ...newUploadedImages];
    }
    // Nếu không có dữ liệu từ FilePond, giữ nguyên ảnh hiện tại

    // Age Bands không còn được lưu ở room type level nữa
    // Tất cả age bands được quản lý ở hotel level

    // Audit
    hotel.updatedBy = req.account.id;

    await hotel.save();

    return res.json({
      code: "success",
      message: "Cập nhật chi tiết loại phòng thành công!",
    });
  } catch (error) {
    console.log("admin hotel roomTypeEditPost error:", error);
    return res.json({
      code: "error",
      message: "Dữ liệu chi tiết loại phòng không hợp lệ!",
    });
  }
};

// ============== ROOM TYPES LIST PAGE (TỪ SIDEBAR) ==============
module.exports.roomTypesListPage = async (req, res) => {
  try {
    const companyId = req.account && req.account.companyId;
    const find = { deleted: false };
    if (companyId) find.companyId = companyId;
    
    // Lấy tất cả hotels của company
    const allHotels = await Hotel.find(find).sort({ createdAt: "desc" }).lean();
    
    // Nếu không có hotelId trong URL, redirect đến hotel đầu tiên
    if (!req.query.hotelId && allHotels.length > 0) {
      const firstHotelId = allHotels[0]._id;
      return res.redirect(`/${pathAdmin}/hotel/room-types?hotelId=${firstHotelId}`);
    }
    
    // Lọc hotels để hiển thị theo hotelId
    let selectedHotelId = req.query.hotelId;
    let hotelList = allHotels;
    
    if (selectedHotelId) {
      hotelList = allHotels.filter(h => String(h._id) === String(selectedHotelId));
    }

    // Đếm số lượng loại phòng cho mỗi khách sạn và thêm id
    for (const hotel of hotelList) {
      hotel.roomTypesCount = (hotel.roomTypes && hotel.roomTypes.length) || 0;
      hotel.id = hotel._id ? hotel._id.toString() : hotel.id;
    }

    res.render("admin/pages/hotel-room-types-list", {
      pageTitle: "Quản lý loại phòng",
      hotelList,
      pathAdmin,
      selectedHotelId: req.query.hotelId || null,
    });
  } catch (error) {
    console.log("admin hotel roomTypesListPage error:", error);
    res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== ROOM TYPES MANAGEMENT PAGE ==============
module.exports.roomTypesManagePage = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const companyId = req.account && req.account.companyId;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.redirect(`/${pathAdmin}/hotel/list`);
    }

    res.render("admin/pages/hotel-room-types-manage", {
      pageTitle: `Quản lý loại phòng - ${hotel.name}`,
      hotel,
    });
  } catch (error) {
    console.log("admin hotel roomTypesManagePage error:", error);
    return res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== ROOM TYPE CREATE PAGE ==============
module.exports.roomTypeCreatePage = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const companyId = req.account && req.account.companyId;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.redirect(`/${pathAdmin}/hotel/list`);
    }

    res.render("admin/pages/hotel-room-create", {
      pageTitle: `Thêm loại phòng mới - ${hotel.name}`,
      hotel,
      ageBands: hotel.ageBands || [], // Lấy ageBands từ hotel level
    });
  } catch (error) {
    console.log("admin hotel roomTypeCreatePage error:", error);
    return res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

// ============== ROOM TYPE CREATE POST ==============
module.exports.roomTypeCreatePost = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const companyId = req.account && req.account.companyId;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn!",
      });
    }

    // Ép số cho một vài field
    normalizeNumeric(req.body, ["basePrice", "sizeM2", "rating", "baseOccupancy", "maxOccupancy", "maxExtraBeds", "extraBedFeePerNight"]);

    // Parse bathroomAmenities, roomAmenities: có thể là array hoặc string
    let bathroomAmenities = [];
    if (Array.isArray(req.body.bathroomAmenities)) {
      bathroomAmenities = req.body.bathroomAmenities.filter(a => a && a.trim());
    } else {
      bathroomAmenities = parseLines(req.body.bathroomAmenities || "");
    }
    
    let roomAmenities = [];
    if (Array.isArray(req.body.roomAmenities)) {
      roomAmenities = req.body.roomAmenities.filter(a => a && a.trim());
    } else {
      roomAmenities = parseLines(req.body.roomAmenities || "");
    }
    

    // Upload ảnh phòng
    let roomImages = [];
    if (req.files && req.files.roomImages && req.files.roomImages.length > 0) {
      roomImages = req.files.roomImages.map((file) => file.path);
    }

    // Tạo room type mới
    const newRoomType = {
      name: req.body.name,
      basePrice: req.body.basePrice || 0,
      description: req.body.description || "",
      sizeM2: req.body.sizeM2 || 0,
      bedInfo: req.body.bedInfo || "",
      view: req.body.view || "",
      smokingPolicy: req.body.smokingPolicy || "",
      bathroomAmenities,
      roomAmenities,
      images: roomImages,
      
      // Occupancy
      baseOccupancy: req.body.baseOccupancy || 2,
      maxOccupancy: req.body.maxOccupancy || 3,
      maxExtraBeds: req.body.maxExtraBeds || 1,
      extraBedFeePerNight: req.body.extraBedFeePerNight || 0,
      
      // Age Bands (chỉ lưu khi có flag override)
      ageBands: [],
    };
    
    // Parse và lưu Age Bands - Override từ Hotel level
    const ageBandsOverride = req.body.ageBandsOverride === 'true';
    if (ageBandsOverride && req.body.ageBandNames) {
      const ageBands = parseAgeBands(req.body);
      newRoomType.ageBands = ageBands;
    }

    // Thêm vào mảng roomTypes
    hotel.roomTypes.push(newRoomType);
    hotel.updatedBy = req.account.id;

    await hotel.save();

    return res.json({
      code: "success",
      message: "Thêm loại phòng thành công!",
      redirectUrl: `/${pathAdmin}/hotel/${hotelId}/room-types/manage`,
    });
  } catch (error) {
    console.log("admin hotel roomTypeCreatePost error:", error);
    return res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// ============== ROOM TYPE DELETE ==============
module.exports.roomTypeDelete = async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;
    const companyId = req.account && req.account.companyId;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn!",
      });
    }

    const roomType = findRoomTypeById(hotel, roomId);
    if (!roomType) {
      return res.json({
        code: "error",
        message: "Không tìm thấy loại phòng!",
      });
    }

    // Xóa room type
    roomType.deleteOne();
    hotel.updatedBy = req.account.id;

    await hotel.save();

    return res.json({
      code: "success",
      message: "Xóa loại phòng thành công!",
    });
  } catch (error) {
    console.log("admin hotel roomTypeDelete error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi xóa loại phòng!",
    });
  }
};

module.exports.bookingList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Đặt phòng",
        bookingsData: { bookings: [], activeTab: "list" },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    // Lấy hotelId từ query params
    let hotelId = req.query.hotelId || null;

    // Lấy tất cả khách sạn thuộc công ty hiện tại
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name address rooms roomTypes")
      .lean();

    // Nếu công ty chưa có khách sạn nào
    if (!hotels || hotels.length === 0) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Đặt phòng",
        bookingsData: { bookings: [], hotels: [], activeTab: "list" },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    // Nếu không có hotelId, redirect với hotelId của khách sạn đầu tiên
    if (!hotelId || hotelId === "all") {
      hotelId = String(hotels[0]._id);
      const urlParams = new URLSearchParams(req.query);
      urlParams.set("hotelId", hotelId);
      return res.redirect(`/${pathAdmin}/hotel/booking/list?${urlParams.toString()}`);
    }

    const selectedHotelId = hotelId;
    const selectedHotel = hotels.find(h => String(h._id) === selectedHotelId);

    if (!selectedHotel) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Đặt phòng",
        bookingsData: { bookings: [], hotels, activeTab: "list" },
        selectedHotelId, // Pass ở root level
        pathAdmin,
        isBookingManagement: true,
      });
    }

    const hotelById = {};
    hotelById[String(selectedHotel._id)] = selectedHotel;

    // Lấy search query từ URL
    const searchQuery = (req.query.search || "").trim();

    // Tạo filter điều kiện tìm kiếm
    const bookingFilter = {
      "hotel.hotelId": selectedHotel._id,
    };

    // Nếu có search query, thêm điều kiện tìm theo mã, tên, hoặc email
    if (searchQuery) {
      bookingFilter.$or = [
        { code: new RegExp(searchQuery, "i") }, // Tìm theo mã booking (case-insensitive)
        { "guest.fullName": new RegExp(searchQuery, "i") }, // Tìm theo tên khách hàng
        { "guest.email": new RegExp(searchQuery, "i") }, // Tìm theo email
      ];
    }

    // Lấy booking của khách sạn được chọn
    const rawBookings = await HotelBooking.find(bookingFilter)
      .sort({ createdAt: -1 })
      .lean();

    // Group bookings theo mã gốc (loại bỏ tất cả suffix)
    const bookingGroups = {};
    rawBookings.forEach(b => {
      // Extract base code (loại bỏ -1, -2, -R1, -R2, -1-R1, -R1-timestamp, etc.)
      // VD: HB123 → HB123
      //     HB123-1 → HB123
      //     HB123-R1 → HB123
      //     HB123-1-R1 → HB123
      //     HB123-R1-1234567890 → HB123
      let baseCode = b.code;
      
      // Loại bỏ tất cả các suffix dạng -R\d+(-\d+)? (VD: -R1, -R2, -R1-timestamp)
      baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
      
      // Loại bỏ tất cả các suffix dạng -\d+ (VD: -1, -2, -3)
      // Lặp lại để xử lý trường hợp -1-R1 đã loại bỏ -R1, còn lại -1
      while (baseCode.match(/-\d+$/)) {
        baseCode = baseCode.replace(/-\d+$/, '');
      }
      
      if (!bookingGroups[baseCode]) {
        bookingGroups[baseCode] = [];
      }
      bookingGroups[baseCode].push(b);
    });

    const bookings = Object.entries(bookingGroups).map(([baseCode, group]) => {
      // Lấy booking đầu tiên làm đại diện
      const b = group[0];
      const nights =
        b.totalNights ||
        (b.checkIn && b.checkOut
          ? Math.max(
              1,
              moment(b.checkOut).startOf("day").diff(
                moment(b.checkIn).startOf("day"),
                "days"
              )
            )
          : 1);

      const hotel = b.hotel?.hotelId
        ? hotelById[String(b.hotel.hotelId)] || null
        : null;

      // Đếm số lượng phòng theo từng loại phòng
      const roomTypeCountMap = {};
      let totalRoomCount = 0;
      
      if (hotel && Array.isArray(hotel.roomTypes)) {
        group.forEach(booking => {
          if (booking.roomTypeId) {
            const roomTypeIdStr = String(booking.roomTypeId);
            const roomsInBooking = booking.rooms || 1;
            
            if (!roomTypeCountMap[roomTypeIdStr]) {
              const rt = hotel.roomTypes.find(
                (rt) => String(rt._id) === roomTypeIdStr
              );
              roomTypeCountMap[roomTypeIdStr] = {
                name: rt?.name || "Loại phòng",
                count: 0
              };
            }
            
            roomTypeCountMap[roomTypeIdStr].count += roomsInBooking;
            totalRoomCount += roomsInBooking;
          }
        });
      }
      
      // Format: "Deluxe City View (2 phòng), Premier Ocean View (1 phòng)"
      const roomTypeNames = Object.values(roomTypeCountMap)
        .map(rt => `${rt.name} (${rt.count} phòng)`)
        .join(', ');
      
      const roomTypeName = roomTypeNames || "Loại phòng";
      const roomCount = totalRoomCount || group.length;

      // Ưu tiên dùng orderTotal (tổng tiền toàn bộ đơn bao gồm thuế, phí, dịch vụ thêm)
      // Fallback về totalAmount nếu orderTotal không có (bookings cũ)
      const totalAmount = Number(b.orderTotal || b.totalAmount || 0);
      const paidAmount = b.paymentStatus === "paid" ? totalAmount : 0;
      const remainingAmount = totalAmount - paidAmount;

      // Map paymentStatus sang nhãn + màu
      let paymentStatusText = "Chưa thanh toán";
      let paymentStatusColor = "yellow";
      
      if (b.paymentStatus === "paid") {
        paymentStatusText = "Đã thanh toán";
        paymentStatusColor = "green";
      }
      
      // Map status sang nhãn + màu
      let statusText = "Chờ xác nhận";
      let statusColor = "blue";
      
      if (b.status === "confirmed") {
        statusText = "Đã xác nhận";
        statusColor = "green";
      } else if (b.status === "checked_in") {
        statusText = "Đã nhận phòng";
        statusColor = "blue";
      } else if (b.status === "checked_out") {
        statusText = "Đã trả phòng";
        statusColor = "gray";
      } else if (b.status === "cancelled") {
        statusText = "Đã hủy";
        statusColor = "red";
      }

      // Map paymentMethod sang tên hiển thị
      let paymentMethodName = "Tiền mặt";
      if (b.paymentMethod === "bank") {
        paymentMethodName = "Chuyển khoản ngân hàng";
      } else if (b.paymentMethod === "vnpay") {
        paymentMethodName = "VNPay";
      }

      return {
        bookingId: baseCode, // Dùng base code (không có suffix)
        _id: b._id, // ID gốc để edit
        customerName: b.guest?.fullName || "Khách lẻ",
        customerEmail: b.guest?.email || "",
        checkIn: b.checkIn
          ? moment(b.checkIn).format("DD/MM/YYYY")
          : "—",
        nights,
        roomType: roomTypeName,
        roomCount, // Tổng số phòng của cả nhóm
        adults: b.adults || 1,
        children: b.children || 0,
        totalAmount,
        paidAmount,
        remainingAmount,
        paymentStatus: paymentStatusText,
        paymentStatusColor,
        paymentStatusValue: b.paymentStatus, // unpaid / paid
        status: statusText,
        statusColor,
        statusValue: b.status, // pending / checked_in / checked_out / cancelled
        paymentMethod: paymentMethodName,
        paymentMethodValue: b.paymentMethod,
        groupCount: group.length,
      };
    });

    const bookingsData = {
      bookings,
      hotels,
      activeTab: "list",
      searchQuery, // Pass search query để hiển thị trong input
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Đặt phòng",
      bookingsData,
      selectedHotelId, // Pass ở root level để hotel-selector và tab links có thể access
      pathAdmin,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel booking list error:", error);
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Đặt phòng",
      bookingsData: { bookings: [], activeTab: "list" },
      selectedHotelId: null,
      pathAdmin,
      isBookingManagement: true,
    });
  }
};

/**
 * GET /admin/hotel/booking/detail/:bookingId
 * Xem chi tiết đơn đặt phòng
 */
module.exports.bookingDetail = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      return res.status(403).render("admin/pages/error", {
        pageTitle: "Lỗi",
        message: "Không có quyền truy cập",
      });
    }

    // Lấy tất cả bookings có cùng base code
    // bookingId có thể là: HB123, HB123-1, HB123-R1, HB123-1-R1, etc.
    let baseCode = bookingId;
    
    // Loại bỏ tất cả các suffix để lấy base code
    baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
    while (baseCode.match(/-\d+$/)) {
      baseCode = baseCode.replace(/-\d+$/, '');
    }
    
    // Tìm tất cả bookings có base code đó
    // Match: HB123, HB123-1, HB123-R1, HB123-1-R1, HB123-R1-timestamp, etc.
    const bookings = await HotelBooking.find({
      code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+)?(-\\d+)?$`),
    })
      .sort({ code: 1 })
      .lean();

    if (!bookings || bookings.length === 0) {
      return res.status(404).render("admin/pages/error", {
        pageTitle: "Không tìm thấy",
        message: "Không tìm thấy đơn đặt phòng",
      });
    }

    // Kiểm tra xem booking có thuộc công ty hiện tại không
    const hotelId = bookings[0].hotel?.hotelId;
    let hotel = null;
    if (hotelId) {
      hotel = await Hotel.findOne({ _id: hotelId, companyId, deleted: false }).lean();
      if (!hotel) {
        return res.status(403).render("admin/pages/error", {
          pageTitle: "Lỗi",
          message: "Không có quyền truy cập đơn đặt phòng này",
        });
      }
    }

    // Format dữ liệu
    const firstBooking = bookings[0];
    const totalRooms = bookings.reduce((sum, b) => sum + (b.rooms || 1), 0);
    
    // Tổng tiền đơn hàng - dùng orderTotal (đã bao gồm thuế, phí, dịch vụ)
    // KHÔNG cộng dồn vì tất cả bookings trong group đều có cùng orderTotal
    const totalAmount = firstBooking.orderTotal || firstBooking.totalAmount || 0;
    
    const nights = firstBooking.totalNights ||
      (firstBooking.checkIn && firstBooking.checkOut
        ? Math.max(
            1,
            moment(firstBooking.checkOut).startOf("day").diff(
              moment(firstBooking.checkIn).startOf("day"),
              "days"
            )
          )
        : 1);

    // Map status
    let statusText = "Chờ xác nhận";
    let statusClass = "badge-warning";
    if (firstBooking.status === "confirmed") {
      statusText = "Đã xác nhận";
      statusClass = "badge-success";
    } else if (firstBooking.status === "checked_in") {
      statusText = "Đã nhận phòng";
      statusClass = "badge-info";
    } else if (firstBooking.status === "checked_out") {
      statusText = "Đã trả phòng";
      statusClass = "badge-secondary";
    } else if (firstBooking.status === "cancelled") {
      statusText = "Đã hủy";
      statusClass = "badge-danger";
    }

    // Map payment status
    let paymentStatusText = "Chưa thanh toán";
    let paymentStatusClass = "badge-warning";
    if (firstBooking.paymentStatus === "paid") {
      paymentStatusText = "Đã thanh toán";
      paymentStatusClass = "badge-success";
    }

    // Map payment method
    let paymentMethodText = "Tiền mặt";
    if (firstBooking.paymentMethod === "bank") {
      paymentMethodText = "Chuyển khoản ngân hàng";
    } else if (firstBooking.paymentMethod === "vnpay") {
      paymentMethodText = "VNPay";
    }

    // Format additional services - Cấu trúc mới: { global: {...}, perItem: {...} }
    const additionalServices = [];
    const perItemServices = {}; // Nhóm dịch vụ theo từng item (loại phòng)
    
    if (firstBooking.additionalServices && Object.keys(firstBooking.additionalServices).length > 0) {
      const services = firstBooking.additionalServices;
      
      // ===== XỬ LÝ DỊCH VỤ CHUNG (GLOBAL) =====
      if (services.global && typeof services.global === 'object') {
        // Early checkin
        if (services.global.early_checkin === 'true') {
          additionalServices.push({
            name: `Nhận phòng sớm${hotel && hotel.earlyCheckinTime ? ' (từ ' + hotel.earlyCheckinTime + ')' : ''}`,
            price: hotel && hotel.earlyCheckinFee ? hotel.earlyCheckinFee.toLocaleString('vi-VN') : '0',
            quantity: 1,
            type: 'global'
          });
        }
        
        // Late checkout
        if (services.global.late_checkout === 'true') {
          additionalServices.push({
            name: `Trả phòng muộn${hotel && hotel.lateCheckoutTime ? ' (đến ' + hotel.lateCheckoutTime + ')' : ''}`,
            price: hotel && hotel.lateCheckoutFee ? hotel.lateCheckoutFee.toLocaleString('vi-VN') : '0',
            quantity: 1,
            type: 'global'
          });
        }
        
        // Airport transfer (quantity-based)
        Object.keys(services.global).forEach(key => {
          if (key.startsWith('service_')) {
            const qty = parseInt(services.global[key]);
            if (qty > 0 && key === 'service_airport_transfer') {
              additionalServices.push({
                name: 'Đưa đón sân bay (1 chiều)',
                price: hotel && hotel.usefulInfo?.airportTransferFee ? hotel.usefulInfo.airportTransferFee.toLocaleString('vi-VN') : '0',
                quantity: qty,
                type: 'global'
              });
            }
          }
        });
      }
      
      // ===== XỬ LÝ DỊCH VỤ THEO TỪNG ITEM (PER ITEM) =====
      // Giờ mỗi booking chỉ chứa perItem của riêng nó, nên cần loop qua tất cả bookings
      if (services.perItem && typeof services.perItem === 'object') {
        Object.keys(services.perItem).forEach(itemIndex => {
          const itemServices = services.perItem[itemIndex];
          if (typeof itemServices !== 'object') return;
          
          const booking = bookings[parseInt(itemIndex)];
          if (!booking) return;
          
          // Tìm room type
          let roomTypeName = `Loại phòng ${parseInt(itemIndex) + 1}`;
          if (hotel && Array.isArray(hotel.roomTypes) && booking.roomTypeId) {
            const roomType = hotel.roomTypes.find(rt => String(rt._id) === String(booking.roomTypeId));
            if (roomType) {
              roomTypeName = roomType.title || roomType.name || roomTypeName;
            }
          }
          
          if (!perItemServices[itemIndex]) {
            perItemServices[itemIndex] = {
              roomTypeName: roomTypeName,
              services: []
            };
          }
          
          Object.keys(itemServices).forEach(serviceId => {
            const qty = parseInt(itemServices[serviceId]);
            if (qty <= 0) return;
            
            let serviceName = 'Dịch vụ';
            let servicePrice = '0';
            
            // Extra bed
            if (serviceId.includes('extra_bed')) {
              serviceName = 'Giường phụ';
              if (hotel && Array.isArray(hotel.roomTypes) && booking.roomTypeId) {
                const roomType = hotel.roomTypes.find(rt => String(rt._id) === String(booking.roomTypeId));
                if (roomType && roomType.extraBedFeePerNight) {
                  servicePrice = (roomType.extraBedFeePerNight * booking.totalNights).toLocaleString('vi-VN');
                }
              }
            }
            // Breakfast
            else if (serviceId.includes('breakfast_')) {
              // Extract band name: breakfast_nguoi_lon_0_item_0 -> nguoi_lon
              const parts = serviceId.split('_');
              let bandName = 'Ăn sáng';
              
              // Find age band in hotel
              if (hotel && Array.isArray(hotel.ageBands)) {
                for (const band of hotel.ageBands) {
                  const bandKey = band.bandName.toLowerCase().replace(/\s+/g, '_');
                  if (serviceId.includes(bandKey)) {
                    bandName = band.bandName;
                    if (band.breakfastFeePerPersonPerMeal) {
                      servicePrice = (qty * band.breakfastFeePerPersonPerMeal).toLocaleString('vi-VN');
                    }
                    break;
                  }
                }
              }
              
              serviceName = `Ăn sáng / ${bandName}`;
            }
            
            perItemServices[itemIndex].services.push({
              name: serviceName,
              price: servicePrice,
              quantity: qty,
              type: 'perItem'
            });
          });
        });
      }
    }
    
    // Parse perItem services từ các bookings khác (nếu có)
    bookings.forEach((booking, idx) => {
      if (idx === 0) return; // Đã parse từ firstBooking rồi
      
      const bServices = booking.additionalServices;
      if (bServices && bServices.perItem && typeof bServices.perItem === 'object') {
        Object.keys(bServices.perItem).forEach(itemIndex => {
          const itemServices = bServices.perItem[itemIndex];
          if (typeof itemServices !== 'object') return;
          
          // Tìm room type
          let roomTypeName = `Loại phòng ${parseInt(itemIndex) + 1}`;
          if (hotel && Array.isArray(hotel.roomTypes) && booking.roomTypeId) {
            const roomType = hotel.roomTypes.find(rt => String(rt._id) === String(booking.roomTypeId));
            if (roomType) {
              roomTypeName = roomType.title || roomType.name || roomTypeName;
            }
          }
          
          if (!perItemServices[itemIndex]) {
            perItemServices[itemIndex] = {
              roomTypeName: roomTypeName,
              services: []
            };
          }
          
          Object.keys(itemServices).forEach(serviceId => {
            const qty = parseInt(itemServices[serviceId]);
            if (qty <= 0) return;
            
            let serviceName = 'Dịch vụ';
            let servicePrice = '0';
            
            // Extra bed
            if (serviceId.includes('extra_bed')) {
              serviceName = 'Giường phụ';
              if (hotel && Array.isArray(hotel.roomTypes) && booking.roomTypeId) {
                const roomType = hotel.roomTypes.find(rt => String(rt._id) === String(booking.roomTypeId));
                if (roomType && roomType.extraBedFeePerNight) {
                  servicePrice = (roomType.extraBedFeePerNight * booking.totalNights).toLocaleString('vi-VN');
                }
              }
            }
            // Breakfast
            else if (serviceId.includes('breakfast_')) {
              let bandName = 'Ăn sáng';
              
              if (hotel && Array.isArray(hotel.ageBands)) {
                for (const band of hotel.ageBands) {
                  const bandKey = band.bandName.toLowerCase().replace(/\s+/g, '_');
                  if (serviceId.includes(bandKey)) {
                    bandName = band.bandName;
                    if (band.breakfastFeePerPersonPerMeal) {
                      servicePrice = (qty * band.breakfastFeePerPersonPerMeal).toLocaleString('vi-VN');
                    }
                    break;
                  }
                }
              }
              
              serviceName = `Ăn sáng / ${bandName}`;
            }
            
            perItemServices[itemIndex].services.push({
              name: serviceName,
              price: servicePrice,
              quantity: qty,
              type: 'perItem'
            });
          });
        });
      }
    });

    // Tính tổng số người lớn và trẻ em từ TẤT CẢ bookings
    const totalAdults = bookings.reduce((sum, b) => sum + (b.adults || 1), 0);
    const totalChildren = bookings.reduce((sum, b) => sum + (b.children || 0), 0);
    
    // Format thông tin trẻ em với độ tuổi từ TẤT CẢ bookings
    let childrenText = String(totalChildren);
    const allChildrenDetails = [];
    bookings.forEach(booking => {
      if (booking.childrenDetails && Array.isArray(booking.childrenDetails) && booking.childrenDetails.length > 0) {
        allChildrenDetails.push(...booking.childrenDetails);
      }
    });
    
    if (allChildrenDetails.length > 0) {
      const ages = allChildrenDetails.map(child => `${child.age || 0} tuổi`).join(', ');
      childrenText = `${totalChildren} trẻ em (${ages})`;
    }
    
    const bookingDetail = {
      code: baseCode,
      guest: firstBooking.guest || {},
      hotel: firstBooking.hotel || {},
      checkInDate: firstBooking.checkIn ? moment(firstBooking.checkIn).format("DD/MM/YYYY") : "—",
      checkOutDate: firstBooking.checkOut ? moment(firstBooking.checkOut).format("DD/MM/YYYY") : "—",
      nights: nights,
      totalRooms: totalRooms,
      adults: totalAdults,
      children: totalChildren,
      childrenText: childrenText, // Thêm field mới để hiển thị chi tiết trẻ em
      currency: firstBooking.currency || "đ",
      totalAmount: totalAmount,
      totalAmountFormat: totalAmount.toLocaleString('vi-VN'),
      orderTotal: firstBooking.orderTotal || totalAmount,
      orderTotalFormat: (firstBooking.orderTotal || totalAmount).toLocaleString('vi-VN'),
      status: statusText,
      statusClass: statusClass,
      paymentStatus: paymentStatusText,
      paymentStatusClass: paymentStatusClass,
      paymentMethod: paymentMethodText,
      note: firstBooking.note || "",
      createdAt: moment(firstBooking.createdAt).format("HH:mm - DD/MM/YYYY"),
      additionalServices: additionalServices, // Dịch vụ chung (global)
      perItemServices: Object.values(perItemServices), // Dịch vụ theo từng loại phòng
      roomDetails: bookings.map((b, idx) => {
        // Tìm room type từ hotel.roomTypes
        let roomTypeName = "Loại phòng";
        if (hotel && Array.isArray(hotel.roomTypes) && b.roomTypeId) {
          const roomType = hotel.roomTypes.find(rt => String(rt._id) === String(b.roomTypeId));
          if (roomType) {
            roomTypeName = roomType.title || roomType.name || "Loại phòng";
          }
        }
        
        // Parse roomsData để lấy chi tiết từng phòng
        let roomsDetails = [];
        if (b.roomsData) {
          try {
            const parsedRoomsData = JSON.parse(decodeURIComponent(b.roomsData));
            if (Array.isArray(parsedRoomsData)) {
              // Kiểm tra xem booking có suffix -R\d+ không (đã được assign phòng cụ thể)
              const roomNumberMatch = b.code.match(/-R(\d+)(-\d+)?$/);
              
              if (roomNumberMatch && b.rooms === 1) {
                // Booking đã được assign phòng cụ thể, chỉ hiển thị phòng tương ứng
                const roomNumber = parseInt(roomNumberMatch[1]);
                const roomIndex = roomNumber - 1; // -R1 → index 0, -R2 → index 1
                
                if (roomIndex >= 0 && roomIndex < parsedRoomsData.length) {
                  const roomData = parsedRoomsData[roomIndex];
                  const roomAdults = roomData.adults || 0;
                  const roomChildren = Array.isArray(roomData.children) ? roomData.children : [];
                  const childrenAges = roomChildren.map(c => `${c.age || 0} tuổi`).join(', ');
                  
                  roomsDetails = [{
                    roomIndex: 1, // Chỉ hiển thị 1 phòng
                    adults: roomAdults,
                    children: roomChildren.length,
                    childrenAges: childrenAges || 'Không có',
                  }];
                }
              } else {
                // Booking chưa được assign hoặc có nhiều phòng, hiển thị tất cả
                roomsDetails = parsedRoomsData.map((roomData, roomIdx) => {
                  const roomAdults = roomData.adults || 0;
                  const roomChildren = Array.isArray(roomData.children) ? roomData.children : [];
                  const childrenAges = roomChildren.map(c => `${c.age || 0} tuổi`).join(', ');
                  
                  return {
                    roomIndex: roomIdx + 1,
                    adults: roomAdults,
                    children: roomChildren.length,
                    childrenAges: childrenAges || 'Không có',
                  };
                });
              }
            }
          } catch (e) {
            console.warn('Failed to parse roomsData in bookingDetail:', e);
          }
        }
        
        return {
          index: idx, // Thêm index để match với perItemServices
          code: b.code,
          roomTypeName: roomTypeName,
          pricePerNight: b.pricePerNight || 0,
          pricePerNightFormat: (b.pricePerNight || 0).toLocaleString('vi-VN'),
          rooms: b.rooms || 1,
          totalAmount: b.totalAmount || 0,
          totalAmountFormat: (b.totalAmount || 0).toLocaleString('vi-VN'),
          roomsDetails: roomsDetails, // Chi tiết từng phòng
        };
      })
    };

    res.render("admin/pages/hotel-booking-detail", {
      pageTitle: `Chi tiết đơn đặt phòng ${baseCode}`,
      bookingDetail,
      pathAdmin,
    });
  } catch (error) {
    console.error("hotel booking detail error:", error);
    res.status(500).render("admin/pages/error", {
      pageTitle: "Lỗi",
      message: "Có lỗi xảy ra khi tải chi tiết đơn đặt phòng",
    });
  }
};

/**
 * GET /admin/hotel/booking/room-management
 * Quản lý số phòng - xếp phòng cho booking
 */
module.exports.roomManagement = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Quản lý số phòng",
        bookingsData: { 
          pendingBookings: [], 
          rooms: [],
          activeTab: "room-management" 
        },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    // Lấy hotelId từ query params (nếu có nhiều khách sạn)
    let hotelId = req.query.hotelId || null;

    // Lấy tất cả hotels của company
    const hotelsQuery = { companyId, deleted: false };
    const hotels = await Hotel.find(hotelsQuery)
      .select("_id name rooms roomTypes")
      .lean();

    if (!hotels || hotels.length === 0) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Quản lý số phòng",
        bookingsData: { 
          pendingBookings: [], 
          rooms: [],
          hotels: [],
          activeTab: "room-management" 
        },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    // Nếu không có hotelId, redirect với hotelId của khách sạn đầu tiên
    if (!hotelId || hotelId === "all") {
      hotelId = String(hotels[0]._id);
      const urlParams = new URLSearchParams(req.query);
      urlParams.set("hotelId", hotelId);
      return res.redirect(`/${pathAdmin}/hotel/booking/room-management?${urlParams.toString()}`);
    }

    const selectedHotelId = hotelId;
    const selectedHotel = hotels.find(h => String(h._id) === selectedHotelId);

    if (!selectedHotel) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Quản lý số phòng",
        bookingsData: { 
          pendingBookings: [], 
          rooms: [],
          hotels,
          activeTab: "room-management" 
        },
        selectedHotelId, // Pass ở root level
        pathAdmin,
        isBookingManagement: true,
      });
    }

    // 1. Lấy bookings cần xếp phòng (roomId = null hoặc không tồn tại, status != cancelled)
    const pendingBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      $or: [
        { roomId: null },
        { roomId: { $exists: false } }
      ],
      status: { $ne: "cancelled" },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Format pending bookings
    const formattedPendingBookings = pendingBookings.map(b => {
      let roomTypeName = "Loại phòng";
      if (Array.isArray(selectedHotel.roomTypes) && b.roomTypeId) {
        const rt = selectedHotel.roomTypes.find(
          (rt) => String(rt._id) === String(b.roomTypeId)
        );
        if (rt && rt.name) roomTypeName = rt.name;
      }

      return {
        bookingId: b._id,
        code: b.code,
        customerName: b.guest?.fullName || "Khách lẻ",
        roomType: roomTypeName,
        roomTypeId: b.roomTypeId,
        roomCount: b.rooms || 1,
        checkIn: b.checkIn ? moment(b.checkIn).format("YYYY-MM-DD") : "",
        checkInDisplay: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "",
        checkOut: b.checkOut ? moment(b.checkOut).format("YYYY-MM-DD") : "",
        checkOutDisplay: b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "",
      };
    });

    // 2. Lấy tình trạng tất cả các phòng
    const rooms = selectedHotel.rooms || [];
    
    // Sắp xếp theo Tầng và Số phòng (tăng dần)
    rooms.sort((a, b) => {
      // Parse số từ floor (VD: "Tầng 1" -> 1, "1" -> 1)
      const floorA = parseInt(String(a.floor).replace(/\D/g, '')) || 0;
      const floorB = parseInt(String(b.floor).replace(/\D/g, '')) || 0;
      
      // So sánh floor trước
      if (floorA !== floorB) {
        return floorA - floorB;
      }
      
      // Nếu cùng floor, so sánh roomNumber
      const roomA = parseInt(String(a.roomNumber).replace(/\D/g, '')) || 0;
      const roomB = parseInt(String(b.roomNumber).replace(/\D/g, '')) || 0;
      
      return roomA - roomB;
    });
    
    const now = new Date();
    
    // Lấy bookings ĐANG DIỄN RA (CHỈ những booking đã nhận phòng - status = checked_in)
    const currentBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      roomId: { $ne: null },
      status: "checked_in", // CHỈ LẤY booking đã nhận phòng
      checkIn: { $lte: now }, // Đã check-in
      checkOut: { $gte: now }, // Chưa checkout
    }).lean();
    
    // Lấy TẤT CẢ bookings còn hiệu lực (để hiển thị trong modal chi tiết)
    const allBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      roomId: { $ne: null },
      status: { $nin: ["cancelled", "checked_out"] }, // Loại bỏ đã hủy và đã trả phòng
      checkOut: { $gte: now }, // Chưa checkout (bao gồm cả future bookings)
    }).lean();

    // Map roomId -> Set để check phòng đang sử dụng
    const occupiedRoomIds = new Set();
    currentBookings.forEach(b => {
      if (b.roomId) {
        occupiedRoomIds.add(String(b.roomId));
      }
    });
    
    // Map roomId -> array of ALL bookings (để hiển thị trong modal)
    const roomBookingsMap = {};
    allBookings.forEach(b => {
      if (b.roomId) {
        const roomIdStr = String(b.roomId);
        if (!roomBookingsMap[roomIdStr]) {
          roomBookingsMap[roomIdStr] = [];
        }
        // Parse roomsData để lấy chi tiết từng phòng
        let roomsDetails = [];
        if (b.roomsData) {
          try {
            const parsedRoomsData = JSON.parse(decodeURIComponent(b.roomsData));
            if (Array.isArray(parsedRoomsData)) {
              // Kiểm tra xem booking có suffix -R\d+ không (đã được assign phòng cụ thể)
              const roomNumberMatch = b.code.match(/-R(\d+)(-\d+)?$/);
              
              if (roomNumberMatch && b.rooms === 1) {
                // Booking đã được assign phòng cụ thể, chỉ hiển thị phòng tương ứng
                const roomNumber = parseInt(roomNumberMatch[1]);
                const roomIndex = roomNumber - 1; // -R1 → index 0, -R2 → index 1
                
                if (roomIndex >= 0 && roomIndex < parsedRoomsData.length) {
                  const roomData = parsedRoomsData[roomIndex];
                  const roomAdults = roomData.adults || 0;
                  const roomChildren = Array.isArray(roomData.children) ? roomData.children : [];
                  const childrenAges = roomChildren.map(c => `${c.age || 0} tuổi`).join(', ');
                  
                  roomsDetails = [{
                    roomIndex: 1, // Chỉ hiển thị 1 phòng
                    adults: roomAdults,
                    children: roomChildren.length,
                    childrenAges: childrenAges || 'Không có',
                  }];
                }
              } else {
                // Booking chưa được assign hoặc có nhiều phòng, hiển thị tất cả
                roomsDetails = parsedRoomsData.map((roomData, roomIdx) => {
                  const roomAdults = roomData.adults || 0;
                  const roomChildren = Array.isArray(roomData.children) ? roomData.children : [];
                  const childrenAges = roomChildren.map(c => `${c.age || 0} tuổi`).join(', ');
                  
                  return {
                    roomIndex: roomIdx + 1,
                    adults: roomAdults,
                    children: roomChildren.length,
                    childrenAges: childrenAges || 'Không có',
                  };
                });
              }
            }
          } catch (e) {
            console.warn('Failed to parse roomsData in roomManagement:', e);
          }
        }
        
        roomBookingsMap[roomIdStr].push({
          code: b.code,
          customerName: b.guest?.fullName || "Khách",
          customerPhone: b.guest?.phone || "",
          checkIn: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "",
          checkOut: b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "",
          status: b.status,
          rooms: b.rooms || 1,
          roomsDetails: roomsDetails, // Chi tiết từng phòng
        });
      }
    });

    // Format rooms với trạng thái
    const formattedRooms = rooms.map(room => {
      const roomTypeInfo = selectedHotel.roomTypes?.find(
        rt => String(rt._id) === String(room.roomTypeId)
      );
      
      const roomIdStr = String(room._id);
      const roomBookings = roomBookingsMap[roomIdStr] || [];
      const bookingCount = roomBookings.length;
      
      // Phòng "Đang sử dụng" chỉ khi có booking ĐANG DIỄN RA (checkIn <= now <= checkOut)
      let status = "Trống";
      let statusClass = "available";

      if (occupiedRoomIds.has(roomIdStr)) {
        status = "Đang sử dụng";
        statusClass = "occupied";
      }

      return {
        _id: roomIdStr,
        number: room.number || room.roomNumber || "N/A",
        roomType: roomTypeInfo?.name || "N/A",
        roomTypeId: String(room.roomTypeId || ""),
        floor: room.floor || "1",
        status,
        statusClass,
        bookingCount, // Tổng số bookings (bao gồm cả future)
        bookings: roomBookings, // Array of ALL bookings
      };
    });

    const bookingsData = {
      pendingBookings: formattedPendingBookings,
      rooms: formattedRooms,
      hotels,
      selectedHotelId,
      activeTab: "room-management",
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Quản lý số phòng",
      bookingsData,
      selectedHotelId, // Pass selectedHotelId ở root level để hotel-selector có thể access
      pathAdmin,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel roomManagement error:", error);
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Quản lý số phòng",
      bookingsData: { 
        pendingBookings: [], 
        rooms: [],
        activeTab: "room-management" 
      },
      pathAdmin,
      isBookingManagement: true,
    });
  }
};

/**
 * POST /admin/hotel/booking/assign-room
 * Assign phòng cụ thể cho booking
 * Nếu booking có nhiều phòng, tạo nhiều booking records riêng lẻ
 */
module.exports.assignRoom = async (req, res) => {
  try {
    const { bookingId, roomIds } = req.body;
    const companyId = req.account?.companyId || null;

    if (!bookingId || !roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return res.json({
        code: "error",
        message: "Thiếu thông tin booking hoặc phòng!",
      });
    }

    // Tìm booking gốc
    const originalBooking = await HotelBooking.findById(bookingId);
    if (!originalBooking) {
      return res.json({
        code: "error",
        message: "Không tìm thấy booking!",
      });
    }

    // Kiểm tra xem booking đã được assign phòng chưa
    if (originalBooking.roomId && originalBooking.roomId !== null) {
      return res.json({
        code: "error",
        message: "Booking này đã được xếp phòng rồi! Vui lòng hủy xếp phòng trước nếu muốn đổi phòng.",
      });
    }

    // Verify hotel belongs to company
    const hotel = await Hotel.findOne({
      _id: originalBooking.hotel.hotelId,
      companyId,
      deleted: false,
    });

    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không có quyền truy cập khách sạn này!",
      });
    }

    // Kiểm tra số lượng phòng khớp không
    const requiredRoomCount = originalBooking.rooms || 1;
    if (roomIds.length !== requiredRoomCount) {
      return res.json({
        code: "error",
        message: `Booking yêu cầu ${requiredRoomCount} phòng, nhưng bạn chọn ${roomIds.length} phòng!`,
      });
    }

    // Kiểm tra tất cả các phòng
    const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
    const allBookings = await HotelBooking.find({
      "hotel.hotelId": hotel._id,
      status: { $ne: "cancelled" },
      _id: { $ne: originalBooking._id }, // Loại trừ booking gốc
    }).lean();

    const availableRooms = getAvailableRoomsForType(
      hotel.rooms,
      originalBooking.roomTypeId,
      allBookings,
      originalBooking.checkIn,
      originalBooking.checkOut
    );

    // Validate tất cả roomIds
    for (const roomId of roomIds) {
      const room = hotel.rooms?.find(r => String(r._id) === String(roomId));
      if (!room) {
        return res.json({
          code: "error",
          message: `Không tìm thấy phòng ${roomId}!`,
        });
      }

      if (String(room.roomTypeId) !== String(originalBooking.roomTypeId)) {
        return res.json({
          code: "error",
          message: `Phòng ${room.number || room.roomNumber} không đúng loại!`,
        });
      }

      const isRoomAvailable = availableRooms.some(r => String(r._id) === String(roomId));
      if (!isRoomAvailable) {
        return res.json({
          code: "error",
          message: `Phòng ${room.number || room.roomNumber} đã được đặt trong khoảng thời gian này!`,
        });
      }
    }

    // Nếu chỉ có 1 phòng, update booking gốc
    if (roomIds.length === 1) {
      originalBooking.roomId = roomIds[0];
      originalBooking.rooms = 1;
      // Giữ nguyên status hiện tại (pending, checked_in, checked_out, cancelled)
      await originalBooking.save();

      return res.json({
        code: "success",
        message: "Đã xếp phòng thành công!",
      });
    }

    // Nếu có nhiều phòng, tạo nhiều bookings riêng lẻ
    const createdBookings = [];
    const baseCode = originalBooking.code;
    
    for (let i = 0; i < roomIds.length; i++) {
      const roomId = roomIds[i];
      
      // Tạo code mới với suffix R (Room) để phân biệt với booking từ client
      // VD: HB123-R1, HB123-R2, HB123-1-R1, HB123-1-R2
      let newCode = `${baseCode}-R${i + 1}`;
      
      // Double check xem code có tồn tại không
      let existingBooking = await HotelBooking.findOne({ code: newCode });
      let attempt = 0;
      
      // Nếu code đã tồn tại, thử thêm timestamp
      while (existingBooking && attempt < 10) {
        newCode = `${baseCode}-R${i + 1}-${Date.now()}`;
        existingBooking = await HotelBooking.findOne({ code: newCode });
        attempt++;
      }
      
      if (existingBooking) {
        console.error(`Cannot create unique code for booking ${baseCode}, skipping room ${i + 1}`);
        continue;
      }
      
      const newBooking = new HotelBooking({
        code: newCode,
        userId: originalBooking.userId,
        guest: originalBooking.guest,
        checkIn: originalBooking.checkIn,
        checkOut: originalBooking.checkOut,
        adults: originalBooking.adults,
        children: originalBooking.children,
        childrenDetails: originalBooking.childrenDetails,
        rooms: 1, // Mỗi booking mới chỉ 1 phòng
        roomsData: originalBooking.roomsData,
        roomId: roomId,
        roomTypeId: originalBooking.roomTypeId,
        currency: originalBooking.currency,
        pricePerNight: originalBooking.pricePerNight,
        totalNights: originalBooking.totalNights,
        totalAmount: originalBooking.pricePerNight * originalBooking.totalNights,
        hotel: originalBooking.hotel,
        orderTotal: originalBooking.orderTotal, // Giữ nguyên tổng tiền đơn
        additionalServices: originalBooking.additionalServices,
        status: originalBooking.status || "pending",
        paymentStatus: originalBooking.paymentStatus || "unpaid",
        paymentMethod: originalBooking.paymentMethod,
        note: originalBooking.note,
      });

      await newBooking.save();
      createdBookings.push(newBooking);
    }

    // Xóa booking gốc (hoặc cancel nó)
    await HotelBooking.deleteOne({ _id: originalBooking._id });

    return res.json({
      code: "success",
      message: `Đã xếp ${roomIds.length} phòng thành công!`,
    });
  } catch (error) {
    console.error("assignRoom error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi xếp phòng!",
    });
  }
};

/**
 * POST /admin/hotel/booking/update-status
 * Cập nhật trạng thái booking và thanh toán
 */
module.exports.updateBookingStatus = async (req, res) => {
  try {
    const { bookingId, status, paymentStatus } = req.body;
    const companyId = req.account?.companyId || null;

    if (!bookingId) {
      return res.json({
        code: "error",
        message: "Thiếu thông tin booking!",
      });
    }

    // Tìm booking
    const booking = await HotelBooking.findById(bookingId);
    if (!booking) {
      return res.json({
        code: "error",
        message: "Không tìm thấy booking!",
      });
    }

    // Verify hotel belongs to company
    const hotel = await Hotel.findOne({
      _id: booking.hotel.hotelId,
      companyId,
      deleted: false,
    });

    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không có quyền truy cập khách sạn này!",
      });
    }

    // Extract base code và tìm TẤT CẢ bookings cùng group
    let baseCode = booking.code;
    baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
    while (baseCode.match(/-\d+$/)) {
      baseCode = baseCode.replace(/-\d+$/, '');
    }
    
    const allBookingsInGroup = await HotelBooking.find({
      code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+)?(-\\d+)?$`), // Match HB123, HB123-1, HB123-R1, HB123-1-R1, etc.
    });

    // Cập nhật status và paymentStatus cho TẤT CẢ bookings trong cùng group
    const updatePromises = allBookingsInGroup.map(async (b) => {
      if (status) {
        b.status = status;
      }
      if (paymentStatus) {
        b.paymentStatus = paymentStatus;
      }
      return b.save();
    });

    await Promise.all(updatePromises);

    return res.json({
      code: "success",
      message: "Cập nhật trạng thái thành công!",
    });
  } catch (error) {
    console.error("updateBookingStatus error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi cập nhật trạng thái!",
    });
  }
};

module.exports.bookingCalendar = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      const now = moment();
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Lịch phòng",
        bookingsData: { 
          rooms: [], 
          activeTab: "calendar", 
          currentMonth: `Tháng ${now.month() + 1}, ${now.year()}`,
          currentYear: now.year(),
          currentMonthNum: now.month() + 1
        },
        pathAdmin,
        moment, // Pass moment để dùng trong template
        isBookingManagement: true, // Flag để ẩn "Tất cả khách sạn" trong selector
      });
    }

    // Lấy tháng/năm từ query params, mặc định là tháng hiện tại
    const year = parseInt(req.query.year) || moment().year();
    const month = parseInt(req.query.month) || moment().month() + 1; // moment month is 0-based
    let hotelId = req.query.hotelId || null; // Lấy hotelId từ query params
    
    // Lấy tất cả hotels của company (để hiển thị trong selector)
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name rooms roomTypes")
      .lean();
    
    // Nếu không có hotelId và đang ở trang calendar, chọn hotel đầu tiên hoặc redirect
    if (!hotelId || hotelId === "all") {
      if (hotels.length > 0) {
        // Chọn hotel đầu tiên làm mặc định
        hotelId = String(hotels[0]._id);
        // Redirect với hotelId trong URL
        const urlParams = new URLSearchParams(req.query);
        urlParams.set("hotelId", hotelId);
        return res.redirect(`/${pathAdmin}/hotel/booking/calendar?${urlParams.toString()}`);
      } else {
        // Không có hotel nào, hiển thị trang trống
        const now = moment();
        return res.render("admin/pages/hotel-booking", {
          pageTitle: "Lịch phòng",
          bookingsData: { 
            rooms: [], 
            activeTab: "calendar", 
            currentMonth: `Tháng ${now.month() + 1}, ${now.year()}`,
            currentYear: now.year(),
            currentMonthNum: now.month() + 1
          },
          hotelList: [],
          selectedHotelId: null,
          pathAdmin,
          moment,
          isBookingManagement: true,
        });
      }
    }
    const currentDate = moment(`${year}-${month}-01`, "YYYY-M-DD");
    const currentMonthText = `Tháng ${month}, ${year}`;

    // Tính toán ngày đầu và cuối của tháng để lấy bookings
    const startOfMonth = currentDate.startOf("month").toDate();
    const endOfMonth = currentDate.endOf("month").toDate();

    // Lọc hotels theo hotelId (đã đảm bảo hotelId không null và không phải "all" ở trên)
    const filteredHotels = hotels.filter(h => String(h._id) === String(hotelId));

    // Tạo map để lấy tên loại phòng (từ tất cả hotels để đảm bảo có đủ thông tin)
    const roomTypesMap = {};
    hotels.forEach(hotel => {
      if (hotel.roomTypes && Array.isArray(hotel.roomTypes)) {
        hotel.roomTypes.forEach(rt => {
          roomTypesMap[String(rt._id)] = rt.name;
        });
      }
    });

    // Lấy phòng từ hotels đã lọc (chỉ lấy phòng của hotel được chọn nếu có)
    const allRooms = [];
    filteredHotels.forEach(hotel => {
      if (hotel.rooms && Array.isArray(hotel.rooms)) {
        hotel.rooms.forEach(room => {
          const roomTypeName = roomTypesMap[String(room.roomTypeId)] || "Chưa xác định";
          allRooms.push({
            _id: room._id,
            roomNumber: room.roomNumber,
            floor: room.floor,
            roomType: roomTypeName,
            hotelId: hotel._id,
            hotelName: hotel.name,
            roomTypeId: room.roomTypeId
          });
        });
      }
    });

    // Sắp xếp phòng theo Tầng và Số phòng (tăng dần)
    allRooms.sort((a, b) => {
      // Parse số từ floor (VD: "Tầng 1" -> 1, "1" -> 1)
      const floorA = parseInt(String(a.floor).replace(/\D/g, '')) || 0;
      const floorB = parseInt(String(b.floor).replace(/\D/g, '')) || 0;
      
      // So sánh floor trước
      if (floorA !== floorB) {
        return floorA - floorB;
      }
      
      // Nếu cùng floor, so sánh roomNumber
      const roomA = parseInt(String(a.roomNumber).replace(/\D/g, '')) || 0;
      const roomB = parseInt(String(b.roomNumber).replace(/\D/g, '')) || 0;
      
      return roomA - roomB;
    });

    // Lấy bookings trong tháng của khách sạn được chọn (chỉ bookings còn hiệu lực)
    const bookings = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      checkIn: { $lte: endOfMonth },
      checkOut: { $gte: startOfMonth },
      status: { $nin: ["cancelled", "checked_out"] }, // Loại bỏ đã hủy và đã trả phòng
      roomId: { $ne: null }, // Chỉ lấy bookings đã được assign phòng
    })
      .select("code guest checkIn checkOut status roomId")
      .lean();

    // Map roomId -> bookings
    const roomBookingsMap = {};
    bookings.forEach(b => {
      const roomIdStr = String(b.roomId);
      if (!roomBookingsMap[roomIdStr]) {
        roomBookingsMap[roomIdStr] = [];
      }
      roomBookingsMap[roomIdStr].push({
        bookingId: b.code,
        code: b.code,
        guestName: b.guest?.fullName || "Khách",
        startDate: b.checkIn,
        endDate: b.checkOut,
        status: b.status,
      });
    });

    // Map bookings với phòng
    const roomsWithBookings = allRooms.map(room => {
      const roomIdStr = String(room._id);
      const roomBookings = roomBookingsMap[roomIdStr] || [];
      
      return {
        roomNumber: room.roomNumber,
        roomType: room.roomType,
        bookings: roomBookings
      };
    });

    const calendarData = {
      currentMonth: currentMonthText,
      currentYear: year,
      currentMonthNum: month,
      rooms: roomsWithBookings,
      activeTab: "calendar"
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Lịch phòng",
      bookingsData: calendarData,
      selectedHotelId: hotelId, // Hotel đang được chọn - ở root level để hotel-selector có thể access
      pathAdmin,
      moment, // Pass moment để dùng trong template
      isBookingManagement: true, // Flag để ẩn "Tất cả khách sạn" trong selector
    });
  } catch (error) {
    console.error("hotel booking calendar error:", error);
    const now = moment();
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Lịch phòng",
      bookingsData: { 
        rooms: [], 
        activeTab: "calendar",
        currentMonth: `Tháng ${now.month() + 1}, ${now.year()}`,
        currentYear: now.year(),
        currentMonthNum: now.month() + 1
      },
      hotelList: [],
      selectedHotelId: null,
      pathAdmin,
      moment, // Pass moment để dùng trong template
      isBookingManagement: true, // Flag để ẩn "Tất cả khách sạn" trong selector
    });
  }
};

/**
 * GET /admin/hotel/booking/guest-list
 * Danh sách khách hàng đã được xếp phòng cụ thể
 */
module.exports.guestList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Danh sách khách hàng",
        bookingsData: { 
          guests: [], 
          activeTab: "guest-list" 
        },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    // Lấy hotelId từ query params (nếu có nhiều khách sạn)
    let hotelId = req.query.hotelId || null;

    // Lấy tất cả hotels của company
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name rooms roomTypes")
      .lean();

    // Nếu không có hotelId, chọn hotel đầu tiên hoặc redirect
    if (!hotelId || hotelId === "all") {
      if (hotels.length > 0) {
        hotelId = String(hotels[0]._id);
        const urlParams = new URLSearchParams(req.query);
        urlParams.set("hotelId", hotelId);
        return res.redirect(`/${pathAdmin}/hotel/booking/guest-list?${urlParams.toString()}`);
      } else {
        return res.render("admin/pages/hotel-booking", {
          pageTitle: "Danh sách khách hàng",
          bookingsData: { 
            guests: [], 
            activeTab: "guest-list" 
          },
          hotelList: [],
          selectedHotelId: null,
          pathAdmin,
          isBookingManagement: true,
        });
      }
    }

    // Tạo map để lấy tên loại phòng
    const roomTypesMap = {};
    hotels.forEach(hotel => {
      if (hotel.roomTypes && Array.isArray(hotel.roomTypes)) {
        hotel.roomTypes.forEach(rt => {
          roomTypesMap[String(rt._id)] = rt.name;
        });
      }
    });

    // Tạo map để lấy số phòng
    const roomsMap = {};
    hotels.forEach(hotel => {
      if (hotel.rooms && Array.isArray(hotel.rooms)) {
        hotel.rooms.forEach(room => {
          roomsMap[String(room._id)] = room.roomNumber;
        });
      }
    });

    // Lấy search query từ URL
    const searchGuestName = (req.query.guestName || "").trim();
    const searchCheckInDate = req.query.checkInDate || null;
    const searchCheckOutDate = req.query.checkOutDate || null;

    // Tạo filter điều kiện tìm kiếm
    const bookingFilter = {
      "hotel.hotelId": hotelId,
      roomId: { $ne: null, $exists: true }, // Đã được assign phòng
      status: { $nin: ["cancelled"] }, // Loại bỏ đã hủy
    };

    // Nếu có search theo tên khách hàng
    if (searchGuestName) {
      bookingFilter["guest.fullName"] = new RegExp(searchGuestName, "i");
    }

    // Nếu có search theo ngày check-in
    if (searchCheckInDate) {
      const checkInStart = moment(searchCheckInDate).startOf("day").toDate();
      const checkInEnd = moment(searchCheckInDate).endOf("day").toDate();
      bookingFilter.checkIn = {
        $gte: checkInStart,
        $lte: checkInEnd,
      };
    }

    // Nếu có search theo ngày check-out
    if (searchCheckOutDate) {
      const checkOutStart = moment(searchCheckOutDate).startOf("day").toDate();
      const checkOutEnd = moment(searchCheckOutDate).endOf("day").toDate();
      bookingFilter.checkOut = {
        $gte: checkOutStart,
        $lte: checkOutEnd,
      };
    }

    // Lấy tất cả bookings đã được assign phòng cụ thể
    const bookings = await HotelBooking.find(bookingFilter)
      .select("code guest checkIn checkOut adults children childrenDetails roomId roomTypeId status roomsData")
      .sort({ checkIn: -1 }) // Sắp xếp theo ngày check-in mới nhất
      .lean();

    // Chuyển đổi bookings thành danh sách guests
    const guests = bookings.map(booking => {
      const roomTypeName = roomTypesMap[String(booking.roomTypeId)] || "Chưa xác định";
      const roomNumber = roomsMap[String(booking.roomId)] || "N/A";
      
      // Parse roomsData nếu có
      let roomsDetails = [];
      if (booking.roomsData) {
        try {
          roomsDetails = JSON.parse(decodeURIComponent(booking.roomsData));
        } catch (e) {
          console.error("Failed to parse roomsData:", e);
        }
      }

      // Nếu không có roomsDetails, dùng thông tin cơ bản
      if (!roomsDetails || roomsDetails.length === 0) {
        roomsDetails = [{
          adults: booking.adults || 0,
          children: booking.childrenDetails || []
        }];
      }

      // Lấy thông tin chi tiết từ phòng tương ứng
      // Nếu booking có suffix -R\d+, lấy phòng thứ đó
      let roomDetail = roomsDetails[0] || {};
      const roomNumberMatch = booking.code.match(/-R(\d+)(-\d+)?$/);
      
      if (roomNumberMatch && roomsDetails.length > 1) {
        const roomNumber = parseInt(roomNumberMatch[1]);
        const roomIndex = roomNumber - 1; // -R1 → index 0, -R2 → index 1
        
        if (roomIndex >= 0 && roomIndex < roomsDetails.length) {
          roomDetail = roomsDetails[roomIndex];
        }
      }
      
      const adults = roomDetail.adults || booking.adults || 0;
      const childrenInRoom = roomDetail.children || booking.childrenDetails || [];
      const childrenCount = Array.isArray(childrenInRoom) ? childrenInRoom.length : (booking.children || 0);

      return {
        bookingCode: booking.code,
        guestName: booking.guest?.fullName || "N/A",
        guestEmail: booking.guest?.email || "N/A",
        guestPhone: booking.guest?.phone || "",
        checkInDisplay: moment(booking.checkIn).format("DD/MM/YYYY"),
        checkOutDisplay: moment(booking.checkOut).format("DD/MM/YYYY"),
        roomType: roomTypeName,
        roomNumber: roomNumber,
        adults: adults,
        children: childrenCount,
        childrenDetails: Array.isArray(childrenInRoom) ? childrenInRoom : [],
        status: booking.status,
      };
    });

    const guestListData = {
      guests: guests,
      activeTab: "guest-list",
      searchGuestName: searchGuestName,
      searchCheckInDate: searchCheckInDate,
      searchCheckOutDate: searchCheckOutDate,
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Danh sách khách hàng",
      bookingsData: guestListData,
      selectedHotelId: hotelId,
      pathAdmin,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel guest list error:", error);
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Danh sách khách hàng",
      bookingsData: { 
        guests: [], 
        activeTab: "guest-list" 
      },
      hotelList: [],
      selectedHotelId: null,
      pathAdmin,
      isBookingManagement: true,
    });
  }
};

module.exports.roomsList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    // Lấy danh sách hotels của company
    let hotelList = [];
    if (companyId) {
      hotelList = await Hotel.find({ companyId, deleted: false })
        .select("name address _id numberOfRooms")
        .sort({ name: 1 })
        .lean();
      
      // Nếu không có hotelId trong URL, redirect đến hotel đầu tiên
      if (!req.query.hotelId && hotelList.length > 0) {
        const firstHotelId = hotelList[0]._id;
        return res.redirect(`/${pathAdmin}/hotel/rooms/list?hotelId=${firstHotelId}`);
      }
      
      // Đếm số phòng thực tế từ roomTypes (nếu có)
      hotelList = hotelList.map(hotel => {
        // Tính số phòng từ numberOfRooms hoặc ước tính
        const roomCount = hotel.numberOfRooms || 0;
        return {
          _id: hotel._id,
          name: hotel.name,
          address: hotel.address || "-",
          roomCount: roomCount
        };
      });
    }

    // Lọc theo hotelId nếu có
    const hotelId = req.query.hotelId;
    if (hotelId) {
      hotelList = hotelList.filter(h => String(h._id) === String(hotelId));
    }

    return res.render("admin/pages/hotel-rooms-list-hotels", {
      pageTitle: "Danh sách phòng",
      hotelList: hotelList,
      pathAdmin,
      hotelId: hotelId || null,
      selectedHotelId: hotelId || null,
    });
  } catch (error) {
    console.error("hotel rooms list error:", error);
    return res.render("admin/pages/hotel-rooms-list-hotels", {
      pageTitle: "Danh sách phòng",
      hotelList: [],
      pathAdmin,
      hotelId: null,
    });
  }
};

module.exports.roomsListByHotel = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    const hotelId = req.params.hotelId;
    
    // Lấy thông tin hotel
    let hotel = null;
    if (hotelId && companyId) {
      hotel = await Hotel.findOne({ _id: hotelId, companyId, deleted: false });
    }
    
    if (!hotel) {
      return res.redirect(`/${pathAdmin}/hotel/rooms/list`);
    }
    
    // Lấy danh sách phòng từ database
    const hotelRooms = hotel.rooms || [];
    
    // Sắp xếp theo Tầng và Số phòng (tăng dần)
    hotelRooms.sort((a, b) => {
      // Parse số từ floor (VD: "Tầng 1" -> 1, "1" -> 1)
      const floorA = parseInt(String(a.floor).replace(/\D/g, '')) || 0;
      const floorB = parseInt(String(b.floor).replace(/\D/g, '')) || 0;
      
      // So sánh floor trước
      if (floorA !== floorB) {
        return floorA - floorB;
      }
      
      // Nếu cùng floor, so sánh roomNumber
      const roomA = parseInt(String(a.roomNumber).replace(/\D/g, '')) || 0;
      const roomB = parseInt(String(b.roomNumber).replace(/\D/g, '')) || 0;
      
      return roomA - roomB;
    });
    
    // Lấy thông tin room types để hiển thị tên loại phòng
    const roomTypesMap = {};
    hotel.roomTypes.forEach(rt => {
      roomTypesMap[String(rt._id)] = rt.name;
    });

    // Lấy bookings ĐANG DIỄN RA (đã check-in nhưng chưa checkout) để xác định trạng thái phòng
    const now = new Date();
    const currentBookings = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      roomId: { $ne: null },
      status: { $nin: ["cancelled", "checked_out"] }, // Loại bỏ đã hủy và đã trả phòng
      checkIn: { $lte: now }, // Đã check-in
      checkOut: { $gte: now }, // Chưa checkout
    }).lean();
    
    // Map roomId -> Set để check phòng đang sử dụng
    const occupiedRoomIds = new Set();
    currentBookings.forEach(b => {
      if (b.roomId) {
        occupiedRoomIds.add(String(b.roomId));
      }
    });

    // Format dữ liệu phòng để hiển thị
    const formattedRooms = hotelRooms.map(room => {
      const roomIdStr = String(room._id);
      
      // Xác định trạng thái dựa trên bookings thực tế
      // Nếu phòng có booking đang diễn ra (checkIn <= now <= checkOut) thì "Đang sử dụng"
      // Nếu phòng có status = 'out_of_service' thì "Ngừng hoạt động"
      // Ngược lại thì "Trống"
      let statusText = 'Trống';
      let statusColor = 'green';
      
      if (occupiedRoomIds.has(roomIdStr)) {
        statusText = 'Đang sử dụng';
        statusColor = 'red';
      } else if (room.status === 'out_of_service') {
        statusText = 'Ngừng hoạt động';
        statusColor = 'red';
      } else if (room.status === 'cleaning') {
        statusText = 'Đang dọn';
        statusColor = 'yellow';
      }
      
      return {
        _id: room._id,
        roomNumber: room.roomNumber,
        floor: room.floor,
        roomType: roomTypesMap[String(room.roomTypeId)] || 'Chưa xác định',
        roomTypeId: room.roomTypeId,
        status: statusText,
        statusColor: statusColor,
        statusValue: room.status // Giữ lại giá trị status gốc để edit
      };
    });

    // Tính summary dựa trên trạng thái thực tế
    const summary = {
      total: hotelRooms.length,
      vacant: formattedRooms.filter(r => r.status === 'Trống').length,
      inUse: formattedRooms.filter(r => r.status === 'Đang sử dụng').length,
      outOfService: formattedRooms.filter(r => r.status === 'Ngừng hoạt động').length,
      cleaning: formattedRooms.filter(r => r.status === 'Đang dọn').length
    };

    const roomsData = {
      rooms: formattedRooms,
      summary: summary
    };

    return res.render("admin/pages/hotel-rooms-list", {
      pageTitle: `Danh sách phòng - ${hotel.name}`,
      roomsData,
      hotel: {
        _id: hotel._id,
        name: hotel.name
      },
      pathAdmin,
      hotelId: hotelId,
    });
  } catch (error) {
    console.error("hotel rooms list by hotel error:", error);
    return res.redirect(`/${pathAdmin}/hotel/rooms/list`);
  }
};

module.exports.roomCreate = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    const hotelId = req.query.hotelId || null;
    
    // Lấy danh sách hotels để chọn hotel (nếu chưa chọn)
    let hotelList = [];
    if (companyId) {
      hotelList = await Hotel.find({ companyId, deleted: false })
        .select("name _id")
        .sort({ name: 1 })
        .lean();
    }
    
    // Lấy danh sách room types từ hotel đã chọn (nếu có)
    let roomTypes = [];
    if (hotelId && hotelId !== "all") {
      const hotel = await Hotel.findOne({ _id: hotelId, companyId, deleted: false });
      if (hotel && hotel.roomTypes) {
        roomTypes = hotel.roomTypes.map(rt => ({
          _id: rt._id,
          name: rt.name
        }));
      }
    }

    return res.render("admin/pages/hotel-room-individual-create", {
      pageTitle: "Thêm phòng mới",
      hotelId: hotelId,
      hotelList: hotelList,
      roomTypes: roomTypes,
      pathAdmin,
    });
  } catch (error) {
    console.error("hotel room create error:", error);
    return res.render("admin/pages/hotel-room-individual-create", {
      pageTitle: "Thêm phòng mới",
      hotelId: null,
      hotelList: [],
      roomTypes: [],
      pathAdmin,
    });
  }
};

module.exports.customersList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      return res.render("admin/pages/hotel-customers", {
        pageTitle: "Khách hàng",
        customersData: { customers: [] },
        pathAdmin,
        hotelList: [],
        selectedHotelId: null,
        isBookingManagement: true,
      });
    }

    // Lấy tất cả khách sạn của company để hiển thị selector
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name")
      .lean();

    if (!hotels || hotels.length === 0) {
      return res.render("admin/pages/hotel-customers", {
        pageTitle: "Khách hàng",
        customersData: { customers: [] },
        pathAdmin,
        hotelList: [],
        selectedHotelId: null,
        isBookingManagement: true,
      });
    }

    // Lấy hotelId từ query, nếu chưa có thì redirect với hotel đầu tiên
    let selectedHotelId = req.query.hotelId || null;
    if (!selectedHotelId || selectedHotelId === "all") {
      selectedHotelId = String(hotels[0]._id);
      const urlParams = new URLSearchParams(req.query);
      urlParams.set("hotelId", selectedHotelId);
      return res.redirect(`/${pathAdmin}/hotel/customers?${urlParams.toString()}`);
    }

    // Helper function để extract base code
    const extractBaseCode = (code) => {
      let baseCode = code;
      baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
      while (baseCode.match(/-\d+$/)) {
        baseCode = baseCode.replace(/-\d+$/, '');
      }
      return baseCode;
    };

    // Lấy tất cả bookings của hotel được chọn
    const bookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Group bookings theo base code để tránh đếm trùng
    const bookingGroupsByCode = {};
    bookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!bookingGroupsByCode[baseCode]) {
        bookingGroupsByCode[baseCode] = {
          baseCode: baseCode,
          bookings: [],
          firstBooking: b, // Lưu booking đầu tiên để lấy thông tin
        };
      }
      bookingGroupsByCode[baseCode].bookings.push(b);
    });

    // Chuyển thành array và tính tổng rooms cho mỗi group
    const uniqueBookings = Object.values(bookingGroupsByCode).map(group => {
      const b = group.firstBooking;
      const totalRooms = group.bookings.reduce((sum, booking) => sum + (booking.rooms || 1), 0);
      return {
        ...b,
        totalRooms: totalRooms,
        baseCode: group.baseCode,
      };
    });

    // Group bookings theo khách hàng (email hoặc phone)
    const customerMap = {};
    
    uniqueBookings.forEach(b => {
      const guestEmail = b.guest?.email || "";
      const guestPhone = b.guest?.phone || "";
      const guestName = b.guest?.fullName || "Khách lẻ";
      
      // Dùng email làm key chính, nếu không có thì dùng phone
      const customerKey = guestEmail || guestPhone || `guest_${b._id}`;
      
      if (!customerMap[customerKey]) {
        // Lấy initials từ tên (2 chữ cái đầu)
        const nameParts = guestName.split(" ");
        let initials = "KL";
        if (nameParts.length >= 2) {
          initials = (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
        } else if (nameParts.length === 1 && nameParts[0].length >= 2) {
          initials = nameParts[0].substring(0, 2).toUpperCase();
        }
        
        customerMap[customerKey] = {
          id: customerKey,
          initials: initials,
          name: guestName,
          email: guestEmail || "—",
          phone: guestPhone || "—",
          bookings: 0,
          spending: 0,
          lastActivity: null,
          bookingList: [], // Lưu danh sách bookings (đã group)
        };
      }
      
      // Cập nhật thống kê (chỉ đếm 1 lần cho mỗi base code)
      customerMap[customerKey].bookings += 1;
      customerMap[customerKey].spending += Number(b.orderTotal || b.totalAmount || 0);
      
      // Thêm booking vào danh sách (đã group)
      customerMap[customerKey].bookingList.push({
        code: b.baseCode, // Dùng base code
        checkIn: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "—",
        checkOut: b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "—",
        totalAmount: Math.round(Number(b.orderTotal || b.totalAmount || 0) / 1000),
        status: b.status,
        createdAt: b.createdAt ? moment(b.createdAt).format("DD/MM/YYYY") : "—",
        rooms: b.totalRooms,
      });
      
      // Cập nhật lastActivity (booking mới nhất)
      if (!customerMap[customerKey].lastActivity || b.createdAt > customerMap[customerKey].lastActivity) {
        customerMap[customerKey].lastActivity = b.createdAt;
      }
    });

    // Chuyển map thành array và format
    const customers = Object.values(customerMap).map(c => {
      return {
        ...c,
        spending: Math.round(c.spending / 1000), // Chuyển sang K
        lastActivity: c.lastActivity ? moment(c.lastActivity).format("DD/MM/YYYY") : "—",
        isVIP: c.bookings >= 5 || c.spending >= 5000, // VIP nếu >= 5 bookings hoặc >= 5M
        bookingList: c.bookingList, // Bookings đã được group ở trên
      };
    });

    // Sắp xếp theo số bookings giảm dần
    customers.sort((a, b) => b.bookings - a.bookings);

    const customersData = {
      customers,
    };

    return res.render("admin/pages/hotel-customers", {
      pageTitle: "Khách hàng",
      customersData,
      pathAdmin,
      hotelList: hotels,
      selectedHotelId,
      isBookingManagement: true, // dùng để ẩn 'Tất cả khách sạn' trong selector
    });
  } catch (error) {
    console.error("hotel customers list error:", error);
    return res.render("admin/pages/hotel-customers", {
      pageTitle: "Khách hàng",
      customersData: { customers: [] },
      pathAdmin,
      hotelList: [],
      selectedHotelId: null,
      isBookingManagement: true,
    });
  }
};

module.exports.roomCreatePost = async (req, res) => {
  try {
    const { hotelId, floor, roomTypeId, rooms } = req.body;
    const companyId = req.account?.companyId || null;

    if (!hotelId || !floor || !roomTypeId || !rooms || !Array.isArray(rooms) || rooms.length === 0) {
      return res.json({
        code: "error",
        message: "Dữ liệu không hợp lệ!",
      });
    }

    // Tìm hotel
    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn!",
      });
    }

    // Kiểm tra roomTypeId có tồn tại không
    const roomType = hotel.roomTypes.find(rt => String(rt._id) === String(roomTypeId));
    if (!roomType) {
      return res.json({
        code: "error",
        message: "Không tìm thấy loại phòng!",
      });
    }

    // Xử lý và lưu các phòng vào database
    // Nếu roomNumber chứa dấu phẩy, tách thành nhiều phòng
    const roomsToAdd = [];
    rooms.forEach(room => {
      // Tách roomNumber nếu có dấu phẩy (VD: "101, 102, 103" -> ["101", "102", "103"])
      const roomNumbers = room.roomNumber.split(',').map(r => r.trim()).filter(r => r);
      
      roomNumbers.forEach(roomNum => {
        roomsToAdd.push({
          roomNumber: roomNum,
          floor: floor,
          roomTypeId: roomTypeId,
          status: room.status
        });
      });
    });

    // Thêm các phòng vào mảng rooms của hotel
    hotel.rooms.push(...roomsToAdd);
    hotel.updatedBy = req.account.id;

    await hotel.save();

    return res.json({
      code: "success",
      message: `Đã thêm ${roomsToAdd.length} phòng thành công!`,
    });
  } catch (error) {
    console.error("hotel room create post error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi thêm phòng!",
    });
  }
};

module.exports.roomEdit = async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;
    const companyId = req.account?.companyId || null;

    // Tìm hotel
    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.redirect(`/${pathAdmin}/hotel/rooms/list`);
    }

    // Tìm phòng
    const room = hotel.rooms.find(r => String(r._id) === String(roomId));
    if (!room) {
      return res.redirect(`/${pathAdmin}/hotel/${hotelId}/rooms/list`);
    }

    // Lấy danh sách room types để hiển thị trong dropdown
    const roomTypes = hotel.roomTypes.map(rt => ({
      _id: rt._id,
      name: rt.name
    }));

    return res.render("admin/pages/hotel-room-edit", {
      pageTitle: `Chỉnh sửa phòng - ${room.roomNumber}`,
      hotel: {
        _id: hotel._id,
        name: hotel.name
      },
      room: room,
      roomTypes: roomTypes,
      pathAdmin,
      hotelId: hotelId,
    });
  } catch (error) {
    console.error("hotel room edit error:", error);
    return res.redirect(`/${pathAdmin}/hotel/rooms/list`);
  }
};

module.exports.roomEditPatch = async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;
    const companyId = req.account?.companyId || null;

    // Tìm hotel
    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn!",
      });
    }

    // Tìm phòng
    const room = hotel.rooms.find(r => String(r._id) === String(roomId));
    if (!room) {
      return res.json({
        code: "error",
        message: "Không tìm thấy phòng!",
      });
    }

    // Cập nhật thông tin phòng
    if (req.body.roomNumber) room.roomNumber = req.body.roomNumber;
    if (req.body.floor) room.floor = req.body.floor;
    if (req.body.roomTypeId) room.roomTypeId = req.body.roomTypeId;
    if (req.body.status) {
      const validStatuses = ["vacant", "occupied", "cleaning", "out_of_service"];
      if (validStatuses.includes(req.body.status)) {
        room.status = req.body.status;
      }
    }

    hotel.updatedBy = req.account.id;
    await hotel.save();

    return res.json({
      code: "success",
      message: "Cập nhật phòng thành công!",
    });
  } catch (error) {
    console.error("hotel room edit patch error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi cập nhật phòng!",
    });
  }
};

module.exports.paymentsList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    if (!companyId) {
      return res.render("admin/pages/hotel-payments", {
        pageTitle: "Thanh toán",
        paymentsData: { invoices: [], summary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 } },
        pathAdmin,
        hotelList: [],
        selectedHotelId: null,
        isBookingManagement: true,
      });
    }

    // Lấy tất cả khách sạn của company để hiển thị selector
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name")
      .lean();

    if (!hotels || hotels.length === 0) {
      return res.render("admin/pages/hotel-payments", {
        pageTitle: "Thanh toán",
        paymentsData: { invoices: [], summary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 } },
        pathAdmin,
        hotelList: [],
        selectedHotelId: null,
        isBookingManagement: true,
      });
    }

    // Lấy hotelId từ query, nếu chưa có thì redirect với hotel đầu tiên
    let selectedHotelId = req.query.hotelId || null;
    if (!selectedHotelId || selectedHotelId === "all") {
      selectedHotelId = String(hotels[0]._id);
      const urlParams = new URLSearchParams(req.query);
      urlParams.set("hotelId", selectedHotelId);
      return res.redirect(`/${pathAdmin}/hotel/payments?${urlParams.toString()}`);
    }

    // Lấy bookings của hotel được chọn
    const rawBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Helper function để extract base code
    const extractBaseCode = (code) => {
      let baseCode = code;
      baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
      while (baseCode.match(/-\d+$/)) {
        baseCode = baseCode.replace(/-\d+$/, '');
      }
      return baseCode;
    };

    // Group bookings theo mã gốc (loại bỏ tất cả suffix)
    const bookingGroups = {};
    rawBookings.forEach(b => {
      const baseCode = extractBaseCode(b.code);
      if (!bookingGroups[baseCode]) {
        bookingGroups[baseCode] = [];
      }
      bookingGroups[baseCode].push(b);
    });

    // Map mỗi group thành 1 invoice
    const invoices = Object.entries(bookingGroups).map(([baseCode, group]) => {
      // Lấy booking đầu tiên làm đại diện
      const b = group[0];
      
      // Tổng số phòng = tổng rooms của tất cả bookings trong group
      const roomCount = group.reduce((sum, booking) => sum + (booking.rooms || 1), 0);
      
      // Tổng tiền (orderTotal của booking đầu tiên - vì tất cả cùng orderTotal)
      const totalAmount = Number(b.orderTotal || b.totalAmount || 0);
      const isPaid = b.paymentStatus === "paid";

      return {
        bookingCode: baseCode, // Mã gốc (không có suffix)
        customerName: b.guest?.fullName || "Khách lẻ",
        issueDate: b.createdAt ? moment(b.createdAt).format("DD/MM/YYYY") : "—",
        dueDate: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "—",
        roomCount, // Tổng số phòng
        totalAmount: Math.round(totalAmount / 1000), // hiển thị K
        paidAmount: isPaid ? Math.round(totalAmount / 1000) : 0,
        status: isPaid ? "paid" : "pending",
        statusText: isPaid ? "Đã thanh toán" : "Chờ thanh toán",
        statusColor: isPaid ? "green" : "orange",
      };
    });

    // Tính summary
    const totalRevenue = invoices
      .filter((inv) => inv.status === "paid")
      .reduce((sum, inv) => sum + inv.totalAmount, 0);

    const pendingPayments = invoices
      .filter((inv) => inv.status !== "paid")
      .reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);

    const unpaidInvoices = invoices.filter((inv) => inv.status !== "paid").length;

    const paymentsData = {
      invoices,
      summary: {
        totalRevenue,
        pendingPayments,
        unpaidInvoices,
      },
    };

    return res.render("admin/pages/hotel-payments", {
      pageTitle: "Thanh toán",
      paymentsData,
      pathAdmin,
      hotelList: hotels,
      selectedHotelId,
      isBookingManagement: true, // dùng để ẩn 'Tất cả khách sạn' trong selector
    });
  } catch (error) {
    console.error("hotel payments list error:", error);
    return res.render("admin/pages/hotel-payments", {
      pageTitle: "Thanh toán",
      paymentsData: { invoices: [], summary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 } },
      pathAdmin,
      hotelList: [],
      selectedHotelId: null,
      isBookingManagement: true,
    });
  }
};

// ============== REVIEWS LIST ==============
module.exports.reviewsList = async (req, res) => {
  try {
    const companyId = req.account && req.account.companyId;
    if (!companyId) {
      return res.redirect(`/${pathAdmin}/hotel/list`);
    }

    // Lấy hotelId từ query parameter (nếu có)
    const selectedHotelId = req.query.hotelId;

    // Lấy tất cả hotels của company
    const hotels = await Hotel.find({
      companyId: companyId,
      deleted: false,
    })
      .select("_id name")
      .lean();

    const hotelIds = hotels.map((h) => h._id);
    const hotelMap = {};
    hotels.forEach((h) => {
      hotelMap[String(h._id)] = h.name;
    });

    // Filter reviews theo hotelId nếu có
    const reviewFilter = {
      hotelId: { $in: hotelIds },
      deleted: false,
    };

    // Nếu có chọn hotel cụ thể, chỉ lấy reviews của hotel đó
    if (selectedHotelId && selectedHotelId !== "all" && hotelIds.some(id => String(id) === selectedHotelId)) {
      reviewFilter.hotelId = selectedHotelId;
    }

    // Lấy reviews
    const reviews = await HotelReview.find(reviewFilter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Gắn tên hotel vào mỗi review và format date
    reviews.forEach((review) => {
      review.hotelName = hotelMap[String(review.hotelId)] || "N/A";
      review.createdAtFormat = moment(review.createdAt).format('DD/MM/YYYY HH:mm');
    });

    return res.render("admin/pages/hotel-reviews-list", {
      pageTitle: "Bình luận và đánh giá",
      reviews: reviews || [],
      hotels: hotels || [],
      selectedHotelId: selectedHotelId || "all",
      pathAdmin,
    });
  } catch (error) {
    console.log("admin hotel reviews list error:", error);
    return res.redirect(`/${pathAdmin}/hotel/list`);
  }
};

