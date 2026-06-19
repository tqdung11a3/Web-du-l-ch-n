// controllers/client/hotel.controller.js
const mongoose = require("mongoose");
const moment = require("moment");
const Hotel = require("../../models/hotel.model");
const HotelBooking = require("../../models/hotel-booking.model");
const HotelReview = require("../../models/hotel-review.model");
const City = require("../../models/city.model");
const SettingWebsiteInfo = require("../../models/setting-website-info.model");
const { generateRandomNumber } = require("../../helpers/generate.helper");
const { checkHotelAvailability } = require("../../helpers/hotel-availability.helper");
const {
  normalizeRoomsData,
  countGuests,
  buildAllocationRoomsDisplay,
} = require("../../helpers/hotel-guest-rooms.helper");

/* ========================================================================
 * SEARCH: GET /hotel/search
 * Đọc dữ liệu từ collection Hotel (do admin nhập) và hiển thị danh sách
 * ======================================================================*/
// ========= SO SÁNH KHÁCH SẠN =========
module.exports.compare = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.render("client/pages/hotel-compare", {
        pageTitle: "So sánh khách sạn",
        hotels: [],
      });
    }

    // Parse hotel IDs từ query string
    const hotelIds = String(ids)
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (hotelIds.length === 0) {
      return res.render("client/pages/hotel-compare", {
        pageTitle: "So sánh khách sạn",
        hotels: [],
      });
    }

    // Lấy thông tin hotel từ database
    const hotels = await Hotel.find({
      _id: { $in: hotelIds },
      deleted: false,
      status: "active",
    })
      .populate("companyId", "name slug logo")
      .populate("province", "name")
      .lean();

    // Sắp xếp theo thứ tự trong query
    const hotelMap = new Map(hotels.map((h) => [String(h._id), h]));
    const orderedHotels = hotelIds
      .map((id) => hotelMap.get(String(id)))
      .filter(Boolean);

    // Gắn rating cho hotels
    const hotelIdsForRating = orderedHotels.map((h) => h._id);
    const reviewsStats = await HotelReview.aggregate([
      {
        $match: {
          hotelId: { $in: hotelIdsForRating },
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

    const ratingMap = {};
    reviewsStats.forEach((stat) => {
      ratingMap[String(stat._id)] = {
        avg: Math.round(stat.avgRating * 10) / 10,
        count: stat.count,
      };
    });

    orderedHotels.forEach((hotel) => {
      const rating = ratingMap[String(hotel._id)];
      hotel.ratingAvg = rating ? rating.avg : 0;
      hotel.ratingCount = rating ? rating.count : 0;

      // Format giá
      hotel.basePriceFormatted = Number(hotel.basePrice || 0).toLocaleString('vi-VN');

      // Tên công ty
      if (hotel.companyId) {
        hotel.company = {
          name: hotel.companyId.name || '',
          slug: hotel.companyId.slug || '',
          logo: hotel.companyId.logo || '',
        };
      }

      // Tên tỉnh/thành
      if (hotel.province && hotel.province.name) {
        hotel.provinceName = hotel.province.name;
      } else {
        hotel.provinceName = hotel.cityName || '';
      }

      // Normalize amenities
      if (Array.isArray(hotel.amenities)) {
        hotel.amenitiesList = hotel.amenities.map(a => 
          typeof a === 'string' ? a : (a.name || '')
        ).filter(Boolean);
      } else {
        hotel.amenitiesList = [];
      }

      // Room types với giá
      if (Array.isArray(hotel.roomTypes)) {
        hotel.roomTypes.forEach(rt => {
          rt.priceFormatted = Number(rt.basePrice || hotel.basePrice || 0).toLocaleString('vi-VN');
        });
      }
    });

    return res.render("client/pages/hotel-compare", {
      pageTitle: "So sánh khách sạn",
      hotels: orderedHotels,
    });
  } catch (error) {
    console.error("Error in hotel compare:", error);
    return res.render("client/pages/hotel-compare", {
      pageTitle: "So sánh khách sạn",
      hotels: [],
    });
  }
};

// ========= TÌM KIẾM KHÁCH SẠN =========
module.exports.search = async (req, res) => {
  try {
    const { location, provinceId, address, checkInDate, checkOutDate, adults, children, rooms, roomsData } =
      req.query || {};

    // Lấy ảnh breadcrumb từ setting
    const setting = await SettingWebsiteInfo.findOne({}).lean();
    const hotelSearchBreadcrumbImage = setting?.hotelSearchBreadcrumbImage || "";
    
    const breadcrumb = [
      { name: "Khách sạn", slug: "/hotel/search", avatar: hotelSearchBreadcrumbImage },
    ];

    // Không set default dates - để người dùng tự chọn
    const effectiveCheckIn = checkInDate || null;
    const effectiveCheckOut = checkOutDate || null;
    
    // Parse roomsData nếu có, nếu không thì dùng dữ liệu cũ
    let parsedRoomsData = null;
    if (roomsData) {
      try {
        parsedRoomsData = normalizeRoomsData(
          JSON.parse(decodeURIComponent(roomsData))
        );
      } catch (e) {
        console.warn("Failed to parse roomsData:", e);
      }
    }
    
    // Tính toán từ roomsData hoặc dùng giá trị cũ
    let numRooms = Number(rooms) || 1;
    let numAdults = Number(adults) || 1;
    let numChildren = Number(children) || 0;
    let numBabies = Number(req.query.babies) || 0;
    
    if (parsedRoomsData && parsedRoomsData.length > 0) {
      const counts = countGuests(parsedRoomsData);
      numRooms = counts.rooms;
      numAdults = counts.adults;
      numChildren = counts.children;
      numBabies = counts.babies;
    }

    const hasSearched = !!(
      location ||
      provinceId ||
      address ||
      checkInDate ||
      checkOutDate ||
      adults ||
      children ||
      rooms
    );

    const filter = { deleted: false, status: "active" };
    
    // Tìm kiếm theo tỉnh thành và địa chỉ
    if (provinceId) {
      // Tìm theo tỉnh thành (province là ObjectId reference đến City)
      filter.province = provinceId;
    }
    
    if (address) {
      // Tìm theo địa chỉ (tìm kiếm không phân biệt hoa thường)
      filter.address = { $regex: address, $options: "i" };
    }
    
    // Nếu có location (từ input text), tìm theo tên tỉnh thành, tên khách sạn hoặc địa chỉ
    if (location && !provinceId && !address) {
      // Tìm theo tên tỉnh thành trước
      const provinceMatch = await City.findOne({
        name: { $regex: location, $options: "i" },
        deleted: false
      }).lean();
      
      // Tạo mảng điều kiện tìm kiếm: tìm theo tên khách sạn HOẶC địa chỉ
      const orConditions = [
        { name: { $regex: location, $options: "i" } }, // Tìm theo tên khách sạn
        { address: { $regex: location, $options: "i" } } // Tìm theo địa chỉ
      ];
      
      if (provinceMatch) {
        // Nếu tìm thấy tỉnh thành, thêm điều kiện tìm theo tỉnh thành vào $or
        // Điều này cho phép tìm: tên khách sạn chứa location HOẶC địa chỉ chứa location HOẶC thuộc tỉnh thành
        orConditions.push({ province: provinceMatch._id });
      }
      
      // Sử dụng $or để tìm trong nhiều field
      filter.$or = orConditions;
    }

    const hotels = await Hotel.find(filter)
      .populate('companyId', 'name logo')
      .populate('province', 'name')
      .sort({ isFeatured: -1, starRating: -1, basePrice: 1 })
      .limit(50) // Tăng limit để sau khi lọc còn đủ kết quả
      .lean();

    // Lấy tất cả bookings để kiểm tra availability (chỉ khi có dates)
    let checkInMoment = null;
    let checkOutMoment = null;
    let shouldCheckAvailability = false;
    
    if (effectiveCheckIn && effectiveCheckOut) {
      checkInMoment = moment(effectiveCheckIn);
      checkOutMoment = moment(effectiveCheckOut);
      shouldCheckAvailability = checkInMoment.isValid() && checkOutMoment.isValid();
    }

    let bookingsByHotel = {};
    if (shouldCheckAvailability) {
      const hotelIds = hotels.map(h => h._id);
      const allBookings = await HotelBooking.find({
        'hotel.hotelId': { $in: hotelIds },
        deleted: { $ne: true }, // Sửa từ deleted: false thành deleted: { $ne: true }
        status: { $nin: ['cancelled', 'checked_out'] }, // Loại bỏ đã hủy và đã trả phòng
        // Lấy bookings có khả năng overlap
        $or: [
          { checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }
        ]
      }).lean();

      // Group bookings by hotel
      allBookings.forEach(booking => {
        const hId = String(booking.hotel?.hotelId);
        if (!bookingsByHotel[hId]) {
          bookingsByHotel[hId] = [];
        }
        bookingsByHotel[hId].push(booking);
      });
    }

    // Lọc và tạo danh sách khách sạn với thông tin đầy đủ
    const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
    const hotelList = [];
    
    for (const h of hotels) {
      // Kiểm tra availability nếu cần (chỉ khi có dates và roomsData)
      if (shouldCheckAvailability && parsedRoomsData) {
        const hotelBookings = bookingsByHotel[String(h._id)] || [];
        const availabilityResult = checkHotelAvailability(
          h, 
          hotelBookings, 
          checkInMoment.toDate(), 
          checkOutMoment.toDate(), 
          parsedRoomsData, 
          numRooms
        );

        // Bỏ qua khách sạn không có phòng phù hợp
        if (!availabilityResult.hasAvailability) {
          continue;
        }
      }

      const thumb =
        h.avatar ||
        (Array.isArray(h.images) && h.images[0]) ||
        "/images/no-image.jpg";
      const price = Number(h.basePrice || 0);
      const ratingOverall = h.ratingOverall || null;
      
      // Lấy amenities (có thể là string hoặc object)
      let tags = [];
      if (Array.isArray(h.amenities) && h.amenities.length > 0) {
        tags = h.amenities.slice(0, 4).map(a => (typeof a === 'string' ? a : (a.name || ''))).filter(a => a);
      }
      
      // Đếm số loại phòng
      const roomTypesCount = Array.isArray(h.roomTypes) ? h.roomTypes.length : 0;
      
      // Đếm tổng số phòng
      const totalRooms = Array.isArray(h.rooms) ? h.rooms.length : 0;
      
      // Calculate vacant rooms - Tính theo từng loại phòng rồi cộng lại (giống company hotels)
      let vacantRooms = 0;
      if (Array.isArray(h.rooms) && Array.isArray(h.roomTypes)) {
        if (shouldCheckAvailability) {
          // Lấy bookings của hotel này
          const hotelBookings = bookingsByHotel[String(h._id)] || [];
          
          // Tính số phòng trống cho mỗi loại phòng
          h.roomTypes.forEach(roomType => {
            const availableRooms = getAvailableRoomsForType(
              h.rooms,
              roomType._id,
              hotelBookings,
              checkInMoment.toDate(),
              checkOutMoment.toDate()
            );
            vacantRooms += availableRooms.length;
          });
        } else {
          // Không có dates: đếm phòng có status = vacant
          vacantRooms = h.rooms.filter(r => r && r.status === 'vacant').length;
        }
      }

      // Lấy thông tin công ty
      const company = h.companyId || {};
      const companyName = company.name || '';
      const companyLogo = company.logo || '';

      hotelList.push({
        id: h._id ? (typeof h._id === 'object' && h._id.toString ? h._id.toString() : String(h._id)) : '',
        name: h.name || '',
        cityName: h.cityName || '',
        address: h.address || '',
        starRating: h.starRating || 0,
        rating: ratingOverall,
        thumbnail: thumb,
        pricePerNight: price,
        currency: h.currency || "VND",
        tags,
        roomTypesCount,
        totalRooms,
        vacantRooms,
        shortDescription: h.shortDescription || '',
        companyName,
        companyLogo,
        checkInDate: effectiveCheckIn || "",
        checkOutDate: effectiveCheckOut || "",
        adults: numAdults,
        children: numChildren,
        rooms: numRooms,
        roomsData: roomsData || "",
      });
      
      // Giới hạn kết quả trả về
      if (hotelList.length >= 30) break;
    }

    // Lấy danh sách tỉnh thành để hiển thị trong dropdown (nếu chưa có trong res.locals)
    const provinceList = res.locals.cityList || await City.find({ deleted: false })
      .sort({ name: 1 })
      .select("_id name")
      .lean();

    return res.render("client/pages/hotel-search", {
      pageTitle: "Tìm phòng khách sạn",
      breadcrumb,
      hotelList, // Danh sách khách sạn
      hasSearched,
      query: {
        location: location || "",
        provinceId: provinceId || "",
        address: address || "",
        checkInDate: effectiveCheckIn || "",
        checkOutDate: effectiveCheckOut || "",
        adults: numAdults,
        children: numChildren,
        babies: numBabies,
        rooms: numRooms,
        roomsData: roomsData || "",
      },
      provinceList: provinceList.map(c => ({ id: c._id, name: c.name })),
      errorMessage:
        hasSearched && !hotelList.length
          ? "Không tìm thấy khách sạn phù hợp trong hệ thống."
          : "",
    });
  } catch (err) {
    console.error("hotel.search DB error:", err);
    const breadcrumb = [
      { name: "Khách sạn", slug: "/hotel/search", avatar: "" },
    ];
    // Lấy danh sách tỉnh thành để hiển thị trong dropdown (nếu chưa có trong res.locals)
    const provinceList = res.locals.cityList || await City.find({ deleted: false })
      .sort({ name: 1 })
      .select("_id name")
      .lean();

    return res.render("client/pages/hotel-search", {
      pageTitle: "Tìm phòng khách sạn",
      breadcrumb,
      hotelList: [],
      hasSearched: true,
      query: req.query,
      provinceList: provinceList.map(c => ({ id: c._id, name: c.name })),
      errorMessage:
        "Lỗi hệ thống khi đọc dữ liệu khách sạn, vui lòng thử lại sau.",
    });
  }
};

/* ========================================================================
 * DETAIL: GET /hotel/detail/:id
 * Trang chi tiết khách sạn, dùng dữ liệu admin đã nhập
 * ======================================================================*/
module.exports.detail = async (req, res) => {
  try {
    const { id } = req.params;
    const q = req.query || {};

    const hotel = await Hotel.findOne({ _id: id, deleted: false }).populate('province', 'name').lean();
    if (!hotel) {
      return res.status(404).send("Không tìm thấy khách sạn.");
    }

    // ---- Thông tin tìm kiếm để hiển thị thanh top bar ----
    // Không set default dates - để người dùng tự chọn
    const checkInDate = q.checkInDate || null;
    const checkOutDate = q.checkOutDate || null;
    const rooms = Number(q.rooms) || 1;
    const adults = Number(q.adults) || 1;
    const children = Number(q.children) || 0;
    const babies = Number(q.babies) || 0;
    const roomsData = q.roomsData || "";

    // Parse & chuẩn hoá roomsData
    let parsedRoomsData = null;
    let allocationRooms = [];
    if (roomsData) {
      try {
        parsedRoomsData = normalizeRoomsData(
          JSON.parse(decodeURIComponent(roomsData))
        );
        allocationRooms = buildAllocationRoomsDisplay(parsedRoomsData);
      } catch (e) {
        console.warn("Failed to parse roomsData in detail:", e);
      }
    }

    const guestCounts = parsedRoomsData
      ? countGuests(parsedRoomsData)
      : { rooms, adults, children, babies };

    // Chỉ tạo searchInfo nếu có dates
    let searchInfo = null;
    if (checkInDate && checkOutDate) {
      searchInfo = {
        checkInDate,
        checkOutDate,
        rooms: guestCounts.rooms,
        adults: guestCounts.adults,
        children: guestCounts.children,
        babies: guestCounts.babies,
        roomsData,
        checkInLabel: moment(checkInDate, "YYYY-MM-DD").format("DD-MM-YYYY"),
        checkOutLabel: moment(checkOutDate, "YYYY-MM-DD").format("DD-MM-YYYY"),
      };
    }

    // ---- Ảnh ----
    const allImages =
      (Array.isArray(hotel.images) && hotel.images.length && hotel.images) ||
      (hotel.avatar ? [hotel.avatar] : []);
    const mainImage =
      hotel.avatar ||
      (Array.isArray(hotel.images) && hotel.images[0]) ||
      "/images/no-image.jpg";
    const galleryImages = allImages.slice(0, 4);

    // ---- Điểm đánh giá (chỉ hiển thị, không cho admin sửa) ----
    const ratingStats = {
      overall: hotel.ratingOverall || null,
      count: hotel.ratingCount || 0,
      location: hotel.ratingLocation || null,
      cleanliness: hotel.ratingCleanliness || null,
      facilities: hotel.ratingFacilities || null,
      service: hotel.ratingService || null,
      valueForMoney: hotel.ratingValueForMoney || null,
    };

    // ---- Room options: map từ roomTypes ----
    const roomTypes = Array.isArray(hotel.roomTypes) ? hotel.roomTypes : [];
    const individualRooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
    
    // Chỉ check availability nếu có dates
    let checkInMoment = null;
    let checkOutMoment = null;
    let hotelBookings = [];
    let availableRoomsByType = {};
    
    if (checkInDate && checkOutDate) {
      checkInMoment = moment(checkInDate);
      checkOutMoment = moment(checkOutDate);
      
      if (checkInMoment.isValid() && checkOutMoment.isValid()) {
        // Lấy bookings của hotel trong khoảng thời gian
        // hotelBookings = danh sách các đơn đặt phòng (HotelBooking) đang có hiệu lực và trùng khoảng ngày với ngày khách chọn — tức là những đơn đang chiếm / có thể chiếm phòng.
        // Phòng còn trống được tính sau đó: lấy toàn bộ phòng vật lý của khách sạn (hotel.rooms, status vacant…), rồi trừ đi những gì suy ra từ hotelBookings trong hàm getAvailableRoomsForType (trong helpers/hotel-availability.helper.js).
        hotelBookings = await HotelBooking.find({
          'hotel.hotelId': id,
          status: { $nin: ['cancelled', 'checked_out'] }, // Loại bỏ đã hủy và đã trả phòng
          // Lấy bookings có khả năng overlap
          $or: [
            { checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }
          ]
        }).lean();
        
        // Tính số phòng trống cho mỗi loại phòng dựa trên bookings
        const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
        
        roomTypes.forEach(roomType => {
          const availableRooms = getAvailableRoomsForType(
            individualRooms,
            roomType._id,
            hotelBookings,
            checkInMoment.toDate(),
            checkOutMoment.toDate()
          );
          availableRoomsByType[String(roomType._id)] = availableRooms.length;
        });
      }
    }
    
    const { calculateEffectiveOccupancy } = require("../../helpers/hotel-availability.helper");
    
    const roomOptions = roomTypes
      .map((room) => {
        const price = Number(room.basePrice || hotel.basePrice || 0);
        const roomTypeId = room._id ? room._id.toString() : null;
        // Nếu không có dates, hiển thị tất cả phòng (không filter theo availability)
        const availableCount = (checkInMoment && checkOutMoment && roomTypeId) 
          ? (availableRoomsByType[roomTypeId] || 0) 
          : (Array.isArray(individualRooms) ? individualRooms.filter(r => String(r.roomTypeId) === String(roomTypeId)).length : 0);
        
        // Kiểm tra sức chứa nếu có parsedRoomsData
        let canFitAtLeastOneRoom = false;
        if (parsedRoomsData && Array.isArray(parsedRoomsData) && parsedRoomsData.length > 0) {
          // Lấy age bands (ưu tiên room type, fallback về hotel)
          const ageBands = (room.ageBands && room.ageBands.length > 0) 
            ? room.ageBands 
            : (hotel.ageBands || []);
          
          const maxOccupancy = room.maxOccupancy || 2;
          
          // Kiểm tra xem CÓ ÍT NHẤT MỘT phòng fit vào loại phòng này không
          // (Thay vì yêu cầu TẤT CẢ các phòng đều phải fit, vì khách có thể chọn loại phòng khác cho các phòng khác)
          for (const singleRoom of parsedRoomsData) {
            const singleRoomEffectiveOccupancy = calculateEffectiveOccupancy([singleRoom], ageBands);
            
            // Nếu có ít nhất 1 phòng fit vào, đánh dấu phù hợp
            if (singleRoomEffectiveOccupancy <= maxOccupancy) {
              canFitAtLeastOneRoom = true;
              break;
            }
          }
        } else {
          // Nếu không có parsedRoomsData, mặc định là phù hợp
          canFitAtLeastOneRoom = true;
        }
        
        // Chỉ filter theo availability nếu có dates và roomsData
        if (checkInMoment && checkOutMoment && parsedRoomsData) {
          // Bỏ qua loại phòng không có phòng trống HOẶC không có phòng nào phù hợp sức chứa
          // Chỉ cần có ít nhất 1 phòng trống (không cần >= số phòng cần đặt)
          // vì khách có thể phân bổ các phòng khác nhau cho các loại phòng khác nhau
          if (availableCount < 1 || !canFitAtLeastOneRoom) {
            return null;
          }
        }
      
      // Lấy danh sách ảnh từ room.images, nếu không có thì dùng ảnh mặc định
      const roomImages = Array.isArray(room.images) && room.images.length > 0 
        ? room.images 
        : [hotel.avatar || (Array.isArray(hotel.images) && hotel.images[0]) || "/images/no-image.jpg"];
      
      // Ảnh đầu tiên để dùng cho bookUrl
      const firstImage = roomImages[0];

      // Chỉ thêm dates vào URL nếu có
      const bookUrlParams = [
        `hotelId=${encodeURIComponent(hotel._id)}`,
        `roomTypeId=${encodeURIComponent(room._id)}`,
      ];
      if (checkInDate) bookUrlParams.push(`checkInDate=${encodeURIComponent(checkInDate)}`);
      if (checkOutDate) bookUrlParams.push(`checkOutDate=${encodeURIComponent(checkOutDate)}`);
      if (rooms) bookUrlParams.push(`rooms=${rooms}`);
      if (adults) bookUrlParams.push(`adults=${adults}`);
      if (children) bookUrlParams.push(`children=${children}`);
      if (roomsData) bookUrlParams.push(`roomsData=${encodeURIComponent(roomsData)}`);
      
      const bookUrl = "/hotel/room-select?" + bookUrlParams.join("&");

      // Lấy thông tin chi tiết từ room type
      const roomDetails = {
        sizeM2: room.sizeM2 || null,
        bedInfo: room.bedInfo || "",
        view: room.view || "",
        smokingPolicy: room.smokingPolicy || "",
      };

      return {
        title: room.name,
        roomTypeId: room._id, // Thêm roomTypeId cho add-to-cart
        maxGuests: room.maxOccupancy || room.maxGuests || 2, // Ưu tiên maxOccupancy từ khối Occupancy
        description: room.description || "",
        pricePerNight: price,
        currency: hotel.currency || "đ",
        images: roomImages,
        firstImage: firstImage,
        roomDetails: roomDetails,
        vacantRooms: (checkInMoment && checkOutMoment) ? availableCount : null, // Chỉ hiển thị số phòng trống nếu có dates
        bookUrl,
        // Thêm các trường chi tiết cho modal
        baseOccupancy: room.baseOccupancy || 2,
        maxOccupancy: room.maxOccupancy || 3,
        maxExtraBeds: room.maxExtraBeds || 0,
        extraBedFeePerNight: room.extraBedFeePerNight || 0,
        bathroomAmenities: Array.isArray(room.bathroomAmenities) ? room.bathroomAmenities : [],
        roomAmenities: Array.isArray(room.roomAmenities) ? room.roomAmenities : [],
        // Thêm ageBands để client-side validation
        ageBands: (room.ageBands && room.ageBands.length > 0) 
          ? room.ageBands 
          : (hotel.ageBands || []),
      };
    }).filter(Boolean); // Loại bỏ các phần tử null

    // Lấy reviews của hotel
    const reviews = await HotelReview.find({
      hotelId: id,
      deleted: false,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Kiểm tra xem user đã đăng nhập chưa và đã review chưa
    let userReview = null;
    if (req.account && req.account.id) {
      userReview = await HotelReview.findOne({
        hotelId: id,
        userId: req.account.id,
        deleted: false,
      }).lean();
    }

    // Convert Google Maps share link to embed URL if needed
    let googleMapsEmbedUrl = hotel.googleMapsLink || "";
    if (googleMapsEmbedUrl && !googleMapsEmbedUrl.includes('/embed') && !googleMapsEmbedUrl.includes('embed?')) {
      // Try to extract place ID, coordinates, or address from share link
      const placeIdMatch = googleMapsEmbedUrl.match(/place\/([^\/\?&]+)/);
      const coordsMatch = googleMapsEmbedUrl.match(/@([-\d.]+),([-\d.]+)/);
      
      let searchQuery = "";
      
      if (placeIdMatch) {
        // Extract place ID
        const placeId = placeIdMatch[1];
        searchQuery = `place_id:${placeId}`;
      } else if (coordsMatch) {
        // Extract coordinates
        const lat = coordsMatch[1];
        const lng = coordsMatch[2];
        searchQuery = `${lat},${lng}`;
      } else {
        // Try to extract from URL params or use hotel address
        try {
          const url = new URL(googleMapsEmbedUrl);
          const q = url.searchParams.get('q');
          searchQuery = q || (hotel.address ? (hotel.address + (hotel.cityName ? ', ' + hotel.cityName : '')) : '');
        } catch (e) {
          // If can't parse URL, use hotel address
          searchQuery = hotel.address ? (hotel.address + (hotel.cityName ? ', ' + hotel.cityName : '')) : '';
        }
      }
      
      // Convert to embed URL using simple format (no API key needed)
      if (searchQuery) {
        // Sử dụng format embed đơn giản với query parameter
        // Format này sẽ tự động tìm kiếm địa chỉ/coordinates trên Google Maps
        googleMapsEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(searchQuery)}&output=embed`;
      } else {
        googleMapsEmbedUrl = "";
      }
    }

    const breadcrumb = [
      { name: "Khách sạn", slug: "/hotel/search" },
      { 
        name: `Đặt phòng ${hotel.name}`, 
        slug: "",
        avatar: hotel.avatar || (Array.isArray(hotel.images) && hotel.images[0]) || ""
      },
    ];

    return res.render("client/pages/hotel-detail", {
      pageTitle: hotel.name,
      breadcrumb,
      hotel,
      mainImage,
      galleryImages,
      searchInfo,
      allocationRooms,
      ratingStats,
      highlights: hotel.highlights || [],
      promotionShortText: hotel.promotionShortText || "",
      transportOptions: hotel.transportOptions || [],
      amenities: hotel.amenities || [],
      facilities: hotel.facilities || [],
      childrenPolicy: hotel.childrenPolicy || {}, // Giữ lại để tương thích ngược
      ageBands: hotel.ageBands || [], // Dữ liệu mới từ Age Bands
      usefulInfo: hotel.usefulInfo || {},
      rules: {
        checkinTimeFrom: hotel.checkinTimeFrom || "",
        checkoutTimeTo: hotel.checkoutTimeTo || "",
        earlyCheckinTime: hotel.earlyCheckinTime || "",
        earlyCheckinFee: hotel.earlyCheckinFee || 0,
        lateCheckoutTime: hotel.lateCheckoutTime || "",
        lateCheckoutFee: hotel.lateCheckoutFee || 0,
        numberOfRooms: hotel.numberOfRooms || "",
        children: hotel.rulesChildren || "",
        pets: hotel.rulesPets || "",
        extraBed: hotel.rulesExtraBed || "",
        other: hotel.rulesOther || "",
      },
      faqs: hotel.faqs || [],
      roomOptions,
      reviews: reviews || [],
      userReview: userReview || null,
      isLoggedIn: !!(req.account && req.account.id),
      currentUser: req.account || null,
      googleMapsEmbedUrl: googleMapsEmbedUrl || "",
      checkInDate,
      checkOutDate,
      rooms: guestCounts.rooms,
      adults: guestCounts.adults,
      children: guestCounts.children,
      babies: guestCounts.babies,
      roomsData,
    });
  } catch (err) {
    console.error("hotel.detail error:", err);
    return res.status(500).send("Không tải được chi tiết khách sạn.");
  }
};

/* ========================================================================
 * HELPER
 * ======================================================================*/
function toDateISO(d, fallbackDays = 0) {
  if (d) return new Date(d);
  return moment().add(fallbackDays, "days").toDate();
}

/* ========================================================================
 * ROOM SELECT – vẫn dùng query string như cũ
 * ======================================================================*/
/* ========================================================================
 * ROOM SELECT: GET /hotel/room-select
 * Trang chọn phòng - hiển thị thông tin chi tiết phòng đã chọn và dịch vụ thêm
 * ======================================================================*/
module.exports.roomSelect = async (req, res) => {
  try {
    const q = req.query || {};

    const hotelId = q.hotelId;
    const roomTypeId = q.roomTypeId;
    
    if (!hotelId || !roomTypeId) {
      return res.status(400).send("Thiếu thông tin khách sạn hoặc loại phòng.");
    }

    // Lấy thông tin hotel và room type
    const hotel = await Hotel.findOne({ _id: hotelId, deleted: false })
      .populate('province', 'name')
      .lean();
      
    if (!hotel) {
      return res.status(404).send("Không tìm thấy khách sạn.");
    }

    // Tìm room type
    const roomType = hotel.roomTypes?.find(rt => String(rt._id) === String(roomTypeId));
    if (!roomType) {
      return res.status(404).send("Không tìm thấy loại phòng.");
    }

    // Parse thông tin tìm kiếm
    const checkInDate = q.checkInDate || moment().add(7, "days").format("YYYY-MM-DD");
    const checkOutDate = q.checkOutDate || moment().add(8, "days").format("YYYY-MM-DD");
    const rooms = Number(q.rooms) || 1;
    const adults = Number(q.adults) || 1;
    const children = Number(q.children) || 0;
    const roomsData = q.roomsData || "";

    // Tính số đêm
    const checkInMoment = moment(checkInDate);
    const checkOutMoment = moment(checkOutDate);
    const nights = Math.max(1, checkOutMoment.diff(checkInMoment, 'days'));

    // Tính giá
    const pricePerNight = Number(roomType.basePrice || hotel.basePrice || 0);
    const roomSubtotal = pricePerNight * nights * rooms;
    
    // Thuế và phí dịch vụ
    const taxPercent = 10; // 10% VAT
    const feePercent = 5; // 5% phí dịch vụ
    const tax = Math.round(roomSubtotal * taxPercent / 100);
    const fee = Math.round(roomSubtotal * feePercent / 100);

    // Dịch vụ thêm (từ hotel)
    const additionalServices = [];
    
    // Giường phụ
    if (roomType.maxExtraBeds && roomType.maxExtraBeds > 0) {
      additionalServices.push({
        id: 'extra_bed',
        name: 'Giường phụ',
        price: roomType.extraBedFeePerNight || 0,
        unit: 'đêm',
        maxQuantity: roomType.maxExtraBeds,
        description: `Tối đa ${roomType.maxExtraBeds} giường phụ`
      });
    }

    // Nhận phòng sớm
    if (hotel.earlyCheckinTime && hotel.earlyCheckinFee) {
      additionalServices.push({
        id: 'early_checkin',
        name: `Nhận phòng sớm (từ ${hotel.earlyCheckinTime})`,
        price: hotel.earlyCheckinFee,
        unit: 'lần',
        maxQuantity: 1,
        isCheckbox: true
      });
    }

    // Trả phòng muộn
    if (hotel.lateCheckoutTime && hotel.lateCheckoutFee) {
      additionalServices.push({
        id: 'late_checkout',
        name: `Trả phòng muộn (đến ${hotel.lateCheckoutTime})`,
        price: hotel.lateCheckoutFee,
        unit: 'lần',
        maxQuantity: 1,
        isCheckbox: true
      });
    }

    // Đưa đón sân bay (nếu có cấu hình)
    if (hotel.airportTransferFee && hotel.airportTransferFee > 0) {
      additionalServices.push({
        id: 'airport_transfer',
        name: 'Đưa đón sân bay (1 chiều)',
        price: hotel.airportTransferFee,
        unit: 'lần',
        maxQuantity: 2,
        isCheckbox: true
      });
    }

    // Quy định của chỗ nghỉ
    const policies = {
      checkInTime: hotel.checkInTime || '14:00',
      checkOutTime: hotel.checkOutTime || '12:00',
      cancellationPolicy: hotel.cancellationPolicy || 'Hủy miễn phí trước 24 giờ trước check-in. Sau đó thu phí 50% giá trị booking.',
      paymentRequirement: hotel.paymentRequirement || 'Vui lòng xuất trình CMND/CCCD khi check-in',
      childrenPolicy: hotel.childrenPolicy || '',
      smokingPolicy: roomType.smokingPolicy || 'Không hút thuốc',
    };

    // Age bands cho chính sách trẻ em
    // Age Bands chỉ lấy từ hotel level (không còn override ở room type level)
    const ageBands = hotel.ageBands || [];

    // Ảnh phòng
    const roomImages = Array.isArray(roomType.images) && roomType.images.length > 0 
      ? roomType.images 
      : [hotel.avatar || (Array.isArray(hotel.images) && hotel.images[0]) || "/images/no-image.jpg"];

    // Tính số phòng trống thực tế (giống như ở trang detail)
    const individualRooms = Array.isArray(hotel.rooms) ? hotel.rooms : [];
    const { getAvailableRoomsForType } = require("../../helpers/hotel-availability.helper");
    
    const hotelBookings = await HotelBooking.find({
      'hotel.hotelId': hotelId,
      status: { $nin: ['cancelled', 'checked_out'] }, // Loại bỏ đã hủy và đã trả phòng
      // Lấy bookings có khả năng overlap
      $or: [
        { checkIn: { $lt: checkOutMoment.toDate() }, checkOut: { $gt: checkInMoment.toDate() } }
      ]
    }).lean();
    
    const availableRooms = getAvailableRoomsForType(
      individualRooms,
      roomTypeId,
      hotelBookings,
      checkInMoment.toDate(),
      checkOutMoment.toDate()
    );
    const availableCount = availableRooms.length;

    const booking = {
      hotel: {
        id: hotel._id,
        name: hotel.name,
        address: hotel.address,
        province: hotel.province?.name || hotel.cityName || '',
        starRating: hotel.starRating,
        phone: hotel.phone,
      },
      roomType: {
        id: roomType._id,
        name: roomType.name,
        description: roomType.description,
        sizeM2: roomType.sizeM2,
        bedInfo: roomType.bedInfo,
        view: roomType.view,
        smokingPolicy: roomType.smokingPolicy,
        maxOccupancy: roomType.maxOccupancy,
        images: roomImages,
      },
      checkInDate,
      checkOutDate,
      checkInLabel: checkInMoment.format("DD-MM-YYYY"),
      checkOutLabel: checkOutMoment.format("DD-MM-YYYY"),
      nights,
      rooms,
      adults,
      children,
      roomsData,
      pricePerNight,
      roomSubtotal,
      tax,
      taxPercent,
      fee,
      feePercent,
      currency: hotel.currency || "VND",
      additionalServices,
      policies,
      ageBands,
      availableCount, // Số phòng trống thực tế
    };

    const breadcrumb = [
      { name: "Khách sạn", slug: "/hotel/search", avatar: "" },
      { name: "Chi tiết đặt phòng", slug: "" },
    ];

    return res.render("client/pages/room-select-new", {
      pageTitle: `Đặt phòng - ${hotel.name}`,
      breadcrumb,
      booking,
    });
  } catch (err) {
    console.error("roomSelect error:", err);
    return res.status(500).send("Không tải được trang chọn phòng.");
  }
};

// helper tính số đêm
function diffNights(ci, co) {
  const a = moment(ci, "YYYY-MM-DD");
  const b = moment(co, "YYYY-MM-DD");
  return Math.max(1, b.diff(a, "days"));
}

/* ========================================================================
 * BOOKING GET – giữ nguyên logic cũ
 * ======================================================================*/
module.exports.bookingGet = async (req, res) => {
  try {
    const q = req.query || {};

    const hotelName = (q.hotelName || "Khách sạn").toString();
    const address = (q.address || "").toString();
    const checkInDate = (
      q.checkInDate || moment().add(7, "d").format("YYYY-MM-DD")
    ).toString();
    const checkOutDate = (
      q.checkOutDate || moment().add(8, "d").format("YYYY-MM-DD")
    ).toString();
    const rooms = Number(q.rooms ?? 1) || 1;
    const adults = Number(q.adults ?? 1) || 1;
    const children = Number(q.children ?? 0) || 0;
    const roomTitle = (q.roomTitle || "Phòng Superior").toString();
    const image = (q.image || "/images/no-image.jpg").toString();
    const pricePerNight = Number(q.pricePerNight ?? 0) || 0;
    const currency = (q.currency || "đ").toString();

    const nights = diffNights(checkInDate, checkOutDate);
    const subtotal = pricePerNight * nights * rooms;
    const tax = Math.round(subtotal * 0.1); // 10%
    const fee = Math.round(subtotal * 0.03); // 3%
    const total = subtotal + tax + fee;

    const booking = {
      hotel: { name: hotelName, address },
      checkInDate,
      checkOutDate,
      nights,
      rooms,
      adults,
      children,
      room: { title: roomTitle, image, sizeM2: q.sizeM2, view: q.view },
      pricePerNight,
      currency,
      subtotal,
      tax,
      fee,
      total,
    };

    const breadcrumb = [
      { name: "Khách sạn", slug: "/hotel/search" },
      { name: "Nhập thông tin", slug: "" },
    ];

    return res.render("client/pages/hotel-booking", {
      pageTitle: "Nhập thông tin",
      breadcrumb,
      booking,
    });
  } catch (err) {
    console.error("bookingGet error:", err);
    return res.status(500).send("Không tải được trang nhập thông tin.");
  }
};
