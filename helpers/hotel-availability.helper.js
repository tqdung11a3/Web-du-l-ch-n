// helpers/hotel-availability.helper.js

const moment = require("moment");

/**
 * Tính effective occupancy dựa trên age bands
 * @param {Array} roomsData - Mảng phòng với cấu trúc: [{ adults: number, children: [{ age: number }] }]
 * @param {Array} ageBands - Cấu hình age bands của hotel/room type
 * @returns {number} - Effective occupancy
 */
function calculateEffectiveOccupancy(roomsData, ageBands) {
  if (!Array.isArray(roomsData) || roomsData.length === 0) {
    return 0;
  }

  const { normalizeRoom } = require("./hotel-guest-rooms.helper");
  let totalEffective = 0;

  roomsData.forEach((rawRoom) => {
    const room = normalizeRoom(rawRoom);

    // Người lớn (12+) luôn tính đủ 1
    totalEffective += (room.adults || []).length;

    // Trẻ em + em bé tính theo age bands
    const minors = [...(room.children || []), ...(room.babies || [])];
    minors.forEach((person) => {
      const age = Number(person.age);

      const band = ageBands.find((b) => {
        const minAge = b.minAge || 0;
        const maxAge = b.maxAge;

        if (maxAge === null || maxAge === undefined) {
          return age >= minAge;
        }
        return age >= minAge && age <= maxAge;
      });

      if (band && band.countInOccupancy) {
        totalEffective += band.occupancyWeight || 1;
      }
    });
  });

  return totalEffective;
}

/**
 * Kiểm tra xem có overlap giữa 2 khoảng thời gian hay không
 * Quy ước: [start, end) - ngày end không tính
 * Không overlap nếu: booking.checkOut <= searchCheckIn || booking.checkIn >= searchCheckOut
 * @param {Date} searchCheckIn 
 * @param {Date} searchCheckOut 
 * @param {Date} bookingCheckIn 
 * @param {Date} bookingCheckOut 
 * @returns {boolean}
 */
function hasTimeOverlap(searchCheckIn, searchCheckOut, bookingCheckIn, bookingCheckOut) {
  const search1 = moment(searchCheckIn).startOf('day');
  const search2 = moment(searchCheckOut).startOf('day');
  const book1 = moment(bookingCheckIn).startOf('day');
  const book2 = moment(bookingCheckOut).startOf('day');

  // Không overlap nếu booking kết thúc trước hoặc bằng ngày check-in của search
  // HOẶC booking bắt đầu sau hoặc bằng ngày check-out của search
  if (book2.isSameOrBefore(search1) || book1.isSameOrAfter(search2)) {
    return false;
  }

  return true;
}

/**
 * Lấy danh sách phòng trống cho một room type trong khoảng thời gian
 * @param {Array} allRooms - Tất cả các phòng của hotel (individual rooms)
 * @param {String} roomTypeId - ID của room type cần kiểm tra
 * @param {Array} bookings - Tất cả bookings của hotel
 * @param {Date} checkIn
 * @param {Date} checkOut
 * @returns {Array} - Mảng các room IDs còn trống
 */

// hàm tính số phòng trống cho một loại phòng cụ thể trong khoảng thời gian

// Trong khoảng checkIn → checkOut, loại phòng X còn bao nhiêu phòng vật lý có thể đặt?
function getAvailableRoomsForType(allRooms, roomTypeId, bookings, checkIn, checkOut) {
  
  // Lọc phòng thuộc room type này và có status vacant
  const roomsOfType = allRooms.filter(r =>
    String(r.roomTypeId) === String(roomTypeId) &&
    r.status === "vacant"
  );

  // Tập hợp roomId đã bị chiếm bởi booking có overlap thời gian
  // Chỉ tính booking đã gán phòng cụ thể (roomId != null)

  // Booking đã gán phòng cụ thể
  const occupiedRoomIds = new Set(
    bookings
      .filter(booking => {
        if (booking.status === "cancelled" || booking.status === "checked_out") return false;
        if (!booking.roomId) return false; // chưa gán phòng cụ thể → không chặn phòng nào
        return hasTimeOverlap(checkIn, checkOut, booking.checkIn, booking.checkOut);
      })
      .map(booking => String(booking.roomId))
  );

  // Với booking chưa gán phòng (roomId = null) nhưng cùng roomTypeId và overlap:
  // đây là booking "chờ xếp phòng" — đếm riêng để trừ vào số phòng còn trống
  
  // booking chờ xếp phòng
  const unassignedOverlapCount = bookings.filter(booking => {
    if (booking.status === "cancelled" || booking.status === "checked_out") return false;
    if (booking.roomId) return false; // đã có roomId → đã xử lý ở trên
    if (String(booking.roomTypeId) !== String(roomTypeId)) return false;
    return hasTimeOverlap(checkIn, checkOut, booking.checkIn, booking.checkOut);
  }).reduce((sum, b) => sum + (b.rooms || 1), 0);

  // Phòng thực sự trống = chưa bị chiếm bởi roomId cụ thể
  const freeRooms = roomsOfType.filter(r => !occupiedRoomIds.has(String(r._id)));

  // Trừ tiếp số phòng "đang chờ xếp" để tránh over-commit
  const availableCount = Math.max(0, freeRooms.length - unassignedOverlapCount);

  // Trả về danh sách _id của các phòng trống
  return freeRooms.slice(0, availableCount).map(r => r._id);
}

/**
 * Kiểm tra xem một hotel có phòng phù hợp với yêu cầu tìm kiếm không
 * @param {Object} hotel - Hotel document (đã populate roomTypes và rooms)
 * @param {Array} bookings - Tất cả bookings của hotel
 * @param {Date} checkIn 
 * @param {Date} checkOut 
 * @param {Array} roomsData - Dữ liệu phòng từ search: [{ adults, children: [{ age }] }]
 * @param {Number} roomsRequested - Số phòng cần đặt
 * @returns {Object|null} - { hasAvailability: boolean, availableRoomTypes: [] }
 */
function checkHotelAvailability(hotel, bookings, checkIn, checkOut, roomsData, roomsRequested) {
  if (!hotel.roomTypes || hotel.roomTypes.length === 0) {
    return { hasAvailability: false, availableRoomTypes: [] };
  }

  const availableRoomTypes = [];

  hotel.roomTypes.forEach(roomType => {
    // 1. Lấy age bands (ưu tiên room type, fallback về hotel)
    const ageBands = (roomType.ageBands && roomType.ageBands.length > 0) 
      ? roomType.ageBands 
      : (hotel.ageBands || []);

    // 2. Kiểm tra sức chứa - CÓ ÍT NHẤT MỘT phòng fit vào room type này
    const maxOccupancy = roomType.maxOccupancy || 2;
    let canFitAtLeastOneRoom = false;
    
    // Kiểm tra xem CÓ ÍT NHẤT MỘT phòng fit vào loại phòng này không
    // (Thay vì yêu cầu TẤT CẢ các phòng đều phải fit, vì khách có thể chọn loại phòng khác cho các phòng khác)
    if (Array.isArray(roomsData) && roomsData.length > 0) {
      for (const singleRoom of roomsData) {
        // Tính effective occupancy cho từng phòng riêng lẻ
        const singleRoomEffectiveOccupancy = calculateEffectiveOccupancy([singleRoom], ageBands);
        
        // Nếu có ít nhất 1 phòng fit vào, đánh dấu phù hợp
        if (singleRoomEffectiveOccupancy <= maxOccupancy) {
          canFitAtLeastOneRoom = true;
          break;
        }
      }
    } else {
      // Nếu không có roomsData, mặc định là phù hợp
      canFitAtLeastOneRoom = true;
    }
    
    // 3. Nếu không có phòng nào phù hợp sức chứa, bỏ qua room type này
    if (!canFitAtLeastOneRoom) {
      return; // Không có phòng nào fit vào room type này
    }

    // 4. Kiểm tra số phòng trống
    const availableRooms = getAvailableRoomsForType(
      hotel.rooms || [], 
      roomType._id, 
      bookings, 
      checkIn, 
      checkOut
    );

    // Chỉ cần có ít nhất 1 phòng trống (không cần >= số phòng cần đặt)
    // vì khách có thể phân bổ các phòng khác nhau cho các loại phòng khác nhau
    if (availableRooms.length >= 1) {
      // Loại phòng này thỏa mãn
      availableRoomTypes.push({
        roomTypeId: roomType._id,
        roomTypeName: roomType.name,
        availableCount: availableRooms.length,
        basePrice: roomType.basePrice,
        maxOccupancy: maxOccupancy,
      });
    }
  });

  return {
    hasAvailability: availableRoomTypes.length > 0,
    availableRoomTypes,
  };
}

/**
 * Tính phụ thu vượt sức chứa cho MỘT phòng theo thuật toán
 * First-Fit-Decreasing (FFD):
 *   1. Liệt kê từng khách kèm { weight, feePerNight, type }.
 *   2. Sắp xếp giảm dần theo weight (nặng nhất trước).
 *   3. Duyệt: nếu sum + weight <= baseOccupancy → nạp vào gói base (miễn phụ
 *      thu); ngược lại → khách vượt, cộng feePerNight vào tổng.
 *
 * Ưu điểm so với logic cũ:
 *   - Khớp trực giác nghiệp vụ: “ai không nằm trong gói giá gốc thì trả phí
 *     của chính band mình”.
 *   - Không nhân phần thập phân của baseOccupancy vào số người NL vượt.
 *
 * @param {Object} roomData - { adults:[{age}], children:[{age}], babies:[{age}] }
 * @param {Object} roomType - có baseOccupancy, extraPersonFeePerNight (fallback NL)
 * @param {Array}  ageBands - age bands của khách sạn / loại phòng
 * @returns {Number} phụ thu / đêm cho 1 phòng
 */
function calculateExtraOccupancyFeePerNight(roomData, roomType, ageBands) {
  const { normalizeRoom } = require("./hotel-guest-rooms.helper");
  const room = normalizeRoom(roomData);
  const baseOccupancy = Number(roomType?.baseOccupancy || 2);
  const bands = Array.isArray(ageBands) ? ageBands : [];

  // Band NL để lấy phí phụ thu cho người lớn (nếu có)
  const adultBand = bands.find(
    (b) =>
      (b.bandType === "adult" ||
        (b.minAge >= 12 && (b.maxAge === null || b.maxAge >= 12))) &&
      b.applyExtraPersonFee === true &&
      b.extraPersonFeePerNight > 0
  );
  const adultFee = adultBand
    ? Number(adultBand.extraPersonFeePerNight)
    : Number(roomType?.extraPersonFeePerNight || 0);

  const findBandByAge = (age) =>
    bands.find((b) => {
      const minAge = b.minAge || 0;
      const maxAge = b.maxAge;
      if (maxAge === null || maxAge === undefined) return age >= minAge;
      return age >= minAge && age <= maxAge;
    });

  // Bước 1: dựng danh sách khách
  const guests = [];
  (room.adults || []).forEach(() => {
    guests.push({ weight: 1, fee: adultFee, type: "adult" });
  });
  const pushMinor = (person) => {
    const age = Number(person?.age || 0);
    const band = findBandByAge(age);
    const weight =
      band && band.countInOccupancy ? Number(band.occupancyWeight || 1) : 0;
    const fee =
      band && band.applyExtraPersonFee && band.extraPersonFeePerNight > 0
        ? Number(band.extraPersonFeePerNight)
        : 0;
    guests.push({ weight, fee, type: band?.bandType || "minor" });
  };
  (room.children || []).forEach(pushMinor);
  (room.babies || []).forEach(pushMinor);

  // Bước 2: sắp giảm dần theo weight (nặng vào gói base trước)
  guests.sort((a, b) => b.weight - a.weight);

  // Bước 3: xếp vào gói base (First-Fit-Decreasing)
  let usedInBase = 0;
  let extraFee = 0;
  const EPS = 1e-9;
  for (const g of guests) {
    if (usedInBase + g.weight <= baseOccupancy + EPS) {
      usedInBase += g.weight;
    } else {
      extraFee += g.fee;
    }
  }
  return extraFee;
}

/**
 * Tính tổng phụ thu vượt sức chứa cho 1 item giỏ hàng / booking.
 * Cộng phụ thu từng phòng × số đêm; nếu số phòng trong roomsData ít hơn
 * item.quantity thì nhân thêm quantity (fallback khi roomsData là mẫu chung).
 *
 * @param {Object} params
 * @param {Array}  params.parsedRoomsData - roomsData đã parse (mảng phòng)
 * @param {Object} params.roomType - loại phòng
 * @param {Array}  params.ageBands
 * @param {Number} params.nights
 * @param {Number} params.quantity - số phòng của item
 * @returns {Number}
 */
function calculateItemExtraOccupancyFee({
  parsedRoomsData,
  roomType,
  ageBands,
  nights,
  quantity,
}) {
  if (!Array.isArray(parsedRoomsData) || parsedRoomsData.length === 0) return 0;
  if (!roomType) return 0;
  let perNight = 0;
  for (const roomData of parsedRoomsData) {
    perNight += calculateExtraOccupancyFeePerNight(roomData, roomType, ageBands);
  }
  let itemExtraFee = perNight * Number(nights || 0);
  if (parsedRoomsData.length < Number(quantity || 0)) {
    itemExtraFee = itemExtraFee * Number(quantity || 1);
  }
  return itemExtraFee;
}

module.exports = {
  calculateEffectiveOccupancy,
  hasTimeOverlap,
  getAvailableRoomsForType,
  checkHotelAvailability,
  calculateExtraOccupancyFeePerNight,
  calculateItemExtraOccupancyFee,
};

