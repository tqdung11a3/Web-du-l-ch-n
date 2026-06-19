// controllers/client/hotel-booking.controller.js
const { generateRandomNumber } = require("../../helpers/generate.helper");
const HotelBooking = require("../../models/hotel-booking.model");
const Cart = require("../../models/cart.model");
const Hotel = require("../../models/hotel.model");
const Notification = require("../../models/notification.model");
const moment = require("moment");
const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
const auditLogHelper = require("../../helpers/audit-log.helper");

/**
 * PATCH /hotel-booking/transfer-proof
 * Lưu ảnh chứng từ chuyển khoản do khách hàng gửi lên
 * Body: { bookingCode, phone, images: [url, ...] }
 */
module.exports.saveTransferProof = async (req, res) => {
  try {
    const { bookingCode, phone, images } = req.body;

    if (!bookingCode || !phone || !Array.isArray(images) || images.length === 0) {
      return res.json({ code: "error", message: "Dữ liệu không hợp lệ" });
    }

    const booking = await HotelBooking.findOne({
      code: bookingCode,
      "guest.phone": phone,
    });

    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy đơn đặt phòng" });
    }

    if (booking.paymentStatus === "paid") {
      return res.json({ code: "error", message: "Đơn đã thanh toán" });
    }

    // Cập nhật tất cả booking trong cùng nhóm (cùng base code)
    const baseCode = bookingCode.replace(/-\d+$/, "");
    await HotelBooking.updateMany(
      { code: { $regex: `^${baseCode}` }, "guest.phone": phone },
      { $push: { transferProofImages: { $each: images } } }
    );

    return res.json({ code: "ok", message: "Đã lưu ảnh chứng từ thành công" });
  } catch (err) {
    console.error("hotel-booking.saveTransferProof error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

/**
 * GET /hotel-booking/check-payment-status?bookingCode=...&phone=...
 * Trả về trạng thái thanh toán của đơn đặt phòng (dùng cho polling phía client)
 */
module.exports.checkPaymentStatus = async (req, res) => {
  try {
    const { bookingCode, phone } = req.query;

    if (!bookingCode || !phone) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    const booking = await HotelBooking.findOne({
      code: bookingCode,
      "guest.phone": phone,
    })
      .select("paymentStatus")
      .lean();

    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy đơn đặt phòng" });
    }

    return res.json({ code: "ok", paymentStatus: booking.paymentStatus });
  } catch (err) {
    console.error("hotel-booking.checkPaymentStatus error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

// Helper function để sort object (dùng cho VNPay)
function sortObject(obj) {
  if (typeof obj !== "object" || obj === null) {
    throw new TypeError("Input must be a plain object");
  }

  let sorted = {};
  let str = [];
  let key;

  for (key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      str.push(encodeURIComponent(key));
    }
  }

  str.sort();

  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
  }

  return sorted;
}

/**
 * POST /hotel-booking/create - Tạo booking từ cart
 */
module.exports.createPost = async (req, res) => {
  try {
    const body = req.body || {};
    const { fullName, phone, email, note, paymentMethod, additionalServices } = body;

    // Validate required fields
    if (!fullName || !phone) {
      return res.json({ code: "error", message: "Vui lòng nhập đầy đủ thông tin!" });
    }

    // Lấy cart hiện tại
    const userId = req.account?._id || null;
    // Sử dụng cùng cookie với giỏ hàng unified (`cart_session`)
    const sessionId = req.cookies?.cart_session || null;

    let cart = null;
    if (userId) {
      cart = await Cart.findOne({ userId }).populate("hotelId");
    }
    if (!cart && sessionId) {
      cart = await Cart.findOne({ sessionId }).populate("hotelId");
    }

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.json({ code: "error", message: "Giỏ hàng trống!" });
    }

    // Lấy thông tin hotel
    const hotel = await Hotel.findOne({ _id: cart.hotelId, deleted: false }).lean();
    if (!hotel) {
      return res.json({ code: "error", message: "Khách sạn không tồn tại!" });
    }

    // Validate availability và tạo bookings
    const checkInMoment = moment(cart.items[0].checkInDate);
    const checkOutMoment = moment(cart.items[0].checkOutDate);

    const hotelBookings = await HotelBooking.find({
      'hotel.hotelId': cart.hotelId,
      status: { $nin: ['cancelled', 'checked_out'] }, // Loại bỏ đã hủy và đã trả phòng
      $or: [
        { checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }
      ]
    }).lean();

    const individualRooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
    const createdBookings = [];

    // Tính tổng tiền từ cart items (giá cơ bản)
    let subtotal = 0;
    for (const item of cart.items) {
      subtotal += item.pricePerNight * item.nights * item.quantity;
    }

    // Tính phụ thu vượt sức chứa (nếu có)
    let extraOccupancyFee = 0;
    const { calculateEffectiveOccupancy } = require("../../helpers/hotel-availability.helper");
    
    for (const item of cart.items) {
      if (item.roomsData) {
        try {
          const parsedRoomsData = JSON.parse(decodeURIComponent(item.roomsData));
          
          // Lấy room type
          const roomType = Array.isArray(hotel.roomTypes) 
            ? hotel.roomTypes.find(rt => String(rt._id) === String(item.roomTypeId))
            : null;
          
          if (roomType) {
            const ageBands = hotel.ageBands || [];
            const baseOccupancy = roomType.baseOccupancy || 2;
            
            let itemExtraFee = 0;
            
            // Tính phụ thu cho từng phòng
            parsedRoomsData.forEach((roomData) => {
              const roomAdults = roomData.adults || 0;
              const roomChildren = Array.isArray(roomData.children) ? roomData.children : [];
              
              // Tính effective occupancy cho phòng này
              let roomEffectiveOccupancy = roomAdults;
              
              roomChildren.forEach(child => {
                const age = child.age || 0;
                const band = ageBands.find(b => {
                  const minAge = b.minAge || 0;
                  const maxAge = b.maxAge;
                  if (maxAge === null || maxAge === undefined) {
                    return age >= minAge;
                  }
                  return age >= minAge && age <= maxAge;
                });
                
                if (band && band.countInOccupancy) {
                  roomEffectiveOccupancy += (band.occupancyWeight || 1);
                }
              });
              
              // Nếu phòng này vượt base occupancy
              if (roomEffectiveOccupancy > baseOccupancy) {
                const roomExcessOccupancy = roomEffectiveOccupancy - baseOccupancy;
                let roomExtraFee = 0;
                let remainingExcessOccupancy = roomExcessOccupancy;
                
                // Tính phụ thu cho người lớn vượt
                if (roomAdults > baseOccupancy && remainingExcessOccupancy > 0) {
                  const adultExcess = Math.min(roomAdults - baseOccupancy, remainingExcessOccupancy);
                  const adultBand = ageBands.find(band => 
                    (band.bandType === 'adult' || (band.minAge >= 12 && (band.maxAge === null || band.maxAge >= 12))) &&
                    band.applyExtraPersonFee === true &&
                    band.extraPersonFeePerNight > 0
                  );
                  
                  if (adultBand) {
                    roomExtraFee += adultExcess * adultBand.extraPersonFeePerNight;
                    remainingExcessOccupancy -= adultExcess;
                  } else if (roomType.extraPersonFeePerNight) {
                    roomExtraFee += adultExcess * roomType.extraPersonFeePerNight;
                    remainingExcessOccupancy -= adultExcess;
                  }
                }
                
                // Tính phụ thu cho trẻ em vượt
                if (remainingExcessOccupancy > 0 && roomChildren.length > 0) {
                  for (const child of roomChildren) {
                    if (remainingExcessOccupancy <= 0) break;
                    
                    const age = child.age || 0;
                    const band = ageBands.find(b => {
                      const minAge = b.minAge || 0;
                      const maxAge = b.maxAge;
                      if (maxAge === null || maxAge === undefined) {
                        return age >= minAge;
                      }
                      return age >= minAge && age <= maxAge;
                    });
                    
                    if (band && band.countInOccupancy && band.applyExtraPersonFee && band.extraPersonFeePerNight > 0) {
                      const childWeight = band.occupancyWeight || 1;
                      if (childWeight > 0 && remainingExcessOccupancy >= childWeight) {
                        roomExtraFee += 1 * band.extraPersonFeePerNight;
                        remainingExcessOccupancy -= childWeight;
                      }
                    }
                  }
                }
                
                // Nhân với số đêm
                itemExtraFee += roomExtraFee * item.nights;
              }
            });
            
            // CHỈ nhân với quantity nếu parsedRoomsData chỉ có 1 phòng đại diện
            // Nếu parsedRoomsData đã bao gồm nhiều phòng (length === quantity), không nhân nữa
            console.log('=== DEBUG Extra Occupancy Fee ===');
            console.log('parsedRoomsData.length:', parsedRoomsData.length);
            console.log('item.quantity:', item.quantity);
            console.log('itemExtraFee (before multiply):', itemExtraFee);
            
            if (parsedRoomsData.length < item.quantity) {
              console.log('Multiplying by quantity:', item.quantity);
              itemExtraFee = itemExtraFee * item.quantity;
            } else {
              console.log('NOT multiplying (parsedRoomsData.length === item.quantity)');
            }
            
            console.log('itemExtraFee (after):', itemExtraFee);
            extraOccupancyFee += itemExtraFee;
          }
        } catch (e) {
          console.warn('Failed to parse roomsData for extra occupancy fee:', e);
        }
      }
    }

    // Tính tax và fee (chỉ tính trên giá cơ bản, không tính trên phụ thu)
    const taxPercent = 10;
    const feePercent = 5;
    const tax = Math.round(subtotal * taxPercent / 100);
    const fee = Math.round(subtotal * feePercent / 100);

    // Tính tiền dịch vụ thêm - Cấu trúc mới: { global: {...}, perItem: {...} }
    let additionalServicesTotal = 0;
    let breakfastDetails = []; // Lưu chi tiết breakfast để ghi vào booking
    
    if (additionalServices && typeof additionalServices === 'object') {
      // ===== XỬ LÝ DỊCH VỤ CHUNG (GLOBAL) =====
      if (additionalServices.global && typeof additionalServices.global === 'object') {
        for (const [serviceId, value] of Object.entries(additionalServices.global)) {
          if (serviceId === 'early_checkin' && value === 'true') {
            additionalServicesTotal += hotel.earlyCheckinFee || 0;
          } else if (serviceId === 'late_checkout' && value === 'true') {
            additionalServicesTotal += hotel.lateCheckoutFee || 0;
          } else if (serviceId === 'airport_transfer' && value === 'true') {
            additionalServicesTotal += hotel.usefulInfo?.airportTransferFee || 0;
          } else if (serviceId.startsWith('service_')) {
            // Quantity-based global services
            const qty = parseInt(value) || 0;
            const key = serviceId.replace('service_', '');
            
            if (key === 'airport_transfer' && qty > 0) {
              additionalServicesTotal += qty * (hotel.usefulInfo?.airportTransferFee || 0);
            }
          }
        }
      }
      
      // ===== XỬ LÝ DỊCH VỤ THEO TỪNG ITEM (PER ITEM) =====
      if (additionalServices.perItem && typeof additionalServices.perItem === 'object') {
        for (const [itemIndex, services] of Object.entries(additionalServices.perItem)) {
          if (typeof services !== 'object') continue;
          
          const itemIndexNum = parseInt(itemIndex);
          const cartItem = cart.items[itemIndexNum];
          if (!cartItem) continue;
          
          const nights = cartItem.nights || 1;
          const roomType = Array.isArray(hotel.roomTypes)
            ? hotel.roomTypes.find(rt => String(rt._id) === String(cartItem.roomTypeId))
            : null;
          
          for (const [serviceId, qtyStr] of Object.entries(services)) {
            const qty = parseInt(qtyStr) || 0;
            if (qty <= 0) continue;
            
            // Extra bed (giường phụ)
            if (serviceId.includes('extra_bed')) {
              const extraFeePerNight = roomType?.extraBedFeePerNight || 0;
              additionalServicesTotal += qty * extraFeePerNight * nights;
            }
            // Breakfast
            else if (serviceId.includes('breakfast_')) {
              // Format: breakfast_{bandname}_{index}_item_{itemIndex}
              // qty = số người muốn ăn sáng → tính cho toàn bộ số đêm
              const ageBands = hotel.ageBands || [];
              for (const band of ageBands) {
                const bandKey = band.bandName.toLowerCase().replace(/\s+/g, '_');
                if (serviceId.includes(bandKey)) {
                  const breakfastFee = band.breakfastFeePerPersonPerMeal || 0;
                  additionalServicesTotal += qty * breakfastFee * nights;
                  breakfastDetails.push({
                    ageBandName: band.bandName,
                    persons: qty,
                    nights: nights,
                    pricePerPersonPerMeal: breakfastFee,
                    totalPrice: qty * breakfastFee * nights
                  });
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Tổng cộng = giá cơ bản + phụ thu vượt sức chứa + thuế + phí + dịch vụ thêm
    console.log('=== TOTAL CALCULATION ===');
    console.log('subtotal:', subtotal);
    console.log('extraOccupancyFee:', extraOccupancyFee);
    console.log('tax:', tax);
    console.log('fee:', fee);
    console.log('additionalServices (received):', JSON.stringify(additionalServices, null, 2));
    console.log('additionalServicesTotal:', additionalServicesTotal);
    const total = subtotal + extraOccupancyFee + tax + fee + additionalServicesTotal;
    console.log('TOTAL:', total);

    // ── Kiểm tra tổng thể availability cho TẤT CẢ loại phòng trước khi tạo ──
    // Không return ngay khi gặp loại phòng đầu tiên bị thiếu — tích lũy mọi
    // xung đột để báo cho khách một lần, phân loại rõ "đang có khách đặt"
    // (giữ chỗ chưa thanh toán) vs "đã có khách đặt" (đã thanh toán).
    const roomConflicts = [];
    const nowDate = new Date();

    for (let itemIndex = 0; itemIndex < cart.items.length; itemIndex++) {
      const item = cart.items[itemIndex];

      const availableRooms = getAvailableRoomsForType(
        individualRooms,
        item.roomTypeId,
        hotelBookings,
        checkInMoment.toDate(),
        checkOutMoment.toDate()
      );

      if (availableRooms.length >= item.quantity) continue;

      // Đếm số phòng đang bị chiếm bởi các booking khác (overlap, cùng
      // roomTypeId, không cancelled/checked_out) — phân 2 nhóm.
      let holdRoomsByOthers = 0;
      let paidRoomsByOthers = 0;
      for (const b of hotelBookings) {
        if (b.status === "cancelled" || b.status === "checked_out") continue;
        if (String(b.roomTypeId) !== String(item.roomTypeId)) continue;
        // Tính cả booking đã/chưa gán roomId — vì đều chiếm chỗ loại phòng
        // này trong khoảng thời gian trùng.
        const roomsCount = Number(b.rooms || 1);
        if (b.paymentStatus === "paid") {
          paidRoomsByOthers += roomsCount;
        } else if (
          b.isTemporaryHold &&
          (!b.holdExpiresAt || new Date(b.holdExpiresAt) > nowDate)
        ) {
          holdRoomsByOthers += roomsCount;
        }
      }

      let kind;
      let blockedCount;
      if (holdRoomsByOthers > 0) {
        kind = "hold";
        blockedCount = holdRoomsByOthers;
      } else if (paidRoomsByOthers > 0) {
        kind = "paid";
        blockedCount = paidRoomsByOthers;
      } else {
        kind = "shortage";
        blockedCount = 0;
      }

      roomConflicts.push({
        kind,
        roomTypeName: item.roomTypeName,
        hotelName: hotel.name,
        blockedCount,
        availableForClient: availableRooms.length,
      });
    }

    if (roomConflicts.length > 0) {
      const buildLine = (c) => {
        const hotelLabel = c.hotelName ? ` tại ${c.hotelName}` : "";
        if (c.kind === "hold") {
          return `Đang có khách đặt ${c.blockedCount} phòng cho loại phòng "${c.roomTypeName}"${hotelLabel}. Vui lòng chọn loại phòng khác.`;
        }
        if (c.kind === "paid") {
          return `Đã có khách đặt ${c.blockedCount} phòng cho loại phòng "${c.roomTypeName}"${hotelLabel}, hiện loại phòng đó còn ${c.availableForClient} phòng.`;
        }
        return `Loại phòng "${c.roomTypeName}"${hotelLabel} chỉ còn ${c.availableForClient} phòng. Vui lòng chọn lại.`;
      };

      const message =
        roomConflicts.length === 1
          ? buildLine(roomConflicts[0])
          : "Một số loại phòng bạn chọn không còn đủ:\n" +
            roomConflicts.map((c, i) => `${i + 1}. ${buildLine(c)}`).join("\n");

      return res.json({ code: "error", message });
    }

    // Tạo base code cho toàn bộ đơn
    const baseCode = "HB" + generateRandomNumber(10);
    
    // Tạo 1 booking cho mỗi item (loại phòng)
    for (let itemIndex = 0; itemIndex < cart.items.length; itemIndex++) {
      const item = cart.items[itemIndex];

      // Tạo code với suffix nếu có nhiều items
      // Item đầu tiên: HB123, Item thứ 2: HB123-1, Item thứ 3: HB123-2, ...
      const code = itemIndex === 0 ? baseCode : `${baseCode}-${itemIndex}`;
      
      // Extract độ tuổi trẻ em từ roomsData (nếu có)
      const childrenDetails = [];
      if (item.roomsData) {
        try {
          const parsedRoomsData = JSON.parse(decodeURIComponent(item.roomsData));
          if (Array.isArray(parsedRoomsData)) {
            parsedRoomsData.forEach(roomData => {
              if (roomData.children && Array.isArray(roomData.children)) {
                roomData.children.forEach(child => {
                  childrenDetails.push({ age: child.age || 0 });
                });
              }
            });
          }
        } catch (e) {
          console.warn('Failed to parse roomsData for childrenDetails:', e);
        }
      }
      
      // Lọc additionalServices cho item này
      let itemAdditionalServices = {};
      if (additionalServices && typeof additionalServices === 'object') {
        // Bao gồm global services (áp dụng cho tất cả)
        if (additionalServices.global) {
          itemAdditionalServices.global = additionalServices.global;
        }
        
        // Chỉ lấy perItem services của item này
        if (additionalServices.perItem && additionalServices.perItem[itemIndex]) {
          itemAdditionalServices.perItem = {
            [itemIndex]: additionalServices.perItem[itemIndex]
          };
        }
      }
      
      const booking = new HotelBooking({
        code,
        userId: userId || null, // Lưu ID của user đã đặt (nếu đăng nhập)
        guest: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: (email || "").trim(),
          cccdImages: Array.isArray(req.body.cccdImages) ? req.body.cccdImages : [],
        },
        checkIn: checkInMoment.toDate(),
        checkOut: checkOutMoment.toDate(),
        adults: item.adults || 1,
        children: item.children || 0,
        childrenDetails: childrenDetails.length > 0 ? childrenDetails : undefined, // Lưu chi tiết độ tuổi trẻ em
        rooms: item.quantity, // Số phòng đặt
        roomsData: item.roomsData || undefined, // Lưu chi tiết từng phòng (JSON string)
        roomId: null, // Không assign phòng cụ thể, để admin tự chọn sau
        roomTypeId: item.roomTypeId,
        currency: hotel.currency || "VND",
        pricePerNight: item.pricePerNight,
        totalNights: item.nights,
        totalAmount: item.pricePerNight * item.nights * item.quantity, // tổng tiền tất cả phòng cùng loại
        hotel: {
          hotelId: hotel._id,
          name: hotel.name,
          address: hotel.address || "",
          thumbnail: hotel.avatar || "",
        },
        orderTotal: total, // tổng tiền cả đơn (thuế + phí + dịch vụ thêm)
        breakfastDetails: breakfastDetails.length > 0 ? breakfastDetails : undefined, // Chi tiết breakfast theo age bands
        additionalServices: itemAdditionalServices, // Lưu dịch vụ thêm (global + perItem của item này)
        status: "pending", // Trạng thái booking: pending, checked_in, checked_out, cancelled
        paymentStatus: "unpaid", // Trạng thái thanh toán: unpaid, paid
        paymentMethod: paymentMethod || "money", // money | bank | vnpay
        note: note || "",
        
        // ==== ĐƠN TẠM / GIỮ CHỖ ====
        isTemporaryHold: true, // Đánh dấu là đơn tạm
        holdExpiresAt: moment().add(15, 'minutes').toDate(), // Hết hạn sau 15 phút
      });

      await booking.save();

      auditLogHelper.log(req, {
        action: "customer.hotel-booking.create",
        resourceType: "HotelBooking",
        resourceId: booking._id,
        resourceLabel: code,
        asCompanyId: hotel.companyId || null,
        after: {
          hotel: hotel.name,
          roomTypeId: String(item.roomTypeId || ""),
          rooms: item.quantity,
          nights: item.nights,
          totalAmount: booking.totalAmount,
          paymentMethod: booking.paymentMethod,
        },
        summary: `Khách đặt ${item.quantity} phòng tại "${hotel.name}" (${item.nights} đêm) — mã ${code}`,
        metadata: { phone: phone || "", email: email || "" },
      });

      // ── Kiểm tra race condition sau khi lưu (optimistic locking) ──────────
      // Lấy TẤT CẢ bookings cùng roomType, cùng ngày (bao gồm booking vừa tạo)
      // Sắp xếp theo _id tăng dần → booking được tạo sớm nhất có _id nhỏ nhất
      const allOverlappingAfterSave = await HotelBooking.find({
        "hotel.hotelId": hotel._id,
        roomTypeId: item.roomTypeId,
        status: { $nin: ["cancelled", "checked_out"] },
        $or: [{ checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }],
      })
        .sort({ _id: 1 })
        .lean();

      // Tổng số phòng vật lý của roomType này
      const totalPhysicalRooms = individualRooms.filter(
        (r) => String(r.roomTypeId) === String(item.roomTypeId) && r.status === "vacant"
      ).length;

      // Đi qua danh sách theo thứ tự _id, cộng dồn đến khi chạm booking của ta
      // → "Early bird wins": booking tạo trước giữ được phòng
      let cumulative = 0;
      let withinCapacity = false;
      for (const b of allOverlappingAfterSave) {
        cumulative += b.rooms || 1;
        if (String(b._id) === String(booking._id)) {
          withinCapacity = cumulative <= totalPhysicalRooms;
          break;
        }
      }

      if (!withinCapacity) {
        // Race condition: phòng đã bị booking trước ta → hủy booking vừa tạo
        await HotelBooking.deleteOne({ _id: booking._id });
        // Hủy cả các booking đã tạo trước đó trong cùng request này (nếu có nhiều item)
        if (createdBookings.length > 0) {
          await HotelBooking.deleteMany({ _id: { $in: createdBookings.map((b) => b._id) } });
        }
        return res.json({
          code: "error",
          message: `Phòng loại "${item.roomTypeName}" vừa được đặt hết bởi khách khác! Vui lòng kiểm tra lại giỏ hàng.`,
        });
      }
      // ─────────────────────────────────────────────────────────────────────

      createdBookings.push(booking);
    }

    // Tạo thông báo cho company admin (chỉ khi thanh toán tiền mặt hoặc chuyển khoản)
    if (paymentMethod !== "vnpay") {
    try {
      const paymentMethodName = 
        paymentMethod === "bank" ? "Chuyển khoản ngân hàng" : "Tiền mặt";
      
      // Tính tổng số phòng
      const totalRoomsBooked = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      
      await Notification.create({
        companyId: hotel.companyId,
        type: "hotel_booking",
        title: "Đặt phòng mới",
        content: `${fullName.trim()} đã đặt ${totalRoomsBooked} phòng (${cart.items.length} loại phòng) tại ${hotel.name}`,
        link: `/${pathAdmin}/hotel/booking/detail/${baseCode}`,
        metadata: {
          bookingCode: baseCode,
          customerName: fullName.trim(),
          checkIn: checkInMoment.toDate(),
          checkOut: checkOutMoment.toDate(),
          paymentMethod: paymentMethodName,
          amount: total,
          hotelId: hotel._id,
          hotelName: hotel.name,
        },
      });
    } catch (notifError) {
      console.error("Error creating notification:", notifError);
    }
    } // end if paymentMethod !== "vnpay"

    // Xóa cart sau khi tạo booking thành công
    await Cart.deleteOne({ _id: cart._id });

    // Nếu có nhiều booking, lấy booking đầu tiên để redirect
    const firstBooking = createdBookings[0];

    return res.json({
      code: "success",
      message: "Tạo đơn đặt phòng thành công!",
      bookingCode: firstBooking.code,
      phone: phone.trim(),
      total: total,
      bookings: createdBookings.map(b => ({
        code: b.code,
        phone: phone.trim(),
      })),
    });
  } catch (error) {
    console.error("hotel-booking.createPost error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi tạo đơn đặt phòng!" });
  }
};

/**
 * GET /hotel-booking/payment-vnpay?bookingCode=...&phone=...
 * Redirect đến VNPay
 */
module.exports.paymentVNPay = async (req, res) => {
  try {
    const { bookingCode, phone } = req.query;

    if (!bookingCode || !phone) {
      res.redirect("/");
      return;
    }

    // Lấy booking đầu tiên (theo mã mà client gửi lên)
    const booking = await HotelBooking.findOne({
      code: bookingCode,
      "guest.phone": phone,
    }).lean();

    if (!booking) {
      res.redirect("/");
      return;
    }

    // Số tiền thanh toán: ưu tiên orderTotal (tổng tiền cả đơn)
    const totalAmount =
      Number(booking.orderTotal || booking.totalAmount || 0);

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
    let returnUrl = `${process.env.WEBSITE_DOMAIN}/hotel-booking/payment-vnpay-result`;
    let orderId = `${bookingCode}-${phone}-${Date.now()}`;
    let amount = totalAmount;
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
    vnp_Params["vnp_OrderInfo"] = "Thanh toan dat phong khach san:" + orderId;
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
    let signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");
    vnp_Params["vnp_SecureHash"] = signed;
    vnpUrl += "?" + querystring.stringify(vnp_Params, { encode: false });

    res.redirect(vnpUrl);
  } catch (error) {
    console.error("hotel-booking.paymentVNPay error:", error);
    res.redirect("/");
  }
};

/**
 * GET /hotel-booking/payment-vnpay-result
 * Xử lý kết quả từ VNPay
 */
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
    let signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

    if (secureHash === signed) {
      // Parse vnp_TxnRef: format là "bookingCode-phone-timestamp"
      // Vì bookingCode có thể chứa dấu "-" (VD: HB123-1), nên phải parse từ cuối lên
      const parts = vnp_Params["vnp_TxnRef"].split("-");
      const timestamp = parts.pop(); // Bỏ phần timestamp cuối cùng
      const phone = parts.pop(); // Lấy phone (phần gần cuối)
      const bookingCode = parts.join("-"); // Phần còn lại là bookingCode (có thể có nhiều dấu -)
      
      console.log('VNPay callback - Parsed:', { bookingCode, phone, timestamp, original: vnp_Params["vnp_TxnRef"] });
      
      const responseCode = vnp_Params["vnp_ResponseCode"];
      
      if (responseCode === "00") {
        // Giao dịch thành công - cập nhật tất cả bookings cùng base code (VD: HB123456 và HB123456-1, HB123456-2)
        // Loại bỏ suffix nếu có để lấy base code
        const baseCode = bookingCode.replace(/-\d+$/, '');
        
        // Tìm tất cả bookings có code là baseCode hoặc baseCode với suffix (-1, -2, -3, ...)
        const bookingsToUpdate = await HotelBooking.find({
          $or: [
            { code: baseCode },
            { code: { $regex: `^${baseCode}-\\d+$` } }
          ],
          "guest.phone": phone,
          paymentStatus: "unpaid", // Sửa từ status thành paymentStatus
        });
        
        // Cập nhật paymentStatus và bỏ temporary hold cho tất cả bookings tìm được
        for (const booking of bookingsToUpdate) {
          booking.paymentStatus = "paid";
          booking.isTemporaryHold = false; // Không còn là đơn tạm
          booking.holdExpiresAt = null; // Xóa thời gian hết hạn
          await booking.save();
        }
        
        console.log(`VNPay payment successful: Updated ${bookingsToUpdate.length} bookings with base code ${baseCode}`);
        
        return res.redirect(
          `${process.env.WEBSITE_DOMAIN}/hotel-booking/success?bookingCode=${bookingCode}&phone=${phone}`
        );
      } else {
        console.log("VNPay payment failed with response code:", responseCode);
        return res.redirect("/?message=Thanh toán không thành công. Vui lòng thử lại.");
      }
    } else {
      console.error("VNPay signature verification failed");
      return res.redirect("/?message=Xác thực thanh toán thất bại. Vui lòng liên hệ hỗ trợ.");
    }
  } catch (error) {
    console.error("hotel-booking.paymentVNPayResult error:", error);
    res.redirect("/");
  }
};

/**
 * Helper: Hủy tất cả booking trong cùng group code (set status = cancelled)
 */
async function _cancelHotelBookingGroup(code, phone) {
  try {
    // Lấy base code (loại bỏ suffix -1, -2, ...): HB123-1 → HB123
    const baseCode = String(code).replace(/-\d+$/, "");

    // Hủy cả booking gốc và toàn bộ booking con cùng nhóm
    await HotelBooking.updateMany(
      {
        $or: [
          { code: baseCode },
          { code: { $regex: `^${baseCode}-\\d+$` } },
        ],
        "guest.phone": phone,
        paymentStatus: { $ne: "paid" },
      },
      { status: "cancelled", isTemporaryHold: false, holdExpiresAt: null }
    );
  } catch (err) {
    console.error("[hotel cancelHold] Error:", err.message);
  }
}

/**
 * GET /hotel-booking/cancel-hold?bookingCode=...&phone=...
 * POST /hotel-booking/cancel-hold  (sendBeacon dùng POST)
 * Hủy đặt phòng tạm thời và trả lại phòng
 */
module.exports.cancelHold = async (req, res) => {
  try {
    // Hỗ trợ GET (query string) và POST (sendBeacon body text/plain)
    let bookingCode = req.query.bookingCode || req.body?.bookingCode;
    let phone       = req.query.phone       || req.body?.phone;

    if (!bookingCode && req.body && typeof req.body === "string") {
      const params = new URLSearchParams(req.body);
      bookingCode = params.get("bookingCode");
      phone       = params.get("phone");
    }

    if (!bookingCode || !phone) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    const booking = await HotelBooking.findOne({
      code: bookingCode,
      "guest.phone": phone,
    }).lean();

    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy đặt phòng" });
    }
    if (booking.paymentStatus === "paid") {
      return res.json({ code: "error", message: "Đơn đã thanh toán, không thể hủy" });
    }
    if (booking.status === "cancelled") {
      return res.json({ code: "ok", message: "Đơn đã hủy trước đó" });
    }

    // Phân biệt "explicit cancel" (GET / nút hủy) vs sendBeacon POST
    const isExplicit = req.headers["x-cancel-reason"] === "explicit" ||
                       req.method === "GET";
    const isExpired  = booking.holdExpiresAt && new Date() > new Date(booking.holdExpiresAt);

    if (!isExpired && !isExplicit) {
      // sendBeacon khi rời trang nhưng đơn chưa hết hạn → giữ nguyên
      return res.json({ code: "skipped", message: "Đơn chưa hết hạn, giữ nguyên" });
    }

    await _cancelHotelBookingGroup(bookingCode, phone);
    return res.json({ code: "success", message: "Đã hủy đặt phòng" });
  } catch (err) {
    console.error("hotel-booking.cancelHold error:", err);
    return res.json({ code: "error", message: "Có lỗi xảy ra" });
  }
};

/** Lấy toàn bộ booking trong cùng group (HB123, HB123-1, …) */
async function _fetchHotelBookingGroup(bookingCode, phone) {
  const baseCode = String(bookingCode).replace(/-\d+$/, "");
  return HotelBooking.find({
    $or: [
      { code: baseCode },
      { code: { $regex: `^${baseCode}-\\d+$` } },
    ],
    "guest.phone": phone,
  })
    .populate(
      "hotel.hotelId",
      "name address roomTypes currency ageBands thumbnail " +
      "earlyCheckinFee earlyCheckinTime lateCheckoutFee lateCheckoutTime usefulInfo"
    )
    .sort({ createdAt: 1 })
    .lean();
}

/** Build dữ liệu hiển thị chi tiết đơn (phòng, dịch vụ, thanh toán) */
function _buildHotelBookingDisplayDetail(bookings, bookingCode, phone) {
  const firstBooking = bookings[0];
  const hotelDoc =
    firstBooking.hotel?.hotelId && typeof firstBooking.hotel.hotelId === "object"
      ? firstBooking.hotel.hotelId
      : null;
  const roomTypes = Array.isArray(hotelDoc?.roomTypes) ? hotelDoc.roomTypes : [];
  const ageBands = Array.isArray(hotelDoc?.ageBands) ? hotelDoc.ageBands : [];
  const currency = hotelDoc?.currency || "VND";

  const { normalizeRoomsData, buildAllocationRoomsDisplay } = require("../../helpers/hotel-guest-rooms.helper");

  const roomItems = bookings.map((b) => {
    const rt = roomTypes.find((r) => String(r._id) === String(b.roomTypeId)) || null;
    const roomTypeName = rt?.name || rt?.title || "Loại phòng";
    const roomTypeImage =
      (Array.isArray(rt?.images) && rt.images[0]) ||
      hotelDoc?.thumbnail ||
      b.hotel?.thumbnail ||
      "/images/no-image.jpg";

    let roomsDetails = [];
    let adultsCount = b.adults || 0;
    let childrenCount = b.children || 0;
    let babiesCount = 0;
    if (b.roomsData) {
      try {
        const parsed = JSON.parse(decodeURIComponent(b.roomsData));
        const normalized = normalizeRoomsData(parsed);
        roomsDetails = buildAllocationRoomsDisplay(normalized);
        adultsCount = roomsDetails.reduce((s, r) => s + r.adultCount, 0);
        childrenCount = roomsDetails.reduce((s, r) => s + r.childCount, 0);
        babiesCount = roomsDetails.reduce((s, r) => s + r.babyCount, 0);
      } catch (e) {
        /* ignore */
      }
    }

    const nights = b.totalNights || 1;
    const quantity = b.rooms || roomsDetails.length || 1;
    const roomBaseSubtotal = (b.pricePerNight || 0) * nights * quantity;

    const services = [];
    const perItemServices = b.additionalServices?.perItem || {};
    Object.values(perItemServices).forEach((svcMap) => {
      if (!svcMap || typeof svcMap !== "object") return;
      Object.entries(svcMap).forEach(([serviceId, qtyStr]) => {
        const qty = parseInt(qtyStr) || 0;
        if (qty <= 0) return;

        if (serviceId.includes("extra_bed")) {
          const price = rt?.extraBedFeePerNight || 0;
          services.push({
            name: "Giường phụ",
            detail: `${qty} giường × ${nights} đêm`,
            price: price * qty * nights,
          });
        } else if (serviceId.includes("breakfast_")) {
          const band = ageBands.find((bd) => {
            const bandKey = bd.bandName.toLowerCase().replace(/\s+/g, "_");
            return serviceId.includes(bandKey);
          });
          if (band) {
            const price = band.breakfastFeePerPersonPerMeal || 0;
            services.push({
              name: `Ăn sáng / ${band.bandName}`,
              detail: `${qty} người × ${nights} buổi sáng`,
              price: price * qty * nights,
            });
          }
        }
      });
    });

    const servicesSubtotal = services.reduce((s, svc) => s + svc.price, 0);
    const subtotal = roomBaseSubtotal + servicesSubtotal;

    return {
      roomTypeName,
      roomTypeImage,
      nights,
      quantity,
      pricePerNight: b.pricePerNight || 0,
      roomBaseSubtotal,
      subtotal,
      adultsCount,
      childrenCount,
      babiesCount,
      roomsDetails,
      services,
    };
  });

  const globalServices = [];
  const globalSvcMap = firstBooking.additionalServices?.global || {};
  Object.entries(globalSvcMap).forEach(([key, value]) => {
    if (key === "early_checkin" && value && hotelDoc?.earlyCheckinFee > 0) {
      globalServices.push({
        name: `Nhận phòng sớm (từ ${hotelDoc.earlyCheckinTime || ""})`,
        price: hotelDoc.earlyCheckinFee,
      });
    } else if (key === "late_checkout" && value && hotelDoc?.lateCheckoutFee > 0) {
      globalServices.push({
        name: `Trả phòng muộn (đến ${hotelDoc.lateCheckoutTime || ""})`,
        price: hotelDoc.lateCheckoutFee,
      });
    } else if (key === "airport_transfer" && (value === "true" || value === true)) {
      const price = hotelDoc?.usefulInfo?.airportTransferFee || 0;
      if (price > 0) {
        globalServices.push({ name: "Đưa đón sân bay (1 chiều)", price });
      }
    } else if (key === "service_airport_transfer" || key.startsWith("service_")) {
      const qty = parseInt(value) || 0;
      if (qty > 0) {
        const price = hotelDoc?.usefulInfo?.airportTransferFee || 0;
        if (price > 0) {
          globalServices.push({
            name: `Đưa đón sân bay (${qty} chiều)`,
            price: price * qty,
          });
        }
      }
    }
  });

  const roomsSubtotal = roomItems.reduce((s, i) => s + i.roomBaseSubtotal, 0);
  const itemServicesTotal = roomItems.reduce(
    (s, i) => s + (i.subtotal - i.roomBaseSubtotal),
    0
  );
  const globalServicesTotal = globalServices.reduce((s, svc) => s + svc.price, 0);
  const taxPercent = 10;
  const feePercent = 5;
  const tax = Math.round(roomsSubtotal * taxPercent / 100);
  const fee = Math.round(roomsSubtotal * feePercent / 100);
  const orderTotal =
    firstBooking.orderTotal ||
    bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
  const extraOccupancyFee = Math.max(
    0,
    orderTotal - roomsSubtotal - tax - fee - itemServicesTotal - globalServicesTotal
  );

  return {
    code: bookingCode,
    guest: firstBooking.guest,
    checkIn: moment(firstBooking.checkIn).format("DD/MM/YYYY"),
    checkOut: moment(firstBooking.checkOut).format("DD/MM/YYYY"),
    nights: firstBooking.totalNights || 1,
    hotel: {
      name: hotelDoc?.name || firstBooking.hotel?.name || "",
      address: hotelDoc?.address || firstBooking.hotel?.address || "",
    },
    totalAmount: orderTotal,
    currency,
    roomItems,
    globalServices,
    priceSummary: {
      roomsSubtotal,
      itemServicesTotal,
      globalServicesTotal,
      extraOccupancyFee,
      tax,
      taxPercent,
      fee,
      feePercent,
      orderTotal,
    },
    isTemporaryHold: firstBooking.isTemporaryHold,
    holdExpiresAt: firstBooking.holdExpiresAt,
    paymentStatus: firstBooking.paymentStatus,
    paymentMethod: firstBooking.paymentMethod,
    transferProofImages: firstBooking.transferProofImages || [],
    phone,
  };
}

/**
 * GET /hotel-booking/pending?bookingCode=...&phone=...
 * Hiển thị trang đơn tạm thời (chưa thanh toán)
 */
module.exports.pending = async (req, res) => {
  try {
    const { bookingCode, phone } = req.query;

    if (!bookingCode || !phone) {
      return res.redirect("/");
    }

    const bookings = await _fetchHotelBookingGroup(bookingCode, phone);

    if (!bookings || bookings.length === 0) {
      return res.redirect("/");
    }

    const firstBooking = bookings[0];
    if (firstBooking.paymentStatus === "paid") {
      return res.redirect(
        `/hotel-booking/success?bookingCode=${bookingCode}&phone=${phone}`
      );
    }

    // Auto-cancel nếu đơn đã hết hạn giữ chỗ
    if (
      firstBooking.isTemporaryHold &&
      firstBooking.paymentStatus === "unpaid" &&
      firstBooking.holdExpiresAt &&
      new Date() > new Date(firstBooking.holdExpiresAt)
    ) {
      await _cancelHotelBookingGroup(bookingCode, phone);
      return res.redirect("/?expired=1");
    }

    const bookingDetail = _buildHotelBookingDisplayDetail(bookings, bookingCode, phone);

    return res.render("client/pages/hotel-booking-pending", {
      pageTitle: "Đơn đặt phòng tạm thời",
      bookingDetail,
    });
  } catch (error) {
    console.error("hotel-booking.pending error:", error);
    return res.redirect("/");
  }
};

/**
 * GET /hotel-booking/success?bookingCode=...&phone=...
 * Hiển thị trang đặt phòng thành công (đã thanh toán hoặc xác nhận)
 */
module.exports.success = async (req, res) => {
  try {
    const { bookingCode, phone } = req.query;

    if (!bookingCode || !phone) {
      return res.redirect("/");
    }

    const bookings = await _fetchHotelBookingGroup(bookingCode, phone);

    if (!bookings || bookings.length === 0) {
      return res.redirect("/");
    }

    const bookingDetail = _buildHotelBookingDisplayDetail(bookings, bookingCode, phone);

    return res.render("client/pages/hotel-booking-success", {
      pageTitle: "Đặt phòng thành công",
      bookingDetail,
    });
  } catch (error) {
    console.error("hotel-booking.success error:", error);
    return res.redirect("/");
  }
};

