// controllers/client/cart.controller.js
// Controller cho giỏ hàng thống nhất (Tour + Hotel)
const Cart = require("../../models/cart.model");
const Hotel = require("../../models/hotel.model");
const HotelBooking = require("../../models/hotel-booking.model");
const Tour = require("../../models/tour.model");
const moment = require("moment");
const { v4: uuidv4 } = require('uuid');
const { getAvailableRoomsForType, calculateEffectiveOccupancy } = require("../../helpers/hotel-availability.helper");
const {
  normalizeRoomsData,
  buildAllocationRoomsDisplay,
  countGuests,
  normalizeRoom,
} = require("../../helpers/hotel-guest-rooms.helper");

function parseItemRoomsData(roomsDataStr) {
  if (!roomsDataStr) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(roomsDataStr));
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const normalized = normalizeRoomsData(raw);
    return {
      normalized,
      display: buildAllocationRoomsDisplay(normalized),
      counts: countGuests(normalized),
    };
  } catch (e) {
    return null;
  }
}

/**
 * GET /cart - Hiển thị trang giỏ hàng thống nhất (Tour + Hotel)
 */
module.exports.index = async (req, res) => {
  try {
    // Lấy hotel cart từ database
    const hotelCart = await getHotelCart(req, res);
    
    // Prepare hotel cart data
    let hotelCartData = null;
    let hotelInfo = null;
    let hotelSubtotal = 0;
    let hotelExtraOccupancyFee = 0; // Tổng phụ thu vượt base occupancy
    let hotelTax = 0;
    let hotelFee = 0;
    let hotelTotal = 0;
    let hotelCurrency = 'VND';
    let hotelTaxPercent = 10;
    let hotelFeePercent = 5;
    let hotelAdditionalServices = [];
    let hotelPolicies = null;
    
    if (hotelCart && hotelCart.items && hotelCart.items.length > 0) {
      // Lấy thông tin hotel
      hotelInfo = await Hotel.findOne({ _id: hotelCart.hotelId, deleted: false })
        .populate('province', 'name')
        .lean();
      
      if (hotelInfo) {
        // Validate và cập nhật số phòng trống
        const checkInMoment = moment(hotelCart.items[0].checkInDate);
        const checkOutMoment = moment(hotelCart.items[0].checkOutDate);
        
        const hotelBookings = await HotelBooking.find({
          'hotel.hotelId': hotelCart.hotelId,
          status: { $nin: ['cancelled', 'checked_out'] }, // Loại bỏ đã hủy và đã trả phòng
          $or: [
            { checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }
          ]
      }).lean();

        const individualRooms = Array.isArray(hotelInfo.rooms) ? hotelInfo.rooms : [];
        
        for (let item of hotelCart.items) {
          const availableRooms = getAvailableRoomsForType(
            individualRooms,
            item.roomTypeId,
            hotelBookings,
            checkInMoment.toDate(),
            checkOutMoment.toDate()
          );
          item.maxAvailable = availableRooms.length;
          
          if (item.quantity > item.maxAvailable) {
            item.quantity = Math.max(1, item.maxAvailable);
          }
          
          // Parse roomsData để lấy chi tiết từng phòng
          if (item.roomsData) {
            const parsed = parseItemRoomsData(item.roomsData);
            if (parsed) {
              item.roomsDetails = parsed.display;
              item.adults = parsed.counts.adults;
              item.children = parsed.counts.children;
              item.babies = parsed.counts.babies;
              item.rooms = parsed.normalized.length;
              item.quantity = parsed.normalized.length;
            } else {
              item.roomsDetails = [];
            }
          }
        }
        
        await hotelCart.save();
        
        // Tính tổng tiền (bao gồm phụ thu vượt base occupancy)
        let hotelSubtotalCalc = 0;
        hotelExtraOccupancyFee = 0; // Reset phụ thu vượt base occupancy
        for (const item of hotelCart.items) {
          // Giá cơ bản
          const basePrice = item.pricePerNight * item.nights * item.quantity;
          hotelSubtotalCalc += basePrice;
          
          // Tính phụ thu vượt base occupancy nếu có roomsData
          const parsed = parseItemRoomsData(item.roomsData);
          if (parsed) {
            const parsedRoomsData = parsed.normalized;
            const roomType = hotelInfo.roomTypes?.find(rt => String(rt._id) === String(item.roomTypeId));
            if (roomType) {
              const ageBands = hotelInfo.ageBands || [];
              const baseOccupancy = roomType.baseOccupancy || 2;
              let itemExtraFee = 0;

              parsedRoomsData.forEach((roomData) => {
                const room = normalizeRoom(roomData);
                const roomAdults = room.adults.length;
                const minors = [...(room.children || []), ...(room.babies || [])];
                const roomEffectiveOccupancy = calculateEffectiveOccupancy([roomData], ageBands);

                if (roomEffectiveOccupancy > baseOccupancy) {
                  const roomExcessOccupancy = roomEffectiveOccupancy - baseOccupancy;
                  let roomExtraFee = 0;
                  let remainingExcessOccupancy = roomExcessOccupancy;

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

                  if (remainingExcessOccupancy > 0 && minors.length > 0) {
                    for (const person of minors) {
                      if (remainingExcessOccupancy <= 0) break;

                      const age = person.age || 0;
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

                  itemExtraFee += roomExtraFee * item.nights;
                }
              });

              if (parsedRoomsData.length < item.quantity) {
                itemExtraFee = itemExtraFee * item.quantity;
              }
              hotelExtraOccupancyFee += itemExtraFee;
            }
          }
        }
        
        // KHÔNG cộng phụ thu vào subtotal (phụ thu sẽ hiển thị riêng)
        hotelSubtotal = hotelSubtotalCalc; // Chỉ giá cơ bản
        
        // Thuế và phí tính trên giá cơ bản (không bao gồm phụ thu)
        hotelTax = Math.round(hotelSubtotal * hotelTaxPercent / 100);
        hotelFee = Math.round(hotelSubtotal * hotelFeePercent / 100);
        
        // Tổng cộng = giá cơ bản + phụ thu + thuế + phí
        hotelTotal = hotelSubtotal + hotelExtraOccupancyFee + hotelTax + hotelFee;
        hotelCurrency = hotelInfo.currency || 'VND';
        
        
        // Dịch vụ chung cho toàn bộ booking (không theo từng phòng)
        if (hotelInfo.earlyCheckinTime && hotelInfo.earlyCheckinFee && hotelInfo.earlyCheckinFee > 0) {
          hotelAdditionalServices.push({
            id: 'early_checkin',
            name: `Nhận phòng sớm (từ ${hotelInfo.earlyCheckinTime})`,
            price: hotelInfo.earlyCheckinFee,
            unit: 'lần',
            maxQuantity: 1,
            isCheckbox: true,
            isGlobal: true
          });
        }

        if (hotelInfo.lateCheckoutTime && hotelInfo.lateCheckoutFee && hotelInfo.lateCheckoutFee > 0) {
          hotelAdditionalServices.push({
            id: 'late_checkout',
            name: `Trả phòng muộn (đến ${hotelInfo.lateCheckoutTime})`,
            price: hotelInfo.lateCheckoutFee,
            unit: 'lần',
            maxQuantity: 1,
            isCheckbox: true,
            isGlobal: true
          });
        }

        if (hotelInfo.usefulInfo && hotelInfo.usefulInfo.airportTransferFee && hotelInfo.usefulInfo.airportTransferFee > 0) {
          hotelAdditionalServices.push({
            id: 'airport_transfer',
            name: 'Đưa đón sân bay (1 chiều)',
            price: hotelInfo.usefulInfo.airportTransferFee,
            unit: 'lần',
            maxQuantity: 2,
            isCheckbox: false, // Quantity-based vì maxQuantity = 2
            isGlobal: true
          });
        }
        
        // Quy định
        const checkInTime = hotelInfo.checkinTimeFrom && hotelInfo.checkinTimeTo 
          ? `${hotelInfo.checkinTimeFrom} - ${hotelInfo.checkinTimeTo}`
          : (hotelInfo.checkinTimeFrom || '14:00');
        const checkOutTime = hotelInfo.checkoutTimeFrom && hotelInfo.checkoutTimeTo
          ? `${hotelInfo.checkoutTimeFrom} - ${hotelInfo.checkoutTimeTo}`
          : (hotelInfo.checkoutTimeFrom || '12:00');
        
        hotelPolicies = {
          checkInTime: checkInTime,
          checkOutTime: checkOutTime,
          cancellationPolicy: hotelInfo.cancellationPolicy || 'Hủy miễn phí trước 24 giờ trước check-in. Sau đó thu phí 50% giá trị booking.',
          paymentRequirement: 'Vui lòng xuất trình CMND/CCCD khi check-in'
        };
        
        // Convert to plain object và đảm bảo additionalServices được giữ lại
        hotelCartData = hotelCart.toObject();
        
        // Re-attach roomsDetails và additionalServices sau khi toObject (vì có thể bị mất)
        hotelCartData.items.forEach((item, itemIndex) => {
          // Re-parse roomsData để lấy roomsDetails (vì toObject() làm mất field này)
          if (item.roomsData) {
            const parsed = parseItemRoomsData(item.roomsData);
            if (parsed) {
              item.roomsDetails = parsed.display;
              item.adults = parsed.counts.adults;
              item.children = parsed.counts.children;
              item.babies = parsed.counts.babies;
            } else {
              item.roomsDetails = [];
            }
          }
          
          const itemServices = [];
          const roomType = hotelInfo.roomTypes?.find(rt => String(rt._id) === String(item.roomTypeId));
          
          // Dịch vụ cho từng phòng: Extra bed
          if (roomType && roomType.maxExtraBeds && roomType.maxExtraBeds > 0) {
            itemServices.push({
              id: `extra_bed_item_${itemIndex}`,
              itemIndex: itemIndex,
              roomTypeId: String(item.roomTypeId),
              name: 'Giường phụ',
              price: roomType.extraBedFeePerNight || 0,
              unit: 'giường/đêm',
              maxQuantity: roomType.maxExtraBeds * item.quantity,
              nights: item.nights || 1,
              description: `Tối đa ${roomType.maxExtraBeds} giường/phòng`
            });
          }
          
          // Breakfast cho từng phòng
          if (hotelInfo.ageBands && Array.isArray(hotelInfo.ageBands)) {
            const totalNights = item.nights || 1;
            
            // Trích xuất thông tin người lớn và trẻ em từ roomsDetails để hiển thị chi tiết
            let totalAdultsInItem = 0;
            const childrenInThisItem = [];
            if (item.roomsDetails && Array.isArray(item.roomsDetails)) {
              item.roomsDetails.forEach((roomData) => {
                totalAdultsInItem += roomData.adultCount || 0;
                if (roomData.children && Array.isArray(roomData.children)) {
                  roomData.children.forEach((child) => {
                    childrenInThisItem.push(child.age || 0);
                  });
                }
                if (roomData.babies && Array.isArray(roomData.babies)) {
                  roomData.babies.forEach((baby) => {
                    childrenInThisItem.push(baby.age || 0);
                  });
                }
              });
            }
            
            hotelInfo.ageBands.forEach((band, bandIndex) => {
              if (!band.breakfastIsFree && band.breakfastFeePerPersonPerMeal && band.breakfastFeePerPersonPerMeal > 0) {
                const isAdultBand = band.bandType === 'adult' ||
                                   (band.minAge >= 12 && (band.maxAge === null || band.maxAge >= 18));

                let bandPersonCount = 0;
                let detailText = '';

                if (isAdultBand) {
                  bandPersonCount = totalAdultsInItem;
                  if (totalAdultsInItem > 0) {
                    detailText = `${totalAdultsInItem} người lớn`;
                  }
                } else {
                  const childrenInBand = childrenInThisItem.filter(age => {
                    const minAge = band.minAge || 0;
                    const maxAge = band.maxAge;
                    if (maxAge === null || maxAge === undefined) return age >= minAge;
                    return age >= minAge && age <= maxAge;
                  });
                  bandPersonCount = childrenInBand.length;
                  if (childrenInBand.length > 0) {
                    const childAgesText = childrenInBand.map(age => `${age} tuổi`).join(', ');
                    detailText = `${childrenInBand.length} trẻ em (${childAgesText})`;
                  }
                }

                // Không hiện nếu không có ai thuộc band này trong phòng
                if (bandPersonCount === 0) return;

                const description = detailText
                  ? `${detailText} • ${totalNights} buổi sáng`
                  : `${totalNights} buổi sáng`;

                itemServices.push({
                  id: `breakfast_${band.bandName.toLowerCase().replace(/\s+/g, '_')}_${bandIndex}_item_${itemIndex}`,
                  itemIndex: itemIndex,
                  roomTypeId: String(item.roomTypeId),
                  name: `Ăn sáng / ${band.bandName}`,
                  price: band.breakfastFeePerPersonPerMeal,
                  unit: 'người',
                  // maxQuantity = số người trong band (counter = số người muốn ăn sáng)
                  maxQuantity: bandPersonCount,
                  // JS sẽ tính: qty × price × nights
                  nights: totalNights,
                  isBreakfast: true,
                  ageBandName: band.bandName,
                  description: description
                });
              }
            });
          }
          
          // Gán vào plain object
          item.additionalServices = itemServices;
        });
      }
    }
    
    res.render("client/pages/cart-unified", {
      pageTitle: "Giỏ hàng",
      account: req.account || null,
      hotelCart: hotelCartData,
      hotelInfo,
      hotelSubtotal,
      hotelExtraOccupancyFee: hotelExtraOccupancyFee || 0,
      hotelTax,
      hotelTaxPercent,
      hotelFee,
      hotelFeePercent,
      hotelTotal,
      hotelCurrency,
      hotelAdditionalServices,
      hotelPolicies
    });
  } catch (error) {
    console.error("Error in unified cart.index:", error);
    res.status(500).send("Có lỗi xảy ra");
  }
};

/**
 * POST /cart/detail - Lấy thông tin chi tiết tour cho giỏ hàng
 */
module.exports.getCartDetail = async (req, res) => {
  try {
    // Body là array trực tiếp từ JSON.stringify(getCart())
    let items = req.body;
    
    // Nếu body không phải array, thử lấy từ items property
    if (!Array.isArray(items)) {
      items = req.body.items || [];
    }
    
    if (items.length === 0) {
      return res.json({ code: "success", cart: [] });
      }

    // Lấy danh sách tourId
    const tourIds = items.map(item => item.tourId).filter(Boolean);
    
    // Tìm tours trong database
    const tours = await Tour.find({
      _id: { $in: tourIds },
      deleted: false,
      status: "active",
    })
      .populate("companyId", "name slug logo")
      .populate("departureCity", "name")
      .lean();
    
    // Map tours với thông tin từ cart
    const toursMap = {};
    tours.forEach(tour => {
      toursMap[String(tour._id)] = tour;
    });
    
    // Enrich cart items với thông tin từ database
    const enrichedItems = items.map(item => {
      const tour = toursMap[String(item.tourId)];
      if (!tour) {
        return null; // Tour không tồn tại hoặc đã bị xóa
      }
      
      // Format departure date:
      // Ưu tiên ngày mà client đã chọn (departureDateDisplay) nếu có trong cart item,
      // nếu không thì fallback về ngày khởi hành mặc định của tour
      const departureDate =
        (item.departureDateDisplay && String(item.departureDateDisplay).trim()) ||
        (tour.departureDate
          ? moment(tour.departureDate).format("DD/MM/YYYY")
          : "");
      
      // Tên điểm khởi hành: populate departureCity; fallback field ảo nếu có
      let cityName = "";
      const dep = tour.departureCity;
      if (dep && typeof dep === "object" && dep.name) {
        cityName = dep.name;
      } else if (typeof tour.departureCityName === "string" && tour.departureCityName.trim()) {
        cityName = tour.departureCityName.trim();
      }
      
      // Company info
      const company = tour.companyId || null;
      
      return {
        ...item,
        tourId: String(tour._id),
        name: tour.name,
        slug: tour.slug,
        avatar: tour.thumbnail || tour.avatar || "/images/no-image.jpg",
        priceNewAdult: tour.priceNewAdult || 0,
        priceNewChildren: tour.priceNewChildren || 0,
        priceNewBaby: tour.priceNewBaby || 0,
        seatsTotal: tour.seatsRemaining || 0,
        departureDate: departureDate,
        cityName: cityName,
        babyPricingMode: tour.babyPricingMode || "fixed",
        babyPricingRules: tour.babyPricingRules || [],
        company: company ? {
          name: company.name || "",
          slug: company.slug || "",
          logo: company.logo || ""
        } : null
      };
    }).filter(Boolean); // Loại bỏ null

    return res.json({
      code: "success",
      cart: enrichedItems // JavaScript expect "cart", không phải "items"
    });
  } catch (error) {
    console.error("Error in cart.getCartDetail:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra",
      cart: []
    });
  }
};

/**
 * Helper: Lấy hotel cart
 */
async function getHotelCart(req, res) {
  const userId = req.account ? req.account.id || req.account._id : null;
  let sessionId = req.cookies?.cart_session;

  if (!sessionId) {
    sessionId = uuidv4();
    if (res) {
      res.cookie('cart_session', sessionId, {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
      });
    }
  }

  let cart;
  if (userId) {
    cart = await Cart.findOne({ userId });
  }
  
  if (!cart && sessionId) {
    cart = await Cart.findOne({ sessionId });
  }

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
