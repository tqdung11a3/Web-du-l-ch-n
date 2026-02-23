// helpers/hotel-allocation.helper.js
//
// Thuật toán Greedy phân bổ đoàn khách vào nhiều khách sạn khi 1 khách sạn không đủ chỗ.
//
// Bài toán:
//   - Tour có 50 người, khách sạn A chỉ còn chỗ 20 người → cần chia sang B, C...
// Thuật toán:
//   1. Tính sức chứa còn lại (capacity) của từng hotel theo ngày lưu trú.
//   2. Sort DESC theo capacity (greedy: hotel lớn nhất nhận trước).
//   3. Lần lượt gán người vào hotel cho đến khi hết đoàn hoặc hết hotel.

const Hotel = require("../models/hotel.model");
const HotelBooking = require("../models/hotel-booking.model");
const { getAvailableRoomsForType } = require("./hotel-availability.helper");

/**
 * Lấy tổng sức chứa (số người tối đa) của một hotel trong khoảng ngày lưu trú.
 * Capacity = Σ (số phòng trống của từng loại × maxOccupancy của loại đó)
 *
 * @param {String|ObjectId} hotelId
 * @param {Date} checkIn
 * @param {Date} checkOut
 * @returns {Promise<{ capacity: Number, vacantRooms: Number, hotelName: String }>}
 */
async function getHotelCapacity(hotelId, checkIn, checkOut) {
  const hotel = await Hotel.findById(hotelId)
    .select("name rooms roomTypes status deleted")
    .lean();

  if (!hotel || hotel.deleted || hotel.status !== "active") {
    return { capacity: 0, vacantRooms: 0, hotelName: "" };
  }

  // Lấy tất cả booking còn hiệu lực của hotel này trong khoảng thời gian
  const existingBookings = await HotelBooking.find({
    "hotel.hotelId": hotelId,
    status: { $nin: ["cancelled", "checked_out"] },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  })
    .select("roomTypeId rooms status checkIn checkOut")
    .lean();

  // Tính capacity từ từng loại phòng
  let totalCapacity = 0;
  let totalVacantRooms = 0;

  for (const roomType of hotel.roomTypes || []) {
    const availableRoomIds = getAvailableRoomsForType(
      hotel.rooms || [],
      roomType._id,
      existingBookings,
      checkIn,
      checkOut
    );

    const roomCount = availableRoomIds.length;
    const maxOccupancy = roomType.maxOccupancy || 2;

    totalCapacity += roomCount * maxOccupancy;
    totalVacantRooms += roomCount;
  }

  return {
    capacity: totalCapacity,
    vacantRooms: totalVacantRooms,
    hotelName: hotel.name || "",
  };
}

/**
 * Thuật toán Greedy phân bổ đoàn khách vào danh sách khách sạn của tour.
 *
 * Quy trình:
 *   1. Tính capacity thực tế của từng hotel (theo ngày lưu trú).
 *   2. Sắp xếp DESC theo capacity → hotel nhiều chỗ nhất nhận trước.
 *   3. Lần lượt phân bổ người vào hotel cho đến khi remaining = 0 hoặc hết hotel.
 *
 * @param {Number} totalPeople         - Tổng số người cần phân bổ (adult + children)
 * @param {Array}  accommodations      - tour.accommodations: [{ hotel: ObjectId, note }]
 * @param {Date}   checkIn             - Ngày nhận phòng (= ngày khởi hành tour)
 * @param {Date}   checkOut            - Ngày trả phòng (= ngày kết thúc tour)
 * @returns {Promise<{
 *   allocations: Array<{
 *     hotelId: String,
 *     hotelName: String,
 *     assignedPeople: Number,
 *     capacity: Number,
 *     vacantRooms: Number,
 *     note: String
 *   }>,
 *   totalAssigned: Number,
 *   remaining: Number,
 *   status: 'ok' | 'partial' | 'no_hotels'
 * }>}
 */
async function allocateHotelsForGroup(
  totalPeople,
  accommodations,
  checkIn,
  checkOut
) {
  if (!accommodations || accommodations.length === 0) {
    return {
      allocations: [],
      totalAssigned: 0,
      remaining: totalPeople,
      status: "no_hotels",
    };
  }

  // ── Bước 1: Lấy capacity thực tế của từng hotel song song ──
  const hotelDataList = await Promise.all(
    accommodations.map(async (acc) => {
      const { capacity, vacantRooms, hotelName } = await getHotelCapacity(
        acc.hotel,
        checkIn,
        checkOut
      );
      return {
        hotelId: String(acc.hotel),
        hotelName,
        capacity,
        vacantRooms,
        note: acc.note || "",
      };
    })
  );

  // Lọc bỏ hotel không còn chỗ
  const available = hotelDataList.filter((h) => h.capacity > 0);

  // ── Bước 2: Sort giảm dần theo capacity (Greedy) ──
  available.sort((a, b) => b.capacity - a.capacity);

  // ── Bước 3: Phân bổ ──
  let remaining = totalPeople;
  const allocations = [];

  for (const hotel of available) {
    if (remaining <= 0) break;

    const assigned = Math.min(remaining, hotel.capacity);
    allocations.push({
      hotelId: hotel.hotelId,
      hotelName: hotel.hotelName,
      assignedPeople: assigned,
      capacity: hotel.capacity,
      vacantRooms: hotel.vacantRooms,
      note: hotel.note,
    });
    remaining -= assigned;
  }

  return {
    allocations,
    totalAssigned: totalPeople - remaining,
    remaining,
    // 'ok': đủ chỗ | 'partial': thiếu chỗ | 'no_hotels': không có hotel nào
    status: remaining === 0 ? "ok" : available.length === 0 ? "no_hotels" : "partial",
  };
}

/**
 * Ước lượng ngày trả phòng từ chuỗi thời gian tour.
 * Ví dụ: "5 ngày 4 đêm" → checkOut = checkIn + 4 ngày
 *        Nếu không parse được → mặc định 1 đêm
 *
 * @param {Date}   checkIn
 * @param {String} tourTime - VD: "5 ngày 4 đêm", "3 days 2 nights"
 * @returns {Date}
 */
function estimateCheckOut(checkIn, tourTime) {
  let nights = 1; // mặc định

  if (tourTime && typeof tourTime === "string") {
    // Match "4 đêm" hoặc "4 nights" hoặc "4 night"
    const matchVi = tourTime.match(/(\d+)\s*đêm/i);
    const matchEn = tourTime.match(/(\d+)\s*night/i);
    const match = matchVi || matchEn;
    if (match) {
      nights = parseInt(match[1], 10) || 1;
    }
  }

  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + nights);
  return checkOut;
}

module.exports = {
  getHotelCapacity,
  allocateHotelsForGroup,
  estimateCheckOut,
};
