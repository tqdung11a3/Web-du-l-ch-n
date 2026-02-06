// middlewares/admin/hotel-list.middleware.js
const Hotel = require("../../models/hotel.model");

/**
 * Middleware: Lấy danh sách khách sạn của company và gắn vào res.locals
 * Chỉ áp dụng cho các route hotel của company admin
 */
module.exports.getHotelList = async (req, res, next) => {
  try {
    const account = req.account;
    
    // Chỉ lấy danh sách nếu là company admin (không phải super admin)
    if (account && !account.isSuperAdmin && account.companyId) {
      const hotelList = await Hotel.find({
        companyId: account.companyId,
        deleted: { $ne: true }
      })
      .select("_id name")
      .sort({ name: 1 })
      .lean();
      
      res.locals.hotelList = hotelList;
      res.locals.hotelListForSelector = hotelList; // Dành riêng cho dropdown selector
    } else {
      res.locals.hotelList = [];
      res.locals.hotelListForSelector = [];
    }
    
    next();
  } catch (error) {
    console.error("hotel-list middleware error:", error);
    res.locals.hotelList = [];
    res.locals.hotelListForSelector = [];
    next();
  }
};

