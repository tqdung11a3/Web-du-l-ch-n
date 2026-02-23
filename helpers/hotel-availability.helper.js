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

  let totalEffective = 0;

  roomsData.forEach(room => {
    // Người lớn luôn tính đủ 1
    const adults = room.adults || 0;
    totalEffective += adults;

    // Trẻ em tính theo age bands
    if (room.children && Array.isArray(room.children)) {
      room.children.forEach(child => {
        const age = child.age;
        
        // Tìm age band phù hợp
        const band = ageBands.find(b => {
          const minAge = b.minAge || 0;
          const maxAge = b.maxAge;
          
          if (maxAge === null || maxAge === undefined) {
            // Không giới hạn trên
            return age >= minAge;
          } else {
            return age >= minAge && age <= maxAge;
          }
        });

        if (band && band.countInOccupancy) {
          totalEffective += (band.occupancyWeight || 1);
        }
      });
    }
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
function getAvailableRoomsForType(allRooms, roomTypeId, bookings, checkIn, checkOut) {
  // Lọc phòng thuộc room type này và có status vacant
  const roomsOfType = allRooms.filter(r =>
    String(r.roomTypeId) === String(roomTypeId) &&
    r.status === "vacant"
  );

  // Tập hợp roomId đã bị chiếm bởi booking có overlap thời gian
  // Chỉ tính booking đã gán phòng cụ thể (roomId != null)
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

module.exports = {
  calculateEffectiveOccupancy,
  hasTimeOverlap,
  getAvailableRoomsForType,
  checkHotelAvailability,
};

