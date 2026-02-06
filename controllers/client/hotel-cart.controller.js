// controllers/client/hotel-cart.controller.js
const Cart = require("../../models/cart.model");
const Hotel = require("../../models/hotel.model");
const HotelBooking = require("../../models/hotel-booking.model");
const moment = require("moment");
const { v4: uuidv4 } = require('uuid');
const { getAvailableRoomsForType, calculateEffectiveOccupancy } = require("../../helpers/hotel-availability.helper");

/**
 * GET /hotel-cart - Redirect về trang giỏ hàng thống nhất với tab hotel
 */
module.exports.index = async (req, res) => {
  // Redirect về trang giỏ hàng thống nhất với tab hotel active
  return res.redirect('/cart?tab=hotel');
};

/**
 * POST /hotel-cart/add - Thêm phòng vào giỏ hàng
 */
module.exports.addToCart = async (req, res) => {
  try {
    const {
      hotelId,
      roomTypeId,
      quantity,
      checkInDate,
      checkOutDate,
      roomsData,
      adults,
      children,
      rooms
    } = req.body;

    // Validate input
    if (!hotelId || !roomTypeId || !checkInDate || !checkOutDate) {
      return res.json({
        code: "error",
        message: "Thiếu thông tin bắt buộc"
      });
    }

    const qty = parseInt(quantity) || 1;
    if (qty < 1) {
      return res.json({
        code: "error",
        message: "Số lượng phòng không hợp lệ"
      });
    }

    // Lấy thông tin hotel và room type
    const hotel = await Hotel.findOne({ _id: hotelId, deleted: false })
      .populate('province', 'name')
      .lean();
      
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không tìm thấy khách sạn"
      });
    }

    const roomType = hotel.roomTypes?.find(rt => String(rt._id) === String(roomTypeId));
    if (!roomType) {
      return res.json({
        code: "error",
        message: "Không tìm thấy loại phòng"
      });
    }

    // Tính số đêm
    const checkInMoment = moment(checkInDate);
    const checkOutMoment = moment(checkOutDate);
    const nights = Math.max(1, checkOutMoment.diff(checkInMoment, 'days'));

    // Kiểm tra số phòng trống
    const hotelBookings = await HotelBooking.find({
      'hotel.hotelId': hotelId,
      status: { $nin: ['cancelled', 'checked_out'] }, // Loại bỏ đã hủy và đã trả phòng
      $or: [
        { checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }
      ]
    }).lean();

    const individualRooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
    const availableRooms = getAvailableRoomsForType(
      individualRooms,
      roomTypeId,
      hotelBookings,
      checkInMoment.toDate(),
      checkOutMoment.toDate()
    );

    const maxAvailable = availableRooms.length;
    
    if (qty > maxAvailable) {
      return res.json({
        code: "error",
        message: `Chỉ còn ${maxAvailable} phòng trống cho loại phòng này`
      });
    }

    // Lấy hoặc tạo cart
    let cart = await getOrCreateCart(req, res);

    // Nếu cart đã có hotel khác, xóa cart cũ và tạo mới
    if (cart.hotelId && String(cart.hotelId) !== String(hotelId)) {
      await Cart.deleteOne({ _id: cart._id });
      cart = await getOrCreateCart(req, res, true);
    }

    // Set hotelId cho cart
    cart.hotelId = hotelId;

    // Kiểm tra xem room type đã có trong cart chưa
    const existingItemIndex = cart.items.findIndex(
      item => String(item.roomTypeId) === String(roomTypeId) &&
              item.checkInDate === checkInDate &&
              item.checkOutDate === checkOutDate
    );

    const roomTypeImage = Array.isArray(roomType.images) && roomType.images.length > 0
      ? roomType.images[0]
      : hotel.avatar || "/images/no-image.jpg";

    if (existingItemIndex >= 0) {
      // Cập nhật quantity
      const newQty = cart.items[existingItemIndex].quantity + qty;
      if (newQty > maxAvailable) {
        return res.json({
          code: "error",
          message: `Chỉ còn ${maxAvailable} phòng trống cho loại phòng này`
        });
      }
      cart.items[existingItemIndex].quantity = newQty;
    } else {
      // Thêm item mới
      cart.items.push({
        hotelId,
        hotelName: hotel.name,
        hotelAddress: hotel.address,
        hotelProvince: hotel.province?.name || hotel.cityName || '',
        roomTypeId,
        roomTypeName: roomType.name,
        roomTypeImage,
        quantity: qty,
        maxAvailable,
        pricePerNight: Number(roomType.basePrice || hotel.basePrice || 0),
        checkInDate,
        checkOutDate,
        nights,
        roomsData,
        adults: Number(adults) || 1,
        children: Number(children) || 0,
        rooms: Number(rooms) || 1
      });
    }

    cart.updatedAt = new Date();
    await cart.save();

    return res.json({
      code: "success",
      message: "Đã thêm vào giỏ hàng",
      cartItemCount: cart.items.length
    });
  } catch (error) {
    console.error("Error in hotel-cart.addToCart:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi thêm vào giỏ hàng"
    });
  }
};

/**
 * PATCH /hotel-cart/update-quantity - Cập nhật số lượng phòng
 */
module.exports.updateQuantity = async (req, res) => {
  try {
    const { roomTypeId, quantity } = req.body;

    const qty = parseInt(quantity);
    if (!roomTypeId || qty < 1) {
      return res.json({
        code: "error",
        message: "Dữ liệu không hợp lệ"
      });
    }

    const cart = await getOrCreateCart(req, res);
    const itemIndex = cart.items.findIndex(
      item => String(item.roomTypeId) === String(roomTypeId)
    );

    if (itemIndex < 0) {
      return res.json({
        code: "error",
        message: "Không tìm thấy phòng trong giỏ hàng"
      });
    }

    const item = cart.items[itemIndex];

    // Kiểm tra số phòng trống
    if (qty > item.maxAvailable) {
      return res.json({
        code: "error",
        message: `Chỉ còn ${item.maxAvailable} phòng trống`
      });
    }

    item.quantity = qty;
    cart.updatedAt = new Date();
    await cart.save();

    // Tính lại tổng tiền
    const subtotal = cart.items.reduce((sum, i) => {
      return sum + (i.pricePerNight * i.nights * i.quantity);
    }, 0);
    
    const taxPercent = 10;
    const feePercent = 5;
    const tax = Math.round(subtotal * taxPercent / 100);
    const fee = Math.round(subtotal * feePercent / 100);
    const total = subtotal + tax + fee;

    return res.json({
      code: "success",
      message: "Đã cập nhật số lượng",
      subtotal,
      tax,
      fee,
      total
    });
  } catch (error) {
    console.error("Error in hotel-cart.updateQuantity:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra"
    });
  }
};

/**
 * DELETE /hotel-cart/remove - Xóa phòng khỏi giỏ hàng
 */
module.exports.removeItem = async (req, res) => {
  try {
    const { roomTypeId } = req.body;

    if (!roomTypeId) {
      return res.json({
        code: "error",
        message: "Dữ liệu không hợp lệ"
      });
    }

    const cart = await getOrCreateCart(req, res);
    cart.items = cart.items.filter(
      item => String(item.roomTypeId) !== String(roomTypeId)
    );

    if (cart.items.length === 0) {
      // Xóa cart nếu không còn item nào
      await Cart.deleteOne({ _id: cart._id });
    } else {
      cart.updatedAt = new Date();
      await cart.save();
    }

    return res.json({
      code: "success",
      message: "Đã xóa khỏi giỏ hàng",
      cartItemCount: cart.items.length
    });
  } catch (error) {
    console.error("Error in hotel-cart.removeItem:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra"
    });
  }
};

/**
 * DELETE /hotel-cart/clear - Xóa toàn bộ giỏ hàng
 */
module.exports.clearCart = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req, res);
    await Cart.deleteOne({ _id: cart._id });

    return res.json({
      code: "success",
      message: "Đã xóa giỏ hàng"
    });
  } catch (error) {
    console.error("Error in hotel-cart.clearCart:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra"
    });
  }
};

/**
 * GET /hotel-cart/count - Lấy số lượng item trong giỏ hàng
 */
module.exports.getCount = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req, res);
    const count = cart.items ? cart.items.length : 0;

    return res.json({
      code: "success",
      count
    });
  } catch (error) {
    console.error("Error in hotel-cart.getCount:", error);
    return res.json({
      code: "error",
      count: 0
    });
  }
};

/**
 * Helper: Lấy hoặc tạo cart cho user/session
 */
async function getOrCreateCart(req, res, forceNew = false) {
  const userId = req.account ? req.account.id || req.account._id : null;
  let sessionId = req.cookies?.cart_session;

  // Tạo sessionId mới nếu chưa có
  if (!sessionId) {
    sessionId = uuidv4();
    if (res) {
      res.cookie('cart_session', sessionId, {
        maxAge: 24 * 60 * 60 * 1000, // 24h
        httpOnly: true,
        sameSite: 'lax'
      });
    }
  }

  if (forceNew) {
    // Tạo cart mới
    const newCart = new Cart({
      userId,
      sessionId,
      items: []
    });
    await newCart.save();
    return newCart;
  }

  // Tìm cart hiện tại
  let cart;
  if (userId) {
    cart = await Cart.findOne({ userId });
  }
  
  if (!cart && sessionId) {
    cart = await Cart.findOne({ sessionId });
  }

  // Tạo cart mới nếu không tìm thấy
  if (!cart) {
    cart = new Cart({
      userId,
      sessionId,
      items: []
    });
    await cart.save();
  }

  return cart;
}

