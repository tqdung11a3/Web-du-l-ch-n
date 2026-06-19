// controllers/admin/hotel.controller.js

const Hotel = require("../../models/hotel.model");
const AccountAdmin = require("../../models/account-admin.model");
const City = require("../../models/city.model");
const HotelReview = require("../../models/hotel-review.model");
const HotelBooking = require("../../models/hotel-booking.model");
const moment = require("moment");
const { pathAdmin } = require("../../config/variable.config");
const auditLogHelper = require("../../helpers/audit-log.helper");
const {
  notifyCustomerOrderUpdate,
  diffChanges,
  buildHotelBookingProfileLink,
  buildTourOrderProfileLink,
} = require("../../helpers/customer-order-notify.helper");
const {
  passengerNeedsGuardian,
  isAnchorAdult,
} = require("../../helpers/passenger-atom.helper");
const {
  getTourDisplayId,
  getTourDisplayIdHash,
  queryMatchesTourIdSearch,
} = require("../../helpers/tour-display-id.helper");
const {
  buildAdminRoomsDetailsDisplay,
} = require("../../helpers/hotel-guest-rooms.helper");

/**
 * Lọc bỏ các HotelBooking thuộc về Order đã bị xoá (deleted: true) hoặc
 * không còn tồn tại. Dùng cho mọi trang quản trị booking để tránh hiển thị
 * dữ liệu "rác" còn sót lại từ trước khi flow xoá đơn được bổ sung bước
 * cleanup HotelBooking.
 *
 * Booking không có orderCode (đặt phòng trực tiếp, không qua tour) sẽ
 * được giữ lại bình thường.
 */
async function _filterBookingsByLiveOrder(bookings) {
  if (!Array.isArray(bookings) || bookings.length === 0) return bookings;
  const orderCodes = [...new Set(
    bookings.map((b) => b && b.orderCode).filter(Boolean)
  )];
  if (orderCodes.length === 0) return bookings;
  const Order = require("../../models/order.model");
  const validOrders = await Order.find({
    code: { $in: orderCodes },
    deleted: { $ne: true },
  })
    .select("code")
    .lean();
  const validCodeSet = new Set(validOrders.map((o) => o.code));
  return bookings.filter(
    (b) => !b.orderCode || validCodeSet.has(b.orderCode)
  );
}

/**
 * Self-heal cho các HotelBooking còn dính tour đã bị xoá mềm từ TRƯỚC khi
 * cascade release (deletePatch của tour.controller) được thêm vào hệ thống.
 *
 * Tìm các segment thuộc Tour có `deleted: true`, rồi cascade-cancel các
 * HotelBooking tương ứng (lưu `statusBeforeTourDelete`, đặt `tourDeletedAt`)
 * y hệt cách deletePatch hiện làm — để undoPatch sau này vẫn khôi phục được.
 *
 * Idempotent: chỉ chạm vào booking có `tourDeletedAt = null` và
 * `status != 'cancelled'`, nên các lần gọi sau không tốn ghi.
 *
 * Được gọi ở đầu các trang chịu ảnh hưởng (calendar, room-management,
 * tour-holds…) để admin chỉ cần refresh là dữ liệu tự đúng.
 */
async function _autoReleaseStaleDeletedTourHolds(_companyId) {
  try {
    const Tour = require("../../models/tour.model");
    const TourSegment = require("../../models/tour-segment.model");
    // Quét TOÀN BỘ tour đã xoá mềm trên hệ thống (bỏ filter companyId): tour
    // ở ghép cross-company vẫn có thể giữ phòng ở khách sạn của công ty khác,
    // nên nếu chỉ lọc theo companyId của admin hiện tại thì sót. Việc cascade
    // chỉ động đến HotelBooking có tourSegmentId thuộc các tour đã `deleted:
    // true` — mà chỉ owner mới xoá được tour qua deletePatch — nên thao tác
    // này không gây tác dụng phụ ngoài ý muốn.
    const deletedTours = await Tour.find({ deleted: true })
      .select("_id")
      .lean();
    if (deletedTours.length === 0) return;
    const tourIds = deletedTours.map((t) => t._id);
    const segments = await TourSegment.find({ tourId: { $in: tourIds } })
      .select("_id")
      .lean();
    if (segments.length === 0) return;
    const segmentIds = segments.map((s) => s._id);
    await HotelBooking.updateMany(
      {
        tourSegmentId: { $in: segmentIds },
        status: { $ne: "cancelled" },
        tourDeletedAt: null,
      },
      [
        {
          $set: {
            statusBeforeTourDelete: "$status",
            status: "cancelled",
            tourDeletedAt: new Date(),
          },
        },
      ]
    );
  } catch (err) {
    console.error("[_autoReleaseStaleDeletedTourHolds] error:", err);
  }
}

/**
 * Resolve hành khách của TỪNG phòng vật lý cho danh sách HotelBooking
 * tour-hold (private + shared). Trả về 2 map theo bookingId (string của _id).
 *
 * Logic:
 * - Group bookings cùng "bucket" (orderCode + hotelId + roomTypeId + ci/co),
 *   sort theo _id ổn định → cùng thứ tự client lúc tạo roomAssignments.
 * - Private: tra `Order.items[].roomSelections[].roomAssignments[]`,
 *   match bucket → roomAssignments[i].passengerIdxs → resolve passengers.
 * - Shared: tra `Order.items[].sharedRoomRequest[].hotelAllocations[].roomAssignments[]`,
 *   parse `atomLabels` → tra ngược `passengers` theo tên để lấy age/gender.
 *
 * @param {Array<Object>} bookings - các HotelBooking (lean) đã có hotel/roomTypeId/orderCode
 * @returns {Promise<{ paxMap: Object, modeMap: Object }>}
 *   paxMap[bid] = [{ name, type, age, gender }, ...]
 *   modeMap[bid] = 'private' | 'shared'
 */

function _normalizePaxForGuardian(p) {
  return {
    ...p,
    age: Math.max(0, Math.floor(Number(p.age) || 0)),
    type: p.type === "child" || p.type === "baby" ? p.type : "adult",
  };
}

/** NL 18+ anchor + TE/EB/NL<18 có guardianIdx trỏ anchor trong phòng. */
function _passengersForRoomFromAnchorIdxs(passengers, anchorIdxs) {
  const list = (passengers || []).map(_normalizePaxForGuardian);
  const anchorSet = {};
  (anchorIdxs || []).forEach((idx) => {
    if (typeof idx === "number") anchorSet[idx] = true;
  });
  const adultIdxInRoom = {};
  list.forEach((p) => {
    if (p.type === "adult" && anchorSet[p.idx]) adultIdxInRoom[p.idx] = true;
  });
  return list.filter((p) => {
    if (p.type === "adult") {
      if (anchorSet[p.idx]) return true;
      if (passengerNeedsGuardian(p)) {
        return (
          p.guardianIdx !== null &&
          p.guardianIdx !== undefined &&
          !!adultIdxInRoom[p.guardianIdx]
        );
      }
      return false;
    }
    return (
      p.guardianIdx !== null &&
      p.guardianIdx !== undefined &&
      !!adultIdxInRoom[p.guardianIdx]
    );
  });
}

function _deriveAnchorIdxFromAtomLabel(label, passengers) {
  const m = String(label || "").match(/^(.+?)(?:\s+\(\+|$)/);
  const nm = m
    ? m[1].trim().toLowerCase()
    : String(label || "").trim().toLowerCase();
  if (!nm) return null;
  const list = (passengers || []).map(_normalizePaxForGuardian);
  const anchor = list.find(
    (p) =>
      p.type === "adult" &&
      String(p.name || "").trim().toLowerCase() === nm &&
      isAnchorAdult(p)
  );
  if (anchor) return anchor.idx;
  const anyAdult = list.find(
    (p) =>
      p.type === "adult" &&
      String(p.name || "").trim().toLowerCase() === nm
  );
  return anyAdult ? anyAdult.idx : null;
}

function _formatDependentForAtomLabel(k) {
  const typeShort = { child: "TE", baby: "EB" };
  if (k.type === "child" || k.type === "baby") {
    return `${typeShort[k.type] || k.type} ${k.name || ""}`;
  }
  const age = Math.max(0, Number(k.age) || 0);
  return `${k.name || ""} (${age}t)`;
}

async function _resolveBookingPassengers(bookings) {
  const paxMap = {};
  const modeMap = {};
  if (!Array.isArray(bookings) || bookings.length === 0)
    return { paxMap, modeMap };

  const Order = require("../../models/order.model");
  const TourSegment = require("../../models/tour-segment.model");
  const tourBookings = bookings.filter((b) => b.tourSegmentId && b.orderCode);
  if (tourBookings.length === 0) return { paxMap, modeMap };

  // ── Multi-occupant: 1 TH có thể được nhiều đơn share. Lấy tourSeg.assignments
  //   để biết TẤT CẢ orderId tham chiếu mỗi TH; ghép pax từ các đơn này.
  const tourSegmentIds = [
    ...new Set(tourBookings.map((b) => String(b.tourSegmentId)).filter(Boolean)),
  ];
  const segmentDocs = tourSegmentIds.length
    ? await TourSegment.find({ _id: { $in: tourSegmentIds } })
        .select("assignments")
        .lean()
    : [];
  const allOrderIdsSet = new Set();
  const assignsByThId = {}; // thId → [assignmentEntry]
  for (const seg of segmentDocs) {
    for (const a of seg.assignments || []) {
      if (!a.holdBookingId) continue;
      const thId = String(a.holdBookingId);
      if (!assignsByThId[thId]) assignsByThId[thId] = [];
      assignsByThId[thId].push(a);
      if (a.orderId) allOrderIdsSet.add(String(a.orderId));
    }
  }

  const uniqueOrderCodes = [
    ...new Set(tourBookings.map((b) => b.orderCode).filter(Boolean)),
  ];
  const allOrderIds = Array.from(allOrderIdsSet);
  const orderDocs = (uniqueOrderCodes.length || allOrderIds.length)
    ? await Order.find({
        $or: [
          ...(uniqueOrderCodes.length ? [{ code: { $in: uniqueOrderCodes } }] : []),
          ...(allOrderIds.length ? [{ _id: { $in: allOrderIds } }] : []),
        ],
      })
        .select("code accommodationMode items")
        .lean()
    : [];
  const orderByCode = {};
  const orderById = {};
  for (const o of orderDocs) {
    if (o.code) orderByCode[o.code] = o;
    orderById[String(o._id)] = o;
  }

  const bucketGroups = {};
  for (const b of tourBookings) {
    const ci = b.checkIn ? new Date(b.checkIn).toISOString().split("T")[0] : "";
    const co = b.checkOut ? new Date(b.checkOut).toISOString().split("T")[0] : "";
    const hId = b.hotel?.hotelId ? String(b.hotel.hotelId) : "";
    const rtId = b.roomTypeId ? String(b.roomTypeId) : "";
    const key = `${b.orderCode}|${hId}|${rtId}|${ci}|${co}`;
    if (!bucketGroups[key]) bucketGroups[key] = [];
    bucketGroups[key].push(b);
  }
  Object.keys(bucketGroups).forEach((key) => {
    bucketGroups[key].sort((a, b) =>
      String(a._id).localeCompare(String(b._id))
    );
  });

  // Helper: parse atom label "Tên (NL·Nam)" hoặc "Tên (TE)"
  const parseAtomLabel = (label) => {
    if (typeof label !== "string") return null;
    const m = label.match(/^(.+?)\s*\((NL|TE|EB)(?:·(Nam|Nữ|\?))?\)$/);
    if (!m) return { name: label, type: "adult", gender: null };
    const typeMap = { NL: "adult", TE: "child", EB: "baby" };
    const genderMap = { Nam: "male", "Nữ": "female" };
    return {
      name: m[1].trim(),
      type: typeMap[m[2]] || "adult",
      gender: m[3] ? genderMap[m[3]] || null : null,
    };
  };

  // Mở rộng parser cho format atom mới:
  //   "Adult Name (+ TE Kid1, EB Baby1)"
  // -> tách ra đầy đủ từng người để hiển thị tuổi/giới tính theo passengers.
  const expandSharedAtomLabel = (label, paxByName) => {
    if (typeof label !== "string" || !label.trim()) return [];
    const raw = String(label).trim();

    // Format cũ
    const parsedLegacy = parseAtomLabel(raw);
    if (
      parsedLegacy &&
      parsedLegacy.name &&
      parsedLegacy.name !== raw // parseAtomLabel fallback giữ nguyên raw
    ) {
      const full = paxByName[String(parsedLegacy.name).toLowerCase()];
      return [
        {
          name: parsedLegacy.name,
          type: parsedLegacy.type,
          gender: parsedLegacy.gender || (full ? full.gender : null),
          age: full ? full.age : undefined,
        },
      ];
    }

    // Format mới: "Adult (+ TE Kid, EB Baby)"
    const m = raw.match(/^(.+?)(?:\s+\(\+\s*(.+?)\))?$/);
    if (!m) return [{ name: raw, type: "adult", gender: null, age: undefined }];

    const out = [];
    const adultName = (m[1] || "").trim();
    if (adultName) {
      const fullAdult = paxByName[adultName.toLowerCase()];
      out.push({
        name: adultName,
        type: "adult",
        gender: fullAdult ? fullAdult.gender || null : null,
        age: fullAdult ? fullAdult.age : undefined,
      });
    }

    const depsRaw = m[2] ? String(m[2]).trim() : "";
    if (depsRaw) {
      const deps = depsRaw.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
      for (const dep of deps) {
        const dm = dep.match(/^(TE|EB)\s+(.+)$/);
        if (dm) {
          const depType = dm[1] === "TE" ? "child" : "baby";
          const depName = String(dm[2] || "").trim();
          const fullDep = paxByName[depName.toLowerCase()];
          out.push({
            name: depName,
            type: depType,
            gender: fullDep ? fullDep.gender || null : null,
            age: fullDep ? fullDep.age : undefined,
          });
          continue;
        }
        const dmAge = dep.match(/^(.+?)\s*\((\d+)t\)\s*$/i);
        if (dmAge) {
          const depName = String(dmAge[1] || "").trim();
          const fullDep = paxByName[depName.toLowerCase()];
          out.push({
            name: depName,
            type: fullDep ? fullDep.type : "adult",
            gender: fullDep ? fullDep.gender || null : null,
            age: fullDep
              ? fullDep.age
              : parseInt(dmAge[2], 10) || undefined,
          });
          continue;
        }
        const fullByName = paxByName[dep.toLowerCase()];
        if (fullByName) {
          out.push({
            name: fullByName.name || dep,
            type: fullByName.type || "adult",
            gender: fullByName.gender || null,
            age: fullByName.age,
          });
        }
      }
    }

    return out.filter((p) => p && p.name);
  };

  Object.keys(bucketGroups).forEach((key) => {
    const [orderCode, hId, rtId, ci, co] = key.split("|");
    const order = orderByCode[orderCode];
    if (!order) return;

    // ── PRIVATE ─────────────────────────────────────────────────────────
    let matchedItem = null;
    let matchedRs = null;
    for (const item of order.items || []) {
      if (item.accommodationMode === "shared") continue;
      for (const rs of item.roomSelections || []) {
        const rsFrom = rs.fromDate
          ? new Date(rs.fromDate).toISOString().split("T")[0]
          : "";
        const rsTo = rs.toDate
          ? new Date(rs.toDate).toISOString().split("T")[0]
          : "";
        if (
          String(rs.hotelId || "") === hId &&
          String(rs.roomTypeId || "") === rtId &&
          rsFrom === ci &&
          rsTo === co
        ) {
          matchedItem = item;
          matchedRs = rs;
          break;
        }
      }
      if (matchedRs) break;
    }
    if (matchedRs && Array.isArray(matchedItem.passengers)) {
      const paxByIdx = {};
      for (const p of matchedItem.passengers) {
        if (typeof p.idx === "number") paxByIdx[p.idx] = p;
      }
      const assigns = Array.isArray(matchedRs.roomAssignments)
        ? matchedRs.roomAssignments
        : [];
      bucketGroups[key].forEach((b, i) => {
        const bid = String(b._id);
        modeMap[bid] = matchedItem.accommodationMode || "private";
        const ra = assigns[i];
        if (ra && Array.isArray(ra.passengerIdxs)) {
          paxMap[bid] = ra.passengerIdxs
            .map((idx) => paxByIdx[idx])
            .filter(Boolean)
            .map((p) => ({
              name: p.name || "",
              type: p.type || "adult",
              age: p.age,
              gender: p.gender || null,
            }));
        }
      });
      return;
    }

    // ── SHARED: bỏ qua ở đây — sẽ resolve bằng tourSeg.assignments bên dưới
    //   (đáng tin cậy hơn position-based mapping sau khi admin đổi phòng) ──
  });

  // ── SHARED resolution: nguồn dữ liệu duy nhất là tourSeg.assignments[]
  //   (atomLabels + orderId trên từng entry). Nguồn này luôn được đồng bộ khi
  //   admin save assignments / đổi phòng, nên không bị "lệch" như khi dùng
  //   Order.items.sharedRoomRequest.hotelAllocations.roomAssignments (vốn chỉ
  //   được ghi 1 lần khi tạo đơn). ──
  for (const b of tourBookings) {
    const bid = String(b._id);
    const refs = assignsByThId[bid] || [];
    if (refs.length === 0) continue; // không có assignment nào → bỏ (private đã xử lý)

    const aggregated = [];
    let anyShared = false;
    for (const ref of refs) {
      const refOrder = orderById[String(ref.orderId)] || null;
      if (!refOrder) continue;
      const sharedItem = (refOrder.items || []).find(
        (it) => it.accommodationMode === "shared"
      );
      if (!sharedItem) continue;
      anyShared = true;

      const paxByName = {};
      for (const p of sharedItem.passengers || []) {
        if (p.name) paxByName[String(p.name).trim().toLowerCase()] = p;
      }

      let labels =
        Array.isArray(ref.atomLabels) && ref.atomLabels.length
          ? ref.atomLabels
          : null;

      // Fallback: lấy atomLabels từ Order.items.sharedRoomRequest theo
      // (hotelId+roomTypeName+gender+usedCapacity) → match dần nới lỏng. Cần
      // thiết khi admin swap/đổi phòng — tourSeg.assignments lưu atomLabels=[].
      if (!labels) {
        const numPeople = Number(ref.numPeople) || 0;
        const hid = String(ref.hotelId || "");
        const rtName = ref.roomTypeName || "";
        const gend = ref.gender || null;
        const candidates = [];
        for (const sr of sharedItem.sharedRoomRequest || []) {
          for (const alloc of sr.hotelAllocations || []) {
            if (String(alloc.hotelId || "") !== hid) continue;
            for (const ra of alloc.roomAssignments || []) {
              if (!Array.isArray(ra.atomLabels) || ra.atomLabels.length === 0) continue;
              candidates.push({
                roomTypeName: ra.roomTypeName || "",
                gender: ra.gender || null,
                usedCapacity: Number(ra.usedCapacity) || 0,
                atomLabels: ra.atomLabels,
              });
            }
          }
        }
        const tries = [
          (x) => x.roomTypeName === rtName && x.gender === gend && x.usedCapacity === numPeople,
          (x) => x.roomTypeName === rtName && x.gender === gend,
          (x) => x.roomTypeName === rtName && x.usedCapacity === numPeople,
          (x) => x.roomTypeName === rtName,
          (x) => x.gender === gend && x.usedCapacity === numPeople,
          (x) => x.usedCapacity === numPeople,
          (x) => true,
        ];
        for (const match of tries) {
          const found = candidates.find(match);
          if (found) { labels = found.atomLabels; break; }
        }
      }

      // Fallback cuối: build từ passengers theo guestName + dependants
      if (!labels && ref.guestName) {
        const gName = String(ref.guestName).trim().toLowerCase();
        const adult = (sharedItem.passengers || []).find(
          (p) => p.type === "adult" && String(p.name || "").trim().toLowerCase() === gName
        );
        if (adult) {
          const dependents = (sharedItem.passengers || []).filter((p) => {
            if (p.guardianIdx !== adult.idx) return false;
            if (p.type === "child" || p.type === "baby") return true;
            if (p.type === "adult") {
              const age = Math.max(0, Number(p.age) || 0);
              return passengerNeedsGuardian(
                _normalizePaxForGuardian(p)
              );
            }
            return false;
          });
          let label = adult.name || ref.guestName;
          if (dependents.length > 0) {
            label +=
              " (+ " +
              dependents.map((k) => _formatDependentForAtomLabel(k)).join(", ") +
              ")";
          }
          labels = [label];
        }
      }

      if (!labels) continue;
      for (const lbl of labels) {
        const anchorIdx = _deriveAnchorIdxFromAtomLabel(
          lbl,
          sharedItem.passengers || []
        );
        if (anchorIdx !== null) {
          const roomPax = _passengersForRoomFromAnchorIdxs(
            sharedItem.passengers || [],
            [anchorIdx]
          );
          for (const p of roomPax) {
            aggregated.push({
              name: p.name || "",
              type: p.type || "adult",
              age: p.age,
              gender: p.gender || null,
              ...(refOrder.code && refOrder.code !== b.orderCode
                ? { _orderCode: refOrder.code }
                : {}),
            });
          }
          continue;
        }
        const expanded = expandSharedAtomLabel(lbl, paxByName);
        for (const p of expanded) {
          aggregated.push({
            ...p,
            ...(refOrder.code && refOrder.code !== b.orderCode
              ? { _orderCode: refOrder.code }
              : {}),
          });
        }
      }
    }
    if (anyShared) {
      modeMap[bid] = "shared";
      if (aggregated.length) paxMap[bid] = aggregated;
    }
  }

  return { paxMap, modeMap };
}

// Snapshot nhẹ cho Hotel để làm before/after dễ đọc
/**
 * Audit snapshot cho Hotel: bao phủ mọi field trên form /admin/hotel/edit.
 * - Dùng nhãn tiếng Việt.
 * - Giải nghĩa province ObjectId → tên tỉnh/thành.
 * - Gom các mảng (amenities, facilities, highlights, ageBands, faqs) thành chuỗi.
 * - Trường nested `usefulInfo` được tách ra thành từng phần.
 * - Bỏ slug / audit fields.
 */
async function buildHotelAuditSnapshot(doc) {
  if (!doc) return {};
  const raw = doc.toObject ? doc.toObject() : doc;
  const out = {};

  const scalarMap = [
    ["name", "tên khách sạn"],
    ["status", "trạng thái"],
    ["starRating", "hạng sao"],
    ["basePrice", "giá từ"],
    ["phone", "số điện thoại"],
    ["address", "địa chỉ"],
    ["googleMapsLink", "link Google Maps"],
    ["numberOfRooms", "tổng số phòng"],
    ["currency", "loại tiền"],
    ["isFeatured", "nổi bật"],
    ["avatar", "ảnh đại diện"],
    ["checkinTimeFrom", "nhận phòng từ"],
    ["checkoutTimeTo", "trả phòng đến"],
    ["earlyCheckinTime", "giờ nhận phòng sớm"],
    ["earlyCheckinFee", "phí nhận phòng sớm"],
    ["lateCheckoutTime", "giờ trả phòng muộn"],
    ["lateCheckoutFee", "phí trả phòng muộn"],
  ];
  for (const [k, label] of scalarMap) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== "") out[label] = v;
  }

  // province → tên
  if (raw.province) {
    try {
      const city = await City.findById(raw.province).select("name").lean();
      out["tỉnh/thành"] = (city && city.name) ? city.name : String(raw.province);
    } catch { out["tỉnh/thành"] = String(raw.province); }
  }

  // Danh sách ảnh
  if (Array.isArray(raw.images) && raw.images.length) {
    out["danh sách ảnh"] = `${raw.images.length} ảnh`;
  }

  // Tiện nghi (amenities)
  if (Array.isArray(raw.amenities) && raw.amenities.length) {
    out["tiện nghi"] = raw.amenities
      .map((a) => {
        const name = a.name || "(không tên)";
        const cnt = Array.isArray(a.features) ? a.features.length : 0;
        return cnt ? `${name} (${cnt} đặc điểm)` : name;
      })
      .join(" | ");
  }

  // Cơ sở vật chất (facilities)
  if (Array.isArray(raw.facilities) && raw.facilities.length) {
    out["cơ sở vật chất"] = raw.facilities
      .map((f) => {
        const name = f.name || "(không tên)";
        return f.category ? `${name} — ${f.category}` : name;
      })
      .join(" | ");
  }

  // Điểm nổi bật
  if (Array.isArray(raw.highlights) && raw.highlights.length) {
    out["điểm nổi bật"] = raw.highlights
      .map((h) => h.title || "(chưa có tiêu đề)")
      .join(" | ");
  }

  // Age bands
  if (Array.isArray(raw.ageBands) && raw.ageBands.length) {
    out["mức tuổi"] = raw.ageBands
      .map((b) => {
        const name = b.bandName || "(không tên)";
        const range = b.maxAge
          ? `${b.minAge ?? 0}-${b.maxAge}`
          : `${b.minAge ?? 0}+`;
        const type = b.bandType || "?";
        return `${name} [${range}, ${type}]`;
      })
      .join(" | ");
  }

  // FAQ
  if (Array.isArray(raw.faqs) && raw.faqs.length) {
    out["FAQ"] = raw.faqs
      .filter((f) => f && (f.question || f.answer))
      .map((f) => f.question || "(không có câu hỏi)")
      .join(" | ");
  }

  // Thông tin hữu ích (nested object)
  if (raw.usefulInfo && typeof raw.usefulInfo === "object") {
    const u = raw.usefulInfo;
    const parts = [];
    if (u.builtYear) parts.push(`Năm XD: ${u.builtYear}`);
    if (u.numberOfFloors) parts.push(`Số tầng: ${u.numberOfFloors}`);
    if (u.inRoomVoltage) parts.push(`Điện áp: ${u.inRoomVoltage}`);
    if (u.nonSmokingRooms) parts.push(`Phòng không hút thuốc`);
    if (u.numberOfRestaurants) parts.push(`Số nhà hàng: ${u.numberOfRestaurants}`);
    if (u.numberOfBars) parts.push(`Số bar: ${u.numberOfBars}`);
    if (u.licenseNumber) parts.push(`Giấy phép: ${u.licenseNumber}`);
    if (parts.length) out["thông tin hữu ích"] = parts.join(" | ");
  }

  return out;
}

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
      bandType: bandTypes[i] || "adult",
      
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

    // ── Doanh thu theo từng tháng (12 tháng gần nhất, chỉ đặt phòng trực tiếp) ──
    const monthlyRevenue = [];
    const monthlyLabels  = [];
    for (let i = 11; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      monthlyLabels.push(moment(mStart).format("MM/YYYY"));

      // Chỉ tính đặt phòng trực tiếp (không qua tour)
      const mBookings = allBookings.filter(b => {
        const d = new Date(b.createdAt);
        return d >= mStart && d <= mEnd && !b.tourSegmentId;
      });

      // Group theo base code để tránh cộng trùng
      const mGroups = {};
      mBookings.forEach(b => {
        const base = extractBaseCode(b.code);
        if (!mGroups[base]) mGroups[base] = Number(b.orderTotal || b.totalAmount || 0);
      });
      const mRevenue = Object.values(mGroups).reduce((s, v) => s + v, 0);
      monthlyRevenue.push(Math.round(mRevenue / 1000)); // đơn vị K
    }

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
      monthlyRevenue,
      monthlyLabels,
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

/**
 * GET /admin/hotel/dashboard/daily-revenue?hotelId=...&month=YYYY-MM
 * Trả về doanh thu từng ngày trong tháng được chọn (chỉ đặt phòng trực tiếp).
 */
module.exports.dailyRevenue = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    const { hotelId, month } = req.query; // month: "YYYY-MM"

    if (!companyId || !hotelId || !month) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    // Validate month format
    const monthMatch = String(month).match(/^(\d{4})-(\d{2})$/);
    if (!monthMatch) {
      return res.json({ code: "error", message: "Tháng không hợp lệ" });
    }

    const year  = parseInt(monthMatch[1], 10);
    const mon   = parseInt(monthMatch[2], 10) - 1; // 0-based
    const start = new Date(year, mon, 1);
    const end   = new Date(year, mon + 1, 0, 23, 59, 59); // cuối tháng

    // Kiểm tra quyền
    const hotel = await Hotel.findOne({ _id: hotelId, companyId, deleted: false }).lean();
    if (!hotel) {
      return res.json({ code: "error", message: "Không tìm thấy khách sạn" });
    }

    // Lấy bookings trực tiếp trong tháng
    const bookings = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      status: { $ne: "cancelled" },
      $or: [{ tourSegmentId: null }, { tourSegmentId: { $exists: false } }],
      createdAt: { $gte: start, $lte: end },
    }).lean();

    // Helper extract base code
    const extractBase = (code) => {
      let b = code.replace(/-R\d+(-\d+)?$/, "");
      while (b.match(/-\d+$/)) b = b.replace(/-\d+$/, "");
      return b;
    };

    // Số ngày trong tháng
    const daysInMonth = new Date(year, mon + 1, 0).getDate();

    // Group theo ngày
    const dailyMap = {};
    bookings.forEach(b => {
      const day  = new Date(b.createdAt).getDate(); // 1..N
      const base = extractBase(b.code);
      if (!dailyMap[day]) dailyMap[day] = {};
      if (!dailyMap[day][base]) {
        dailyMap[day][base] = Number(b.orderTotal || b.totalAmount || 0);
      }
    });

    // Tạo mảng kết quả theo ngày
    const labels   = [];
    const revenues = [];
    for (let d = 1; d <= daysInMonth; d++) {
      labels.push(`${String(d).padStart(2,"0")}/${String(mon + 1).padStart(2,"0")}`);
      const dayTotal = dailyMap[d]
        ? Object.values(dailyMap[d]).reduce((s, v) => s + v, 0)
        : 0;
      revenues.push(Math.round(dayTotal / 1000)); // K
    }

    return res.json({ code: "success", labels, revenues });
  } catch (err) {
    console.error("dailyRevenue error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
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
    // Lấy danh sách tỉnh thành trong nước (Việt Nam)
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
      backHotelId: req.query.hotelId || null,
      selectedHotelId: req.query.hotelId || null,
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

    buildHotelAuditSnapshot(newRecord).then((afterSnap) => {
      auditLogHelper.log(req, {
        action: "hotel.create",
        resourceType: "Hotel",
        resourceId: newRecord._id,
        resourceLabel: newRecord.name || "",
        after: afterSnap,
        summary: `Tạo khách sạn "${newRecord.name || ""}"`,
      });
    }).catch(() => {});

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
      readOnly: false,
      selectedHotelId: String(hotelDetail._id),
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
    const afterDoc = await Hotel.findById(id).lean();
    const [beforeSnap, afterSnap] = await Promise.all([
      buildHotelAuditSnapshot(existed),
      buildHotelAuditSnapshot(afterDoc || {}),
    ]);
    auditLogHelper.log(req, {
      action: "hotel.update",
      resourceType: "Hotel",
      resourceId: id,
      resourceLabel: (afterDoc && afterDoc.name) || existed.name || "",
      before: beforeSnap,
      after: afterSnap,
      summary: `Cập nhật khách sạn "${afterDoc?.name || existed.name || ""}"`,
    });

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

    const hotelBefore = await Hotel.findOne(find).select("name").lean();
    await Hotel.updateOne(find, {
      deleted: true,
      deletedAt: Date.now(),
      deletedBy: req.account.id,
    });

    auditLogHelper.log(req, {
      action: "hotel.delete",
      resourceType: "Hotel",
      resourceId: id,
      resourceLabel: (hotelBefore && hotelBefore.name) || "",
      summary: `Xóa khách sạn "${(hotelBefore && hotelBefore.name) || ""}"`,
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
    if (
      req.account &&
      !req.account.isSuperAdmin &&
      req.account.tabAccessScope === "hotel_staff" &&
      ["delete", "undo", "destroy"].includes(String(value))
    ) {
      return res.json({
        code: "error",
        message: "Bạn không có quyền thực hiện thao tác này!",
      });
    }

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

    // Lấy booking của khách sạn được chọn (không bao gồm tour holds)
    bookingFilter.tourSegmentId = null;
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
        cccdImages: b.guest?.cccdImages || [],
        createdAtFormat: b.createdAt
          ? moment(b.createdAt).format("DD/MM/YYYY HH:mm")
          : "—",
        checkIn: b.checkIn
          ? moment(b.checkIn).format("DD/MM/YYYY")
          : "—",
        nights,
        roomType: roomTypeName,
        roomCount, // Tổng số phòng của cả nhóm
        adults: group.reduce((sum, booking) => sum + (booking.adults || 1), 0),
        children: group.reduce((sum, booking) => sum + (booking.children || 0), 0),
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
    const ctx = req.bookingDetailContext || {};
    const companyId =
      ctx.enforceCompanyId || req.account?.companyId || null;

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
      hotel = await Hotel.findOne({
        _id: hotelId,
        companyId,
        deleted: false,
      }).lean();
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
      transferProofImages: firstBooking.transferProofImages || [],
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
        
        let roomsDetails = [];
        if (b.roomsData) {
          try {
            const parsedRoomsData = JSON.parse(decodeURIComponent(b.roomsData));
            if (Array.isArray(parsedRoomsData)) {
              const roomNumberMatch = b.code.match(/-R(\d+)(-\d+)?$/);
              if (roomNumberMatch && b.rooms === 1) {
                const roomIndex = parseInt(roomNumberMatch[1], 10) - 1;
                roomsDetails = buildAdminRoomsDetailsDisplay(parsedRoomsData, {
                  onlyRoomIndex: roomIndex,
                });
              } else {
                roomsDetails = buildAdminRoomsDetailsDisplay(parsedRoomsData);
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
      bookingDetailReadOnly: !!ctx.bookingDetailReadOnly,
      bookingListBackUrl:
        ctx.bookingListBackUrl || `/${pathAdmin}/hotel/booking/list`,
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
// ── Tab "Giữ phòng Tour" ──────────────────────────────────────────────────────
// Hiển thị toàn bộ HotelBooking có tourSegmentId != null của khách sạn được chọn,
// nhóm theo TourSegment để admin thấy rõ: tour nào, lịch nào, đang giữ bao nhiêu phòng.
module.exports.tourHolds = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    const TourSegment = require("../../models/tour-segment.model");
    const Tour = require("../../models/tour.model");

    if (!companyId) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Giữ phòng Tour",
        bookingsData: { tourHoldGroups: [], activeTab: "tour-holds" },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    let hotelId = req.query.hotelId || null;
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name address rooms roomTypes")
      .lean();

    if (!hotels || hotels.length === 0) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Giữ phòng Tour",
        bookingsData: { tourHoldGroups: [], hotels: [], activeTab: "tour-holds" },
        selectedHotelId: null,
        pathAdmin,
        isBookingManagement: true,
      });
    }

    if (!hotelId || hotelId === "all") {
      hotelId = String(hotels[0]._id);
      const urlParams = new URLSearchParams(req.query);
      urlParams.set("hotelId", hotelId);
      return res.redirect(`/${pathAdmin}/hotel/booking/tour-holds?${urlParams.toString()}`);
    }

    const selectedHotel = hotels.find((h) => String(h._id) === hotelId);

    // Self-heal: giải phóng các tour hold còn dính tour đã xoá mềm trước đây
    // (cascade chỉ chạy từ thời điểm tính năng được bổ sung; dữ liệu cũ tự xử lý ở đây).
    await _autoReleaseStaleDeletedTourHolds(companyId);

    // Dọn dẹp booking tour hold bị lỗi (code: null) còn sót lại từ lần confirm thất bại
    await HotelBooking.updateMany(
      {
        "hotel.hotelId": selectedHotel._id,
        tourSegmentId: { $ne: null, $exists: true },
        code: null,
        status: { $ne: "cancelled" },
      },
      { status: "cancelled" }
    );

    // Chỉ lấy các hold phòng vật lý (TH...) do admin tạo khi cấu hình tour;
    // loại trừ placeholder "[Tour Booking]" (HB..., roomId=null) sinh từ đơn
    // tour của khách — placeholder thuộc phạm vi quản lý đơn hàng, không
    // phản ánh phòng vật lý được giữ.
    let holdBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      tourSegmentId: { $ne: null, $exists: true },
      status: { $ne: "cancelled" },
      code: { $ne: null },
      roomId: { $ne: null },
    })
      .sort({ checkIn: 1 })
      .lean();

    // Bỏ qua booking thuộc Order đã bị xoá (xem _filterBookingsByLiveOrder).
    holdBookings = await _filterBookingsByLiveOrder(holdBookings);

    // Lấy tất cả TourSegment liên quan
    const segmentIds = [...new Set(holdBookings.map((b) => String(b.tourSegmentId)).filter(Boolean))];
    const segments = await TourSegment.find({ _id: { $in: segmentIds } }).lean();
    const segmentMap = {};
    for (const seg of segments) segmentMap[String(seg._id)] = seg;

    // Lấy tên tour. Bỏ qua các tour đã bị xoá mềm để các tour hold tương ứng
    // không còn lộ ra ở trang /admin/hotel/booking/tour-holds (đồng bộ với việc
    // admin vừa xoá tour ở /admin/tour/list).
    const tourIds = [...new Set(segments.map((s) => String(s.tourId)))];
    const tours = await Tour.find({
      _id: { $in: tourIds },
      deleted: { $ne: true },
    })
      .select("name companyId customId")
      .lean();
    const tourMap = {};
    for (const t of tours) tourMap[String(t._id)] = t;

    // Lọc bỏ segment có tour đã bị xoá / không tồn tại — kéo theo các holdBookings
    // thuộc segment đó cũng bị loại khỏi danh sách hiển thị.
    const validSegmentIds = new Set(
      segments
        .filter((s) => tourMap[String(s.tourId)])
        .map((s) => String(s._id))
    );
    holdBookings = holdBookings.filter((b) =>
      validSegmentIds.has(String(b.tourSegmentId))
    );

    // Lấy tên công ty sở hữu tour (cho phân biệt cùng/khác company)
    const Company = require("../../models/company.model");
    const allCompanyIds = [...new Set([String(companyId), ...segments.map((s) => String(s.companyId)).filter(Boolean)])];
    const tourCompanies = await Company.find({ _id: { $in: allCompanyIds } }).select("name").lean();
    const companyNameMap = {};
    for (const c of tourCompanies) companyNameMap[String(c._id)] = c.name || "";
    const ownCompanyName = companyNameMap[String(companyId)] || "";

    // Lấy trạng thái link request mới nhất theo (segmentId + hotelId đang xem)
    // để hiển thị badge trạng thái đúng theo góc nhìn của khách sạn này, thay vì
    // dùng segment.status chung (vốn = 'rejected' khi BẤT KỲ KS khác từ chối).
    const HotelLinkRequest = require("../../models/hotel-link-request.model");
    const lrForThisHotel = await HotelLinkRequest.find({
      tourSegmentId: { $in: segmentIds },
      hotelId: selectedHotel._id,
    })
      .select("tourSegmentId status createdAt")
      .sort({ createdAt: -1 })
      .lean();
    const latestLrBySegment = new Map();
    for (const lr of lrForThisHotel) {
      const k = String(lr.tourSegmentId);
      if (!latestLrBySegment.has(k)) latestLrBySegment.set(k, lr);
    }

    // Nhóm booking theo tourSegmentId
    const groupMap = {};
    for (const booking of holdBookings) {
      const segId = String(booking.tourSegmentId);
      if (!groupMap[segId]) {
        const seg = segmentMap[segId] || {};
        const tour = tourMap[String(seg.tourId)] || {};
        const tourIdStr = String(seg.tourId || "");
        const tourCompanyId = String(seg.companyId || "");
        // Trạng thái hiển thị từ góc nhìn của KS đang xem.
        // Ưu tiên link request của chính KS này; nếu không có thì fallback về
        // segment.status.
        const lrHere = latestLrBySegment.get(segId);
        let segmentStatus = seg.status || "draft";
        if (lrHere) {
          if (lrHere.status === "approved" || lrHere.status === "partially_approved") {
            segmentStatus = "confirmed";
          } else if (lrHere.status === "pending") {
            segmentStatus = "pending_approval";
          } else if (lrHere.status === "rejected") {
            segmentStatus = "rejected";
          } else if (lrHere.status === "cancelled") {
            segmentStatus = "cancelled";
          }
        }
        groupMap[segId] = {
          segmentId:    segId,
          tourId:       tourIdStr,
          tourShortId:  getTourDisplayId(tour),
          tourName:     tour.name || "—",
          departureDate: seg.departureDate ? moment(seg.departureDate).format("DD/MM/YYYY") : "—",
          endDate:       seg.endDate ? moment(seg.endDate).format("DD/MM/YYYY") : "—",
          paxRequired:   seg.paxRequired || 0,
          segmentStatus,
          tourCompanyId,
          tourCompanyName: companyNameMap[tourCompanyId] || "",
          isOwnCompany: tourCompanyId === String(companyId),
          bookings:      [],
          timeFrameMap:  {},
          totalRooms:    0,
          totalPeople:   0,
        };
      }
      const rt = (selectedHotel.roomTypes || []).find(
        (r) => String(r._id) === String(booking.roomTypeId)
      );
      // Lấy số phòng từ danh sách rooms của hotel
      const roomDoc = booking.roomId
        ? (selectedHotel.rooms || []).find((r) => String(r._id) === String(booking.roomId))
        : null;
      const guestName = booking.guest?.fullName || "";
      const isAssigned = guestName !== "" && guestName !== "[Tour Hold]";
      const checkInStr  = booking.checkIn  ? moment(booking.checkIn).format("DD/MM/YYYY")  : "—";
      const checkOutStr = booking.checkOut ? moment(booking.checkOut).format("DD/MM/YYYY") : "—";
      const tfKey = `${checkInStr}_${checkOutStr}`;

      groupMap[segId].bookings.push({
        id:            String(booking._id),
        code:          booking.code,
        roomTypeName:  rt ? rt.name : "—",
        roomNumber:    roomDoc ? roomDoc.roomNumber || roomDoc.name || "—" : "—",
        rooms:         booking.rooms || 1,
        adults:        booking.adults || 0,
        checkIn:       checkInStr,
        checkOut:      checkOutStr,
        tfKey,
        status:        booking.status,
        guestName:     isAssigned ? guestName : "",
        guestPhone:    isAssigned ? (booking.guest?.phone || "") : "",
        isAssigned,
      });

      // Thống kê theo từng khung thời gian để hiển thị riêng biệt
      if (!groupMap[segId].timeFrameMap[tfKey]) {
        groupMap[segId].timeFrameMap[tfKey] = {
          checkIn:     checkInStr,
          checkOut:    checkOutStr,
          totalRooms:  0,
          totalPeople: 0,
        };
      }
      groupMap[segId].timeFrameMap[tfKey].totalRooms  += booking.rooms || 1;
      groupMap[segId].timeFrameMap[tfKey].totalPeople += booking.adults || 0;

      groupMap[segId].totalRooms  += booking.rooms || 1;
      groupMap[segId].totalPeople += booking.adults || 0;
    }

    // Chuyển timeFrameMap thành mảng có thứ tự (sớm nhất trước)
    // và gán segmentIndex tương ứng với khung thời gian đã cấu hình ở tour-hotel detail
    for (const group of Object.values(groupMap)) {
      const toMs = (str) => {
        if (!str || str === "—") return 0;
        const [d, m, y] = str.split("/");
        return new Date(`${y}-${m}-${d}`).getTime();
      };

      group.timeFrames = Object.values(group.timeFrameMap).sort(
        (a, b) => toMs(a.checkIn) - toMs(b.checkIn)
      );

      // Lấy các sub-segments đã cấu hình ở tour-hotel detail, sắp xếp theo fromDate
      const tourSegDoc = segmentMap[group.segmentId] || null;
      const subSegs = ((tourSegDoc?.segments || []).slice()).sort(
        (a, b) => new Date(a.fromDate) - new Date(b.fromDate)
      );

      // Gán segmentIndex cho từng time frame bằng cách khớp checkIn với fromDate sub-segment
      group.timeFrames = group.timeFrames.map((tf) => {
        const tfMs = toMs(tf.checkIn);
        const idx = subSegs.findIndex((ss) => {
          const ssFromMs = ss.fromDate ? new Date(ss.fromDate).getTime() : null;
          return ssFromMs !== null && Math.abs(tfMs - ssFromMs) < 2 * 86400 * 1000;
        });
        return {
          ...tf,
          segmentIndex: idx >= 0 ? idx : null,
          segmentLabel: idx >= 0 ? `Khung ${idx + 1}` : null,
        };
      });

      delete group.timeFrameMap;
    }

    const allGroups = Object.values(groupMap);
    const ownTourHoldGroups = allGroups.filter((g) => g.isOwnCompany);
    const crossTourHoldGroups = allGroups.filter((g) => !g.isOwnCompany);

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Giữ phòng Tour",
      bookingsData: {
        activeTab:      "tour-holds",
        tourHoldGroups: allGroups,
        ownTourHoldGroups,
        crossTourHoldGroups,
        hotels,
      },
      selectedHotelId: hotelId,
      ownCompanyName,
      pathAdmin,
      isBookingManagement: true,
    });
  } catch (err) {
    console.error("[tourHolds]", err);
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Giữ phòng Tour",
      bookingsData: { tourHoldGroups: [], activeTab: "tour-holds" },
      selectedHotelId: null,
      pathAdmin,
      isBookingManagement: true,
    });
  }
};

// ── Chi tiết giữ phòng Tour của 1 tour segment ─────────────────────────────
module.exports.tourHoldDetail = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    const TourSegment = require("../../models/tour-segment.model");
    const Tour = require("../../models/tour.model");
    const Company = require("../../models/company.model");

    const { segmentId } = req.params;
    const hotelId = req.query.hotelId || null;

    if (!companyId || !hotelId) {
      return res.redirect(`/${pathAdmin}/hotel/booking/tour-holds`);
    }

    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name address rooms roomTypes")
      .lean();
    const selectedHotel = hotels.find((h) => String(h._id) === hotelId);
    if (!selectedHotel) {
      return res.redirect(`/${pathAdmin}/hotel/booking/tour-holds`);
    }

    const segment = await TourSegment.findById(segmentId).lean();
    if (!segment) {
      return res.redirect(`/${pathAdmin}/hotel/booking/tour-holds?hotelId=${hotelId}`);
    }

    // Nếu tour mẹ đã bị xoá mềm (deleted: true) thì coi như segment cũng không
    // còn hợp lệ — không hiển thị các tour hold của tour đã xoá nữa.
    const parentTour = await Tour.findOne({ _id: segment.tourId })
      .select("_id deleted customId")
      .lean();
    if (!parentTour || parentTour.deleted === true) {
      return res.redirect(`/${pathAdmin}/hotel/booking/tour-holds?hotelId=${hotelId}`);
    }

    // Chỉ lấy các hold phòng vật lý (TH...) do admin tạo khi cấu hình tour.
    // Bỏ qua placeholder "[Tour Booking]" (HB..., roomId=null) sinh tự động
    // khi khách đặt tour — placeholder đó thuộc phạm vi quản lý đơn hàng,
    // không phải phòng vật lý và không thể thao tác trên trang này.
    let holdBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      tourSegmentId: segment._id,
      status: { $ne: "cancelled" },
      code: { $ne: null },
      roomId: { $ne: null },
    })
      .lean();

    holdBookings = await _filterBookingsByLiveOrder(holdBookings);

    const rawSearchQ =
      req.query.q != null && String(req.query.q).trim() !== ""
        ? String(req.query.q).trim()
        : "";
    const qCompact = rawSearchQ.toLowerCase().replace(/\s/g, "");
    function roomNumberSortKeyFromBooking(b) {
      const rd = b.roomId
        ? (selectedHotel.rooms || []).find(
            (r) => String(r._id) === String(b.roomId)
          )
        : null;
      const label = rd ? rd.roomNumber || rd.name || "" : "";
      const digits = String(label).replace(/\D/g, "");
      const n = parseInt(digits, 10);
      if (Number.isFinite(n)) return n;
      return String(label).toLowerCase();
    }

    function bookingMatchesHoldDetailSearch(b) {
      if (!qCompact) return true;
      const codeNorm = String(b.code || "")
        .toLowerCase()
        .replace(/\s/g, "");
      const byCode =
        codeNorm &&
        (codeNorm === qCompact ||
          codeNorm.includes(qCompact) ||
          qCompact.includes(codeNorm));
      const byTour = queryMatchesTourIdSearch(qCompact, parentTour);
      const rd = b.roomId
        ? (selectedHotel.rooms || []).find(
            (r) => String(r._id) === String(b.roomId)
          )
        : null;
      const roomLabel = String(
        (rd && (rd.roomNumber || rd.name)) || ""
      )
        .toLowerCase()
        .replace(/\s/g, "");
      const byRoom =
        roomLabel &&
        (roomLabel === qCompact ||
          roomLabel.includes(qCompact) ||
          qCompact.includes(roomLabel));
      return Boolean(byCode || byTour || byRoom);
    }

    let filteredHoldBookings = qCompact
      ? holdBookings.filter(bookingMatchesHoldDetailSearch)
      : holdBookings;

    // Sắp xếp theo số phòng tăng dần (cột Phòng số); tie-break: ngày nhận phòng.
    filteredHoldBookings = filteredHoldBookings.slice().sort((a, b) => {
      const ka = roomNumberSortKeyFromBooking(a);
      const kb = roomNumberSortKeyFromBooking(b);
      if (typeof ka === "number" && typeof kb === "number" && ka !== kb) {
        return ka - kb;
      }
      if (typeof ka === "number" && typeof kb !== "number") return -1;
      if (typeof ka !== "number" && typeof kb === "number") return 1;
      const ca = String(ka);
      const cb = String(kb);
      if (ca !== cb) return ca.localeCompare(cb, "vi", { numeric: true });
      const ta = a.checkIn ? new Date(a.checkIn).getTime() : 0;
      const tb = b.checkIn ? new Date(b.checkIn).getTime() : 0;
      return ta - tb;
    });

    const tour = await Tour.findById(segment.tourId)
      .select("name companyId customId")
      .lean();
    const tourCompanyId = String(segment.companyId || "");
    let tourCompanyName = "";
    if (tourCompanyId) {
      const c = await Company.findById(tourCompanyId).select("name").lean();
      tourCompanyName = c?.name || "";
    }
    const ownCompanyNameDoc = await Company.findById(companyId).select("name").lean();
    const ownCompanyName = ownCompanyNameDoc?.name || "";

    const tourIdStr = String(segment.tourId || "");

    // Trạng thái hiển thị theo góc nhìn của KS đang xem (xem ghi chú ở
    // module.exports.tourHolds). Dùng link request mới nhất của (segment, hotel)
    // — nếu approved/partially_approved thì coi như confirmed kể cả khi
    // segment.status đang là "rejected" do KS khác từ chối.
    const HotelLinkRequest = require("../../models/hotel-link-request.model");
    const lrHere = await HotelLinkRequest.findOne({
      tourSegmentId: segment._id,
      hotelId: selectedHotel._id,
    })
      .select("status createdAt")
      .sort({ createdAt: -1 })
      .lean();
    let segmentStatusForHotel = segment.status || "draft";
    if (lrHere) {
      if (lrHere.status === "approved" || lrHere.status === "partially_approved") {
        segmentStatusForHotel = "confirmed";
      } else if (lrHere.status === "pending") {
        segmentStatusForHotel = "pending_approval";
      } else if (lrHere.status === "rejected") {
        segmentStatusForHotel = "rejected";
      } else if (lrHere.status === "cancelled") {
        segmentStatusForHotel = "cancelled";
      }
    }

    const group = {
      segmentId:    String(segment._id),
      tourId:       tourIdStr,
      tourShortId:  getTourDisplayId(tour || { _id: tourIdStr }),
      tourName:     tour?.name || "—",
      departureDate: segment.departureDate ? moment(segment.departureDate).format("DD/MM/YYYY") : "—",
      endDate:       segment.endDate ? moment(segment.endDate).format("DD/MM/YYYY") : "—",
      paxRequired:   segment.paxRequired || 0,
      segmentStatus: segmentStatusForHotel,
      tourCompanyId,
      tourCompanyName,
      isOwnCompany: tourCompanyId === String(companyId),
      bookings:      [],
      timeFrameMap:  {},
      totalRooms:    0,
      totalPeople:   0,
    };

    // Multi-occupant: 1 TH có thể được nhiều đơn share. Lấy
    //   tourSeg.assignments để biết tất cả đơn tham chiếu mỗi TH.
    const assignsByThId = {};
    for (const a of segment.assignments || []) {
      if (!a.holdBookingId) continue;
      const k = String(a.holdBookingId);
      if (!assignsByThId[k]) assignsByThId[k] = [];
      assignsByThId[k].push({
        assignmentId: String(a._id),
        guestName:   a.guestName || "",
        phone:       a.phone || "",
        orderCode:   a.orderCode || "",
        guestStatus: a.guestStatus || "confirmed",
      });
    }

    for (const booking of filteredHoldBookings) {
      const rt = (selectedHotel.roomTypes || []).find(
        (r) => String(r._id) === String(booking.roomTypeId)
      );
      const roomDoc = booking.roomId
        ? (selectedHotel.rooms || []).find((r) => String(r._id) === String(booking.roomId))
        : null;
      const guestName = booking.guest?.fullName || "";
      const checkInStr  = booking.checkIn  ? moment(booking.checkIn).format("DD/MM/YYYY")  : "—";
      const checkOutStr = booking.checkOut ? moment(booking.checkOut).format("DD/MM/YYYY") : "—";
      const tfKey = `${checkInStr}_${checkOutStr}`;

      // Tổng hợp danh sách khách ghép phòng (nếu có >1 đơn share TH này).
      const assignees = assignsByThId[String(booking._id)] || [];
      // Bao gồm cả primary (từ TH.guest) lẫn phụ (từ tourSeg.assignments) —
      // dedupe theo orderCode/guestName để tránh trùng.
      const combinedMap = {};
      // Ưu tiên dùng dữ liệu từ tourSeg.assignments (có guestStatus + assignmentId)
      // vì nó đầy đủ hơn TH.guest (chỉ lưu primary).
      for (const a of assignees) {
        const k = a.orderCode || a.guestName;
        if (!k) continue;
        if (!combinedMap[k]) combinedMap[k] = a;
      }
      // Fallback: nếu TH.guest là primary và chưa có trong combinedMap
      if (guestName && guestName !== "[Tour Hold]") {
        const k = booking.orderCode || guestName;
        if (!combinedMap[k]) {
          combinedMap[k] = {
            assignmentId: null,
            guestName,
            phone: booking.guest?.phone || "",
            orderCode: booking.orderCode || "",
            guestStatus: booking.status || "confirmed",
          };
        }
      }
      const combined = Object.values(combinedMap);
      const isAssigned = combined.length > 0;

      group.bookings.push({
        id:           String(booking._id),
        code:         booking.code,
        roomTypeName: rt ? rt.name : "—",
        roomNumber:   roomDoc ? roomDoc.roomNumber || roomDoc.name || "—" : "—",
        rooms:        booking.rooms || 1,
        adults:       booking.adults || 0,
        checkIn:      checkInStr,
        checkOut:     checkOutStr,
        tfKey,
        status:       booking.status,
        guestName:    isAssigned ? combined[0].guestName : "",
        guestPhone:   isAssigned ? combined[0].phone : "",
        isAssigned,
        assignees:    combined,
      });

      if (!group.timeFrameMap[tfKey]) {
        group.timeFrameMap[tfKey] = {
          checkIn:     checkInStr,
          checkOut:    checkOutStr,
          totalRooms:  0,
          totalPeople: 0,
        };
      }
      group.timeFrameMap[tfKey].totalRooms  += booking.rooms || 1;
      group.timeFrameMap[tfKey].totalPeople += booking.adults || 0;

      group.totalRooms  += booking.rooms || 1;
      group.totalPeople += booking.adults || 0;
    }

    const toMs = (str) => {
      if (!str || str === "—") return 0;
      const [d, m, y] = str.split("/");
      return new Date(`${y}-${m}-${d}`).getTime();
    };

    group.timeFrames = Object.values(group.timeFrameMap).sort(
      (a, b) => toMs(a.checkIn) - toMs(b.checkIn)
    );

    const subSegs = ((segment.segments || []).slice()).sort(
      (a, b) => new Date(a.fromDate) - new Date(b.fromDate)
    );
    group.timeFrames = group.timeFrames.map((tf) => {
      const tfMs = toMs(tf.checkIn);
      const idx = subSegs.findIndex((ss) => {
        const ssFromMs = ss.fromDate ? new Date(ss.fromDate).getTime() : null;
        return ssFromMs !== null && Math.abs(tfMs - ssFromMs) < 2 * 86400 * 1000;
      });
      return {
        ...tf,
        segmentIndex: idx >= 0 ? idx : null,
        segmentLabel: idx >= 0 ? `Khung ${idx + 1}` : null,
      };
    });
    delete group.timeFrameMap;

    return res.render("admin/pages/hotel-booking", {
      pageTitle: `Giữ phòng Tour – ${group.tourName}`,
      bookingsData: {
        activeTab:    "tour-holds-detail",
        detailGroup:  group,
        hotels,
      },
      selectedHotelId: hotelId,
      ownCompanyName,
      pathAdmin,
      isBookingManagement: true,
      tourHoldSearchQuery: rawSearchQ,
      tourHoldDetailSegmentId: String(segmentId),
    });
  } catch (err) {
    console.error("[tourHoldDetail]", err);
    return res.redirect(`/${pathAdmin}/hotel/booking/tour-holds`);
  }
};

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

    // Lấy hotelId và bộ lọc ngày từ query params
    let hotelId = req.query.hotelId || null;
    const filterFrom = req.query.filterFrom || null; // "YYYY-MM-DD"
    const filterTo   = req.query.filterTo   || null; // "YYYY-MM-DD"

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

    // Self-heal: giải phóng các tour hold còn dính tour đã xoá mềm trước đây.
    await _autoReleaseStaleDeletedTourHolds(companyId);

    // 1. Lấy bookings cần xếp phòng (roomId = null hoặc không tồn tại, status != cancelled)
    let pendingBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      $or: [
        { roomId: null },
        { roomId: { $exists: false } }
      ],
      status: { $ne: "cancelled" },
      // Loại trừ booking giữ phòng cho tour (Tour Hold) - không phải booking khách thật
      tourSegmentId: null,
    })
      .sort({ createdAt: -1 })
      .lean();

    pendingBookings = await _filterBookingsByLiveOrder(pendingBookings);

    // Format pending bookings
    const formattedPendingBookings = pendingBookings.map(b => {
      let roomTypeName = "Loại phòng";
      if (Array.isArray(selectedHotel.roomTypes) && b.roomTypeId) {
        const rt = selectedHotel.roomTypes.find(
          (rt) => String(rt._id) === String(b.roomTypeId)
        );
        if (rt && rt.name) roomTypeName = rt.name;
      }

      // Tạo text trẻ em kèm độ tuổi
      let childrenText = "";
      if (b.children > 0) {
        if (b.childrenDetails && Array.isArray(b.childrenDetails) && b.childrenDetails.length > 0) {
          const ages = b.childrenDetails.map(c => `${c.age} tuổi`).join(", ");
          childrenText = `${b.children} TE (${ages})`;
        } else {
          childrenText = `${b.children} TE`;
        }
      }

      return {
        bookingId: b._id,
        code: b.code,
        customerName: b.guest?.fullName || "Khách lẻ",
        roomType: roomTypeName,
        roomTypeId: b.roomTypeId,
        roomCount: b.rooms || 1,
        adults: b.adults || 1,
        children: b.children || 0,
        childrenText,
        checkIn: b.checkIn ? moment(b.checkIn).format("YYYY-MM-DD") : "",
        checkInDisplay: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "",
        checkOut: b.checkOut ? moment(b.checkOut).format("YYYY-MM-DD") : "",
        checkOutDisplay: b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "",
      };
    });

    // Group pending bookings theo mã đơn gốc của khách
    const pendingGroupMap = {};
    formattedPendingBookings.forEach(booking => {
      // Tách base code: bỏ suffix -R\d+ và -\d+ (VD: HB123-1-R2 → HB123)
      let baseCode = booking.code;
      baseCode = baseCode.replace(/-R\d+(-\d+)?$/, "");
      while (baseCode.match(/-\d+$/)) {
        baseCode = baseCode.replace(/-\d+$/, "");
      }

      if (!pendingGroupMap[baseCode]) {
        pendingGroupMap[baseCode] = {
          baseCode,
          customerName: booking.customerName,
          checkIn: booking.checkIn,
          checkInDisplay: booking.checkInDisplay,
          checkOut: booking.checkOut,
          checkOutDisplay: booking.checkOutDisplay,
          totalRooms: 0,
          roomTypeCountMap: {},
          bookings: [],
        };
      }

      const g = pendingGroupMap[baseCode];
      g.totalRooms += booking.roomCount;
      if (!g.roomTypeCountMap[booking.roomType]) g.roomTypeCountMap[booking.roomType] = 0;
      g.roomTypeCountMap[booking.roomType] += booking.roomCount;
      g.bookings.push(booking);
    });

    const groupedPendingBookings = Object.values(pendingGroupMap).map(g => ({
      baseCode: g.baseCode,
      customerName: g.customerName,
      totalRooms: g.totalRooms,
      roomTypesSummary: Object.entries(g.roomTypeCountMap)
        .map(([rt, count]) => `${rt} × ${count}`)
        .join(", "),
      checkIn: g.checkIn,
      checkInDisplay: g.checkInDisplay,
      checkOut: g.checkOut,
      checkOutDisplay: g.checkOutDisplay,
      bookings: g.bookings,
    }));

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

    // Xây dựng điều kiện lọc ngày nếu admin chỉ định
    // Dùng quy tắc half-open interval [checkIn, checkOut):
    //   Hai khoảng [filterFrom, filterTo) và [checkIn, checkOut) overlap khi:
    //     checkIn < filterTo  VÀ  checkOut > filterFrom
    const dateOverlapFilter = {};
    if (filterFrom || filterTo) {
      if (filterFrom) {
        const from = new Date(filterFrom);
        dateOverlapFilter.checkOut = { $gt: from };
      }
      if (filterTo) {
        const to = new Date(filterTo); // KHÔNG cộng thêm 1 ngày — checkIn = filterTo không overlap
        dateOverlapFilter.checkIn = { $lt: to };
      }
    }
    
    // Lấy bookings ĐANG DIỄN RA (CHỈ những booking đã nhận phòng - status = checked_in)
    // Nếu có bộ lọc ngày, dùng nó; nếu không, dùng "hiện tại" như cũ
    const currentBookingsQuery = {
      "hotel.hotelId": selectedHotel._id,
      roomId: { $ne: null },
      status: "checked_in",
      ...(filterFrom || filterTo ? dateOverlapFilter : {
        checkIn:  { $lte: now },
        checkOut: { $gte: now },
      }),
    };
    let currentBookings = await HotelBooking.find(currentBookingsQuery).lean();
    currentBookings = await _filterBookingsByLiveOrder(currentBookings);

    // Lấy TẤT CẢ bookings còn hiệu lực (để hiển thị trong modal chi tiết)
    const allBookingsQuery = {
      "hotel.hotelId": selectedHotel._id,
      roomId: { $ne: null },
      status: { $nin: ["cancelled", "checked_out"] },
      ...(filterFrom || filterTo ? dateOverlapFilter : {
        checkOut: { $gte: now },
      }),
    };
    let allBookings = await HotelBooking.find(allBookingsQuery).lean();
    allBookings = await _filterBookingsByLiveOrder(allBookings);

    // Map roomId -> Set để check phòng đang sử dụng
    const occupiedRoomIds = new Set();
    currentBookings.forEach(b => {
      if (b.roomId) {
        occupiedRoomIds.add(String(b.roomId));
      }
    });

    // ── Join TourSegment → Tour để hiển thị tên tour + ngày cho tour hold bookings ──
    const TourSegment = require("../../models/tour-segment.model");
    const Tour        = require("../../models/tour.model");

    const tourHoldBookings = allBookings.filter(b => b.tourSegmentId);
    const uniqueSegIds = [...new Set(tourHoldBookings.map(b => String(b.tourSegmentId)))];

    const segmentInfoMap = {}; // segmentId -> { tourName, departureDate, endDate, tourCompanyDisplay }
    if (uniqueSegIds.length > 0) {
      const segments = await TourSegment.find({ _id: { $in: uniqueSegIds } })
        .select("tourId departureDate endDate companyId")
        .lean();

      const uniqueTourIds = [...new Set(segments.map(s => String(s.tourId)).filter(Boolean))];
      let tourNameMap = {};
      if (uniqueTourIds.length > 0) {
        const tours = await Tour.find({ _id: { $in: uniqueTourIds } })
          .select("name")
          .lean();
        tourNameMap = Object.fromEntries(tours.map(t => [String(t._id), t.name]));
      }

      const Company = require("../../models/company.model");
      const segCompanyIds = [...new Set(segments.map((s) => String(s.companyId)).filter(Boolean))];
      const allCoIds = [...new Set([...segCompanyIds, String(companyId)])];
      const tourCompanies = await Company.find({ _id: { $in: allCoIds } }).select("name").lean();
      const companyNameMap = {};
      for (const c of tourCompanies) companyNameMap[String(c._id)] = c.name || "";
      const ownCompanyName = companyNameMap[String(companyId)] || "";

      for (const seg of segments) {
        const tourCoId = seg.companyId ? String(seg.companyId) : "";
        const tourCoName = tourCoId ? (companyNameMap[tourCoId] || "") : "";
        const isOwnTour = tourCoId && tourCoId === String(companyId);
        const tourCompanyDisplay = isOwnTour
          ? (ownCompanyName ? `${ownCompanyName} (Công ty mình)` : "Công ty mình")
          : (tourCoName || "—");

        segmentInfoMap[String(seg._id)] = {
          tourName:      tourNameMap[String(seg.tourId)] || "Tour",
          departureDate: seg.departureDate ? moment(seg.departureDate).format("DD/MM/YYYY") : "",
          endDate:       seg.endDate       ? moment(seg.endDate).format("DD/MM/YYYY")       : "",
          tourCompanyDisplay,
        };
      }
    }

    // ── Resolve hành khách của TỪNG phòng vật lý cho tour bookings ────────
    const _resolvedRm = await _resolveBookingPassengers(allBookings);
    const rmPaxMap  = _resolvedRm.paxMap;
    const rmModeMap = _resolvedRm.modeMap;

    // Multi-occupant: gom assignments theo holdBookingId để biết tất cả khách
    // share cùng 1 phòng vật lý (TH).
    const rmSegIds = [...new Set(allBookings.filter(b => b.tourSegmentId).map(b => String(b.tourSegmentId)))];
    const rmAssignsByThId = {}; // thId -> assignee[]
    if (rmSegIds.length) {
      const rmSegs = await TourSegment.find({ _id: { $in: rmSegIds } })
        .select("assignments")
        .lean();
      for (const seg of rmSegs) {
        for (const a of seg.assignments || []) {
          if (!a.holdBookingId) continue;
          const k = String(a.holdBookingId);
          if (!rmAssignsByThId[k]) rmAssignsByThId[k] = [];
          rmAssignsByThId[k].push({
            guestName:   a.guestName || "",
            phone:       a.phone || "",
            orderCode:   a.orderCode || "",
            guestStatus: a.guestStatus || "confirmed",
          });
        }
      }
    }

    // Map roomId -> array of ALL bookings (để hiển thị trong modal)
    const roomBookingsMap = {};
    allBookings.forEach(b => {
      if (b.roomId) {
        const roomIdStr = String(b.roomId);
        if (!roomBookingsMap[roomIdStr]) {
          roomBookingsMap[roomIdStr] = [];
        }
        let roomsDetails = [];
        if (b.roomsData) {
          try {
            const parsedRoomsData = JSON.parse(decodeURIComponent(b.roomsData));
            if (Array.isArray(parsedRoomsData)) {
              const roomNumberMatch = b.code.match(/-R(\d+)(-\d+)?$/);
              if (roomNumberMatch && b.rooms === 1) {
                const roomIndex = parseInt(roomNumberMatch[1], 10) - 1;
                roomsDetails = buildAdminRoomsDetailsDisplay(parsedRoomsData, {
                  onlyRoomIndex: roomIndex,
                });
              } else {
                roomsDetails = buildAdminRoomsDetailsDisplay(parsedRoomsData);
              }
            }
          } catch (e) {
            console.warn('Failed to parse roomsData in roomManagement:', e);
          }
        }

        const isTourHold    = !!b.tourSegmentId;
        const guestAssigned = isTourHold && b.guest?.fullName && b.guest.fullName !== "[Tour Hold]";
        const segInfo       = isTourHold ? (segmentInfoMap[String(b.tourSegmentId)] || null) : null;

        const _bid = String(b._id);
        // Co-occupants (khách ghép cùng phòng)
        const assignees = rmAssignsByThId[_bid] || [];
        const coMap = {};
        for (const a of assignees) {
          const k = a.orderCode || a.guestName;
          if (k && !coMap[k]) coMap[k] = a;
        }
        if (guestAssigned) {
          const k = b.orderCode || (b.guest?.fullName || "");
          if (k && !coMap[k]) {
            coMap[k] = {
              guestName: b.guest?.fullName || "",
              phone: b.guest?.phone || "",
              orderCode: b.orderCode || "",
              guestStatus: b.status || "confirmed",
            };
          }
        }
        const coOccupants = Object.values(coMap);

        roomBookingsMap[roomIdStr].push({
          bookingId:     _bid,
          code:          b.code,
          customerName:  b.guest?.fullName || "Khách",
          customerPhone: b.guest?.phone || "",
          checkIn:       b.checkIn  ? moment(b.checkIn).format("DD/MM/YYYY")  : "",
          checkOut:      b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "",
          status:        b.status,
          rooms:         b.rooms || 1,
          roomsDetails:  roomsDetails,
          isTourHold,
          tourAssigned:  guestAssigned,
          tourName:      segInfo ? segInfo.tourName      : "",
          tourDeparture: segInfo ? segInfo.departureDate : "",
          tourEndDate:   segInfo ? segInfo.endDate       : "",
          tourCompanyDisplay: segInfo ? segInfo.tourCompanyDisplay : "",
          note:          b.note || "",
          roomPassengers:    rmPaxMap[_bid]  || [],
          accommodationMode: rmModeMap[_bid] || (b.tourSegmentId ? "shared" : ""),
          coOccupants,
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
      groupedPendingBookings,
      rooms: formattedRooms,
      hotels,
      selectedHotelId,
      activeTab: "room-management",
      filterFrom: filterFrom || "",
      filterTo:   filterTo   || "",
      isFiltered: !!(filterFrom || filterTo),
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Quản lý số phòng",
      bookingsData,
      selectedHotelId,
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

    // Lấy tất cả bookings còn hiệu lực của khách sạn (trừ booking gốc và trừ cancelled/checked_out)
    const { hasTimeOverlap } = require("../../helpers/hotel-availability.helper");
    const allBookings = await HotelBooking.find({
      "hotel.hotelId": hotel._id,
      status: { $nin: ["cancelled", "checked_out"] },
      _id: { $ne: originalBooking._id },
    }).lean();

    // Validate tất cả roomIds — kiểm tra trực tiếp từng phòng cụ thể
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

      // Kiểm tra phòng có bị đặt cụ thể (roomId khớp) trong khoảng thời gian này không
      const hasConflict = allBookings.some(b =>
        b.roomId &&
        String(b.roomId) === String(roomId) &&
        hasTimeOverlap(originalBooking.checkIn, originalBooking.checkOut, b.checkIn, b.checkOut)
      );

      if (hasConflict) {
        return res.json({
          code: "error",
          message: `Phòng ${room.number || room.roomNumber} đã được đặt trong khoảng thời gian này!`,
        });
      }
    }

    // Helper: lấy số phòng vật lý từ hotel
    const _getRoomNumber = (roomId) => {
      const r = hotel.rooms?.find((r) => String(r._id) === String(roomId));
      return r ? (r.number || r.roomNumber || String(roomId)) : String(roomId);
    };

    // Nếu chỉ có 1 phòng, update booking gốc
    if (roomIds.length === 1) {
      originalBooking.roomId = roomIds[0];
      originalBooking.rooms = 1;
      // Giữ nguyên status hiện tại (pending, checked_in, checked_out, cancelled)
      await originalBooking.save();

      // Gửi thông báo cho khách
      try {
        const roomNumber = _getRoomNumber(roomIds[0]);
        const baseCode = originalBooking.code.replace(/-R\d+(-\d+)?$/, "").replace(/-\d+$/, "");
        await notifyCustomerOrderUpdate({
          userId: originalBooking.userId,
          email: originalBooking.guest?.email,
          customerName: originalBooking.guest?.fullName,
          type: "hotel_booking",
          resourceLabel: baseCode,
          bookingCode: baseCode,
          link: buildHotelBookingProfileLink(baseCode),
          changes: [
            {
              field: "roomNumber",
              label: "Số phòng được xếp",
              from: "",
              to: `Phòng ${roomNumber}`,
            },
          ],
          introLine: `Khách sạn ${hotel.name || ""} đã xếp phòng cho đặt phòng của bạn.`,
        });
      } catch (e) {
        console.error("[assignRoom] notify:", e);
      }

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
        pricePerNight: originalBooking.pricePerNight || 0,
        totalNights: originalBooking.totalNights || 0,
        totalAmount: (originalBooking.pricePerNight || 0) * (originalBooking.totalNights || 0),
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

    // Gửi thông báo cho khách (nhiều phòng)
    try {
      const roomNumbers = roomIds.map((id) => _getRoomNumber(id)).join(", ");
      const baseCode = originalBooking.code.replace(/-R\d+(-\d+)?$/, "").replace(/-\d+$/, "");
      await notifyCustomerOrderUpdate({
        userId: originalBooking.userId,
        email: originalBooking.guest?.email,
        customerName: originalBooking.guest?.fullName,
        type: "hotel_booking",
        resourceLabel: baseCode,
        bookingCode: baseCode,
        link: buildHotelBookingProfileLink(baseCode),
        changes: [
          {
            field: "roomNumber",
            label: "Số phòng được xếp",
            from: "",
            to: `Phòng ${roomNumbers}`,
          },
        ],
        introLine: `Khách sạn ${hotel.name || ""} đã xếp ${roomIds.length} phòng cho đặt phòng của bạn.`,
      });
    } catch (e) {
      console.error("[assignRoom multi] notify:", e);
    }

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
 * POST /admin/hotel/booking/unassign-room
 * Huỷ xếp phòng: xoá roomId khỏi booking, booking trở về danh sách cần xếp phòng
 */
module.exports.unassignRoom = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const companyId = req.account?.companyId || null;

    if (!bookingId) {
      return res.json({ code: "error", message: "Thiếu thông tin booking!" });
    }

    const booking = await HotelBooking.findById(bookingId);
    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy booking!" });
    }

    // Xác nhận khách sạn thuộc công ty này
    const hotel = await Hotel.findOne({
      _id: booking.hotel?.hotelId,
      companyId,
      deleted: false,
    });
    if (!hotel) {
      return res.json({ code: "error", message: "Không có quyền truy cập khách sạn này!" });
    }

    // Không cho phép huỷ khi khách đã nhận/trả phòng
    if (booking.status === "checked_in" || booking.status === "checked_out") {
      return res.json({
        code: "error",
        message: "Không thể huỷ xếp phòng khi khách đã nhận phòng hoặc đã trả phòng!",
      });
    }

    booking.roomId = null;
    await booking.save();

    return res.json({ code: "success", message: "Đã huỷ xếp phòng thành công!" });
  } catch (error) {
    console.error("unassignRoom error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi huỷ xếp phòng!" });
  }
};

/**
 * GET /admin/hotel/booking/change-room?hotelId=...
 * Hiển thị các booking đã được xếp phòng để admin đổi số phòng nếu xếp nhầm.
 */
module.exports.changeRoom = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;

    const baseRender = (extra = {}) =>
      res.render("admin/pages/hotel-booking", {
        pageTitle: "Thay đổi phòng",
        bookingsData: {
          assignedBookings: [],
          groupedAssignedBookings: [],
          rooms: [],
          hotels: [],
          activeTab: "change-room",
          ...extra,
        },
        selectedHotelId: extra.selectedHotelId || null,
        pathAdmin,
        isBookingManagement: true,
      });

    if (!companyId) return baseRender();

    let hotelId = req.query.hotelId || null;
    const hotels = await Hotel.find({ companyId, deleted: false })
      .select("_id name rooms roomTypes")
      .lean();

    if (!hotels || hotels.length === 0) return baseRender({ hotels: [] });

    if (!hotelId || hotelId === "all") {
      hotelId = String(hotels[0]._id);
      return res.redirect(
        `/${pathAdmin}/hotel/booking/change-room?hotelId=${hotelId}`
      );
    }

    const selectedHotelId = hotelId;
    const selectedHotel = hotels.find(
      (h) => String(h._id) === selectedHotelId
    );

    if (!selectedHotel) {
      return baseRender({ hotels, selectedHotelId });
    }

    const rooms = (selectedHotel.rooms || []).slice().sort((a, b) => {
      const floorA = parseInt(String(a.floor).replace(/\D/g, "")) || 0;
      const floorB = parseInt(String(b.floor).replace(/\D/g, "")) || 0;
      if (floorA !== floorB) return floorA - floorB;
      const numA = parseInt(String(a.roomNumber).replace(/\D/g, "")) || 0;
      const numB = parseInt(String(b.roomNumber).replace(/\D/g, "")) || 0;
      return numA - numB;
    });

    // Lấy tất cả booking đã được xếp phòng và CHƯA nhận / trả phòng / huỷ.
    // Chỉ cho phép đổi khi khách chưa thực sự dùng phòng.
    let assignedBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      roomId: { $ne: null },
      status: { $nin: ["cancelled", "checked_out", "checked_in"] },
      tourSegmentId: null,
    })
      .sort({ createdAt: -1 })
      .lean();

    assignedBookings = await _filterBookingsByLiveOrder(assignedBookings);

    const roomMap = {};
    rooms.forEach((r) => {
      roomMap[String(r._id)] = r;
    });
    const roomTypeMap = {};
    (selectedHotel.roomTypes || []).forEach((rt) => {
      roomTypeMap[String(rt._id)] = rt;
    });

    const formattedAssigned = assignedBookings.map((b) => {
      const room = roomMap[String(b.roomId)] || null;
      const rt = roomTypeMap[String(b.roomTypeId)] || null;
      return {
        bookingId: String(b._id),
        code: b.code,
        customerName: b.guest?.fullName || "Khách lẻ",
        customerPhone: b.guest?.phone || "",
        roomId: String(b.roomId),
        roomNumber: room?.number || room?.roomNumber || "—",
        roomFloor: room?.floor || "",
        roomType: rt?.name || rt?.title || "Loại phòng",
        roomTypeId: String(b.roomTypeId || ""),
        checkIn: b.checkIn ? moment(b.checkIn).format("YYYY-MM-DD") : "",
        checkInDisplay: b.checkIn
          ? moment(b.checkIn).format("DD/MM/YYYY")
          : "",
        checkOut: b.checkOut ? moment(b.checkOut).format("YYYY-MM-DD") : "",
        checkOutDisplay: b.checkOut
          ? moment(b.checkOut).format("DD/MM/YYYY")
          : "",
        status: b.status,
      };
    });

    // Gom theo base code đơn gốc (HB123, HB123-1, HB123-R1 → HB123)
    const groupMap = {};
    formattedAssigned.forEach((b) => {
      let baseCode = b.code.replace(/-R\d+(-\d+)?$/, "");
      while (baseCode.match(/-\d+$/)) baseCode = baseCode.replace(/-\d+$/, "");
      if (!groupMap[baseCode]) {
        groupMap[baseCode] = {
          baseCode,
          customerName: b.customerName,
          checkInDisplay: b.checkInDisplay,
          checkOutDisplay: b.checkOutDisplay,
          bookings: [],
        };
      }
      groupMap[baseCode].bookings.push(b);
    });
    const groupedAssignedBookings = Object.values(groupMap).map((g) => ({
      ...g,
      totalRooms: g.bookings.length,
      roomTypesSummary: (() => {
        const counter = {};
        g.bookings.forEach((b) => {
          counter[b.roomType] = (counter[b.roomType] || 0) + 1;
        });
        return Object.entries(counter)
          .map(([rt, c]) => `${rt} × ${c}`)
          .join(", ");
      })(),
    }));

    // Lấy tất cả bookings còn hiệu lực để build bản đồ phòng (loại trừ cancelled/checked_out)
    let allBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotel._id,
      roomId: { $ne: null },
      status: { $nin: ["cancelled", "checked_out"] },
    }).lean();
    allBookings = await _filterBookingsByLiveOrder(allBookings);

    const roomBookingsMap = {};
    allBookings.forEach((b) => {
      const k = String(b.roomId);
      if (!roomBookingsMap[k]) roomBookingsMap[k] = [];
      roomBookingsMap[k].push({
        bookingId: String(b._id),
        code: b.code,
        customerName: b.guest?.fullName || "Khách",
        checkIn: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "",
        checkOut: b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "",
        status: b.status,
      });
    });

    const formattedRooms = rooms.map((room) => {
      const rt = roomTypeMap[String(room.roomTypeId)] || null;
      const roomBookings = roomBookingsMap[String(room._id)] || [];
      return {
        _id: String(room._id),
        number: room.number || room.roomNumber || "N/A",
        roomType: rt?.name || "N/A",
        roomTypeId: String(room.roomTypeId || ""),
        floor: room.floor || "1",
        bookingCount: roomBookings.length,
        bookings: roomBookings,
      };
    });

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Thay đổi phòng",
      bookingsData: {
        assignedBookings: formattedAssigned,
        groupedAssignedBookings,
        rooms: formattedRooms,
        hotels,
        selectedHotelId,
        activeTab: "change-room",
      },
      selectedHotelId,
      pathAdmin,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel changeRoom error:", error);
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Thay đổi phòng",
      bookingsData: {
        assignedBookings: [],
        groupedAssignedBookings: [],
        rooms: [],
        activeTab: "change-room",
      },
      pathAdmin,
      isBookingManagement: true,
    });
  }
};

/**
 * POST /admin/hotel/booking/reassign-room
 * Đổi phòng đã xếp sang một phòng vật lý khác cùng loại, không trùng lịch.
 */
module.exports.reassignRoom = async (req, res) => {
  try {
    const { bookingId, newRoomId } = req.body;
    const companyId = req.account?.companyId || null;

    if (!bookingId || !newRoomId) {
      return res.json({
        code: "error",
        message: "Thiếu thông tin booking hoặc phòng mới!",
      });
    }

    const booking = await HotelBooking.findById(bookingId);
    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy booking!" });
    }

    if (!booking.roomId) {
      return res.json({
        code: "error",
        message: "Booking này chưa được xếp phòng, không thể đổi!",
      });
    }

    if (String(booking.roomId) === String(newRoomId)) {
      return res.json({
        code: "error",
        message: "Phòng mới trùng với phòng hiện tại!",
      });
    }

    if (
      booking.status === "checked_in" ||
      booking.status === "checked_out" ||
      booking.status === "cancelled"
    ) {
      return res.json({
        code: "error",
        message:
          "Không thể đổi phòng khi khách đã nhận, đã trả phòng hoặc đơn đã huỷ!",
      });
    }

    const hotel = await Hotel.findOne({
      _id: booking.hotel?.hotelId,
      companyId,
      deleted: false,
    });
    if (!hotel) {
      return res.json({
        code: "error",
        message: "Không có quyền truy cập khách sạn này!",
      });
    }

    const newRoom = hotel.rooms?.find(
      (r) => String(r._id) === String(newRoomId)
    );
    if (!newRoom) {
      return res.json({
        code: "error",
        message: "Không tìm thấy phòng mới trong khách sạn!",
      });
    }

    if (String(newRoom.roomTypeId) !== String(booking.roomTypeId)) {
      return res.json({
        code: "error",
        message: `Phòng ${newRoom.number || newRoom.roomNumber} không cùng loại với booking!`,
      });
    }

    const { hasTimeOverlap } = require("../../helpers/hotel-availability.helper");
    const otherBookings = await HotelBooking.find({
      "hotel.hotelId": hotel._id,
      status: { $nin: ["cancelled", "checked_out"] },
      _id: { $ne: booking._id },
      roomId: newRoom._id,
    }).lean();

    const conflict = otherBookings.find((b) =>
      hasTimeOverlap(booking.checkIn, booking.checkOut, b.checkIn, b.checkOut)
    );
    if (conflict) {
      return res.json({
        code: "error",
        message: `Phòng ${newRoom.number || newRoom.roomNumber} đã có booking khác (${conflict.code}) trong khoảng thời gian này!`,
      });
    }

    const oldRoomObj = hotel.rooms?.find((r) => String(r._id) === String(booking.roomId));
    const oldRoomNumber = oldRoomObj ? (oldRoomObj.number || oldRoomObj.roomNumber || "—") : "—";
    const newRoomNumber = newRoom.number || newRoom.roomNumber;

    booking.roomId = newRoom._id;
    await booking.save();

    // Gửi thông báo cho khách
    try {
      let baseCode = booking.code.replace(/-R\d+(-\d+)?$/, "");
      while (baseCode.match(/-\d+$/)) baseCode = baseCode.replace(/-\d+$/, "");
      await notifyCustomerOrderUpdate({
        userId: booking.userId,
        email: booking.guest?.email,
        customerName: booking.guest?.fullName,
        type: "hotel_booking",
        resourceLabel: baseCode,
        bookingCode: baseCode,
        link: buildHotelBookingProfileLink(baseCode),
        changes: [
          {
            field: "roomNumber",
            label: "Số phòng",
            from: `Phòng ${oldRoomNumber}`,
            to: `Phòng ${newRoomNumber}`,
          },
        ],
        introLine: `Khách sạn ${hotel.name || ""} đã thay đổi số phòng cho đặt phòng của bạn.`,
      });
    } catch (e) {
      console.error("[reassignRoom] notify:", e);
    }

    return res.json({
      code: "success",
      message: `Đã đổi sang phòng ${newRoomNumber} thành công!`,
    });
  } catch (error) {
    console.error("reassignRoom error:", error);
    return res.json({
      code: "error",
      message: "Có lỗi xảy ra khi đổi phòng!",
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

    const auditBefore = {
      status: booking.status,
      paymentStatus: booking.paymentStatus,
    };

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

    // Đồng bộ guestStatus trên TourSegment.assignments (profile khách đọc field này).
    if (status && booking.tourSegmentId) {
      const TourSegment = require("../../models/tour-segment.model");
      const segDoc = await TourSegment.findById(booking.tourSegmentId).select(
        "assignments"
      );
      if (segDoc) {
        let assignChanged = false;
        const holdIds = new Set(
          allBookingsInGroup.map((b) => String(b._id))
        );
        for (const a of segDoc.assignments || []) {
          if (a.holdBookingId && holdIds.has(String(a.holdBookingId))) {
            a.guestStatus = status;
            assignChanged = true;
          }
        }
        if (assignChanged) await segDoc.save();
      }
    }

    auditLogHelper.log(req, {
      action: "hotel-booking.update-status",
      resourceType: "HotelBooking",
      resourceId: booking._id,
      resourceLabel: booking.code || "",
      before: auditBefore,
      after: {
        status: status || booking.status,
        paymentStatus: paymentStatus || booking.paymentStatus,
      },
      summary: `Cập nhật booking "${booking.code || ""}" (${allBookingsInGroup.length} bản ghi cùng nhóm)`,
      metadata: { groupSize: allBookingsInGroup.length },
    });

    const afterState = {
      status: status || booking.status,
      paymentStatus: paymentStatus || booking.paymentStatus,
    };
    const changes = diffChanges(auditBefore, afterState, ["status", "paymentStatus"], {
      type: "hotel_booking",
    });
    if (changes.length > 0) {
      let baseCode2 = booking.code;
      baseCode2 = baseCode2.replace(/-R\d+(-\d+)?$/, "");
      while (baseCode2.match(/-\d+$/)) {
        baseCode2 = baseCode2.replace(/-\d+$/, "");
      }
      try {
        // Ưu tiên: nếu booking là TOUR (có tourSegmentId hoặc orderCode) thì
        // route notification qua tour-flow để link vào tab "upcoming" của
        // profile và lấy userId từ Order (booking.userId có thể null với
        // đơn cũ / khách đặt khi chưa login).
        const isTourBooking = !!(booking.tourSegmentId || booking.orderCode);
        if (!isTourBooking && (booking.userId || booking.guest?.email)) {
          // Booking khách sạn thuần (không qua tour)
          await notifyCustomerOrderUpdate({
            userId: booking.userId,
            email: booking.guest?.email,
            customerName: booking.guest?.fullName,
            type: "hotel_booking",
            resourceLabel: baseCode2,
            bookingCode: baseCode2,
            link: buildHotelBookingProfileLink(baseCode2),
            changes,
            introLine: "Đặt phòng của bạn đã được cập nhật bởi khách sạn.",
          });
        } else if (isTourBooking) {
          // Tour booking — gom mọi order liên quan và gửi notify dạng tour_assignment
          const TourSegment = require("../../models/tour-segment.model");
          const Order = require("../../models/order.model");
          let seg = null;
          if (booking.tourSegmentId) {
            seg = await TourSegment.findById(booking.tourSegmentId)
              .select("assignments departureDate tourId")
              .lean();
          }
          // Tìm assignments dùng booking này (chỉ shared mới có)
          const affected = seg
            ? (seg.assignments || []).filter(
                (a) => a.holdBookingId && String(a.holdBookingId) === String(booking._id)
              )
            : [];
          const orderIds = [...new Set(affected.map((a) => String(a.orderId)).filter(Boolean))];

          // Lấy tên tour từ TourSegment → Tour (dùng chung cho cả shared và private)
          let tourNameForHold = "";
          if (seg?.tourId) {
            const tourDocH = await require("../../models/tour.model").findById(seg.tourId).select("name").lean();
            tourNameForHold = tourDocH?.name || "";
          }

          {
            if (orderIds.length > 0) {
              const orders = await Order.find({ _id: { $in: orderIds } })
                .select("_id code userId email fullName status items")
                .lean();
              for (const order of orders) {
                const hotelLabel = booking.hotel?.name || "";
                const tourNameUsed = tourNameForHold || (order.items || []).map((i) => i.name).filter(Boolean)[0] || "";
                await notifyCustomerOrderUpdate({
                  userId: order.userId,
                  email: order.email,
                  customerName: order.fullName,
                  type: "tour_assignment",
                  tourName: tourNameUsed,
                  resourceLabel: order.code || baseCode2,
                  orderCode: order.code,
                  orderId: order._id,
                  link: buildTourOrderProfileLink(order.code, order.status),
                  changes: changes.map((c) => ({
                    ...c,
                    label: `Trạng thái phòng${hotelLabel ? " (" + hotelLabel + ")" : ""}`,
                  })),
                  introLine: tourNameUsed
                    ? `Trạng thái phòng tour "${tourNameUsed}" của bạn đã được cập nhật.`
                    : "Trạng thái phòng tour của bạn đã được cập nhật.",
                });
              }
            } else if (booking.orderCode) {
              // Private tour booking: TourSegment.assignments không chứa holdBookingId
              // nên tra trực tiếp Order qua orderCode đã lưu trong HotelBooking
              const order = await Order.findOne({ code: booking.orderCode })
                .select("_id code userId email fullName status items")
                .lean();
              if (order) {
                const hotelLabel   = booking.hotel?.name || "";
                const tourNameUsed = tourNameForHold || (order.items || []).map((i) => i.name).filter(Boolean)[0] || "";
                await notifyCustomerOrderUpdate({
                  userId: order.userId,
                  email: order.email,
                  customerName: order.fullName,
                  type: "tour_assignment",
                  tourName: tourNameUsed,
                  resourceLabel: order.code,
                  orderCode: order.code,
                  orderId: order._id,
                  link: buildTourOrderProfileLink(order.code, order.status),
                  changes: changes.map((c) => ({
                    ...c,
                    label: `Trạng thái phòng${hotelLabel ? " (" + hotelLabel + ")" : ""}`,
                  })),
                  introLine: tourNameUsed
                    ? `Trạng thái phòng tour "${tourNameUsed}" của bạn đã được cập nhật.`
                    : "Trạng thái phòng tour của bạn đã được cập nhật.",
                });
              }
            }
          }
        }
      } catch (notifyErr) {
        console.error("[updateBookingStatus] notify:", notifyErr);
      }
    }

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

/**
 * POST /admin/hotel/booking/update-assignment-status
 * Cập nhật guestStatus riêng của một assignment (per-khách) trong phòng ghép
 * cross-order. Không đụng đến HotelBooking.status của phòng vật lý.
 *
 * Body: { assignmentId, status }
 * assignmentId = _id của entry trong TourSegment.assignments
 */
module.exports.updateAssignmentStatus = async (req, res) => {
  try {
    const TourSegment = require("../../models/tour-segment.model");
    const { assignmentId, status } = req.body;
    const companyId = req.account?.companyId || null;
    const allowed = ["confirmed", "checked_in", "checked_out"];

    if (!assignmentId || !status || !allowed.includes(status)) {
      return res.json({ code: "error", message: "Thiếu thông tin hoặc trạng thái không hợp lệ!" });
    }

    // Tìm TourSegment chứa assignment này (thuộc company của hotel)
    const seg = await TourSegment.findOne({
      "assignments._id": assignmentId,
    }).select("_id assignments companyId tourId");

    if (!seg) {
      return res.json({ code: "error", message: "Không tìm thấy phân công này!" });
    }

    // Kiểm tra quyền: hotel thuộc company hiện tại
    const assign = seg.assignments.id(assignmentId);
    if (!assign) {
      return res.json({ code: "error", message: "Không tìm thấy phân công này!" });
    }
    const hotelBelongs = await Hotel.findOne({
      _id: assign.hotelId,
      companyId,
      deleted: false,
    });
    if (!hotelBelongs) {
      return res.json({ code: "error", message: "Không có quyền thao tác!" });
    }

    const beforeGuestStatus = assign.guestStatus || "confirmed";

    // Cập nhật guestStatus cho entry này
    assign.guestStatus = status;
    await seg.save();

    const changes = diffChanges(
      { guestStatus: beforeGuestStatus },
      { guestStatus: status },
      ["guestStatus"]
    );
    if (changes.length > 0 && assign.orderId) {
      try {
        const Order = require("../../models/order.model");
        const Tour   = require("../../models/tour.model");
        const order = await Order.findById(assign.orderId)
          .select("code userId email fullName status items")
          .lean();
        if (order) {
          // Lấy tên tour: ưu tiên từ Order.items, fallback sang Tour model
          let tourName = (order.items || []).find(
            (i) => i.tourSegmentId && String(i.tourSegmentId) === String(seg._id)
          )?.name || (order.items || [])[0]?.name || "";
          if (!tourName && seg.tourId) {
            const tourDoc = await Tour.findById(seg.tourId).select("name").lean();
            tourName = tourDoc?.name || "";
          }

          // Bổ sung thông tin phòng vào từng dòng thay đổi
          const roomDetail = [
            assign.hotelName  || "",
            assign.roomNumber ? `Phòng ${assign.roomNumber}` : "",
            assign.roomTypeName || "",
          ].filter(Boolean).join(" — ");

          const enrichedChanges = changes.map((c) => ({
            ...c,
            label: roomDetail
              ? `Trạng thái lưu trú (${roomDetail})`
              : "Trạng thái lưu trú",
          }));

          await notifyCustomerOrderUpdate({
            userId: order.userId,
            email: order.email,
            customerName: order.fullName || assign.guestName,
            type: "tour_assignment",
            tourName,
            resourceLabel: order.code || assign.orderCode,
            orderCode: order.code,
            orderId: order._id,
            link: buildTourOrderProfileLink(order.code, order.status),
            changes: enrichedChanges,
            introLine: tourName
              ? `Trạng thái lưu trú tour "${tourName}" của bạn đã được cập nhật.`
              : "Trạng thái lưu trú tour của bạn đã được cập nhật.",
          });
        }
      } catch (notifyErr) {
        console.error("[updateAssignmentStatus] notify:", notifyErr);
      }
    }

    return res.json({ code: "success", message: "Cập nhật trạng thái thành công!" });
  } catch (err) {
    console.error("[updateAssignmentStatus]", err);
    return res.json({ code: "error", message: "Có lỗi xảy ra!" });
  }
};

/**
 * PATCH /admin/hotel/booking/update-guest/:bookingCode
 * Cập nhật thông tin khách hàng (fullName, phone, email) cho toàn bộ group booking.
 */
module.exports.updateGuestInfo = async (req, res) => {
  try {
    const { bookingCode } = req.params;
    const { fullName, phone, email } = req.body;
    const companyId = req.account?.companyId || null;

    if (!bookingCode || !fullName) {
      return res.json({ code: "error", message: "Thiếu thông tin bắt buộc!" });
    }

    // Lấy base code (loại bỏ suffix -1, -R1, v.v.)
    let baseCode = bookingCode.replace(/-R\d+(-\d+)?$/, "");
    while (baseCode.match(/-\d+$/)) {
      baseCode = baseCode.replace(/-\d+$/, "");
    }

    // Tìm tất cả bookings trong group
    const bookings = await HotelBooking.find({
      code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+)?(-\\d+)?$`),
    });

    if (!bookings || bookings.length === 0) {
      return res.json({ code: "error", message: "Không tìm thấy đơn đặt phòng!" });
    }

    // Kiểm tra quyền (hotel phải thuộc company của admin)
    const hotel = await Hotel.findOne({
      _id: bookings[0].hotel.hotelId,
      companyId,
      deleted: false,
    });
    if (!hotel) {
      return res.json({ code: "error", message: "Không có quyền truy cập!" });
    }

    const firstBooking = bookings[0];
    const guestBefore = {
      fullName: firstBooking.guest?.fullName || "",
      phone: firstBooking.guest?.phone || "",
      email: firstBooking.guest?.email || "",
    };
    const guestAfter = {
      fullName: fullName || "",
      phone: phone || "",
      email: email || "",
    };

    // Cập nhật thông tin khách cho tất cả bookings trong group
    await HotelBooking.updateMany(
      { code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+)?(-\\d+)?$`) },
      {
        $set: {
          "guest.fullName": fullName,
          "guest.phone":    phone  || "",
          "guest.email":    email  || "",
        },
      }
    );

    const changes = diffChanges(guestBefore, guestAfter, [
      "fullName",
      "phone",
      "email",
    ]);
    if (changes.length > 0) {
      try {
        await notifyCustomerOrderUpdate({
          userId: firstBooking.userId,
          email: guestAfter.email || guestBefore.email,
          customerName: guestAfter.fullName,
          type: "hotel_booking",
          resourceLabel: baseCode,
          bookingCode: baseCode,
          link: buildHotelBookingProfileLink(baseCode),
          changes,
          introLine:
            "Thông tin liên hệ đặt phòng của bạn đã được cập nhật.",
        });
      } catch (notifyErr) {
        console.error("[updateGuestInfo] notify:", notifyErr);
      }
    }

    return res.json({ code: "success", message: "Cập nhật thông tin khách thành công!" });
  } catch (err) {
    console.error("updateGuestInfo error:", err);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi cập nhật!" });
  }
};

/**
 * POST /admin/hotel/booking/delete
 * Xóa toàn bộ booking group (theo base code) khỏi DB.
 * Chỉ cho phép xóa khi chưa check-in (pending / confirmed / cancelled).
 */
module.exports.deleteBooking = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const companyId = req.account?.companyId || null;

    if (!bookingId) {
      return res.json({ code: "error", message: "Thiếu thông tin booking!" });
    }

    const booking = await HotelBooking.findById(bookingId);
    if (!booking) {
      return res.json({ code: "error", message: "Không tìm thấy đơn đặt phòng!" });
    }

    // Kiểm tra quyền theo công ty
    const hotel = await Hotel.findOne({
      _id: booking.hotel?.hotelId,
      companyId,
      deleted: false,
    });
    if (!hotel) {
      return res.json({ code: "error", message: "Không có quyền truy cập đơn đặt phòng này!" });
    }

    // Không cho xóa khi khách đang ở trong phòng
    if (booking.status === "checked_in") {
      return res.json({ code: "error", message: "Không thể xóa đơn khi khách đang nhận phòng!" });
    }

    // Tìm toàn bộ booking cùng group (cùng base code) để xóa hết
    let baseCode = booking.code
      .replace(/-R\d+(-\d+)?$/, "")
      .replace(/-\d+$/, "");
    while (baseCode.match(/-\d+$/)) {
      baseCode = baseCode.replace(/-\d+$/, "");
    }

    await HotelBooking.deleteMany({
      code: new RegExp(`^${baseCode}(-\\d+)?(-R\\d+)?(-\\d+)?$`),
    });

    return res.json({ code: "success", message: "Đã xóa đơn đặt phòng thành công!" });
  } catch (error) {
    console.error("deleteBooking error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi xóa đơn đặt phòng!" });
  }
};

module.exports.releaseHolds = async (req, res) => {
  try {
    if (
      req.account &&
      !req.account.isSuperAdmin &&
      req.account.tabAccessScope === "hotel_staff"
    ) {
      return res.json({
        code: "error",
        message: "Bạn không có quyền giải phóng phòng giữ tour.",
      });
    }

    const { bookingIds } = req.body;
    const companyId = req.account?.companyId || null;

    if (!companyId) {
      return res.json({ code: "error", message: "Không xác định được công ty!" });
    }
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.json({ code: "error", message: "Danh sách booking rỗng!" });
    }

    // Lấy danh sách hotel thuộc công ty để verify quyền
    const companyHotels = await Hotel.find({ companyId, deleted: false }).select("_id").lean();
    const companyHotelIds = new Set(companyHotels.map((h) => String(h._id)));

    // Tìm các booking phù hợp để giải phóng
    const bookings = await HotelBooking.find({
      _id: { $in: bookingIds },
      tourSegmentId: { $ne: null, $exists: true },
      "guest.fullName": "[Tour Hold]",
      status: { $nin: ["cancelled", "checked_in", "checked_out"] },
    });

    // Chỉ cancel những booking thuộc hotel của công ty hiện tại
    let released = 0;
    for (const booking of bookings) {
      if (companyHotelIds.has(String(booking.hotel?.hotelId))) {
        booking.status = "cancelled";
        await booking.save();
        released++;
      }
    }

    return res.json({
      code: "success",
      message: `Đã giải phóng ${released} phòng thành công!`,
      released,
    });
  } catch (error) {
    console.error("releaseHolds error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi giải phóng phòng!" });
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

    // Self-heal: cascade-cancel các tour hold còn dính tour đã bị xoá mềm
    // nhưng chưa được giải phóng (do xoá trước khi tính năng cascade ra đời).
    await _autoReleaseStaleDeletedTourHolds(companyId);

    // Lấy TẤT CẢ bookings trong tháng đã được assign phòng cụ thể (gồm cả tour holds và checked_out)
    let bookings = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      checkIn:  { $lte: endOfMonth },
      checkOut: { $gte: startOfMonth },
      status:   { $ne: "cancelled" },
      roomId:   { $ne: null },
    })
      .select("code orderCode guest hotel checkIn checkOut status roomId roomTypeId tourSegmentId note")
      .lean();
    bookings = await _filterBookingsByLiveOrder(bookings);

    // ── Lấy thông tin tour cho tour hold bookings ────────────────────────────────
    const TourSegment = require("../../models/tour-segment.model");
    const Tour        = require("../../models/tour.model");

    // Tìm tất cả tourSegmentId xuất hiện trong tháng
    let tourHoldBookingsRaw = await HotelBooking.find({
      "hotel.hotelId": hotelId,
      checkIn:  { $lte: endOfMonth },
      checkOut: { $gte: startOfMonth },
      status:   { $nin: ["cancelled", "checked_out"] },
      tourSegmentId: { $ne: null, $exists: true },
      code:     { $ne: null },
    })
      .select("tourSegmentId orderCode checkIn checkOut rooms adults roomTypeId")
      .lean();
    tourHoldBookingsRaw = await _filterBookingsByLiveOrder(tourHoldBookingsRaw);

    // Tạo map: segmentId → { tourName, shortCode, segments[] }
    const segIds = [...new Set(tourHoldBookingsRaw.map(b => String(b.tourSegmentId)))];
    const tourSegDocs = segIds.length
      ? await TourSegment.find({ _id: { $in: segIds } }).select("tourId departureDate endDate segments companyId").lean()
      : [];
    const tourDocIds = [...new Set(tourSegDocs.map(s => String(s.tourId)))];
    const tourDocs   = tourDocIds.length
      ? await Tour.find({ _id: { $in: tourDocIds } }).select("name customId").lean()
      : [];

    const tourNameMap = {};
    const tourDocMap = {};
    tourDocs.forEach((t) => {
      tourDocMap[String(t._id)] = t;
      tourNameMap[String(t._id)] = t.name;
    });

    // Lấy tên công ty sở hữu tour (cho phân biệt cùng/khác company)
    const Company = require("../../models/company.model");
    const allCalCompanyIds = [...new Set([String(companyId), ...tourSegDocs.map(s => String(s.companyId)).filter(Boolean)])];
    const tourSegCompanies = allCalCompanyIds.length
      ? await Company.find({ _id: { $in: allCalCompanyIds } }).select("name").lean()
      : [];
    const tourSegCompanyNameMap = {};
    tourSegCompanies.forEach(c => { tourSegCompanyNameMap[String(c._id)] = c.name || ""; });
    const ownCompanyName = tourSegCompanyNameMap[String(companyId)] || "";

    // Xây dựng tourSegmentInfoMap: segId → { tourName, shortCode, timeSegments[], isOwnCompany, companyName }
    const tourSegmentInfoMap = {};
    tourSegDocs.forEach((seg) => {
      const tourDoc = tourDocMap[String(seg.tourId)];
      const tourName  = tourNameMap[String(seg.tourId)] || "Tour";
      const shortCode = getTourDisplayIdHash(tourDoc || { _id: seg.tourId });
      const segCompanyId = String(seg.companyId || "");
      const isOwnCompany = segCompanyId === String(companyId);
      const companyName = tourSegCompanyNameMap[segCompanyId] || "";

      const timeSegments = (seg.segments || []).map(s => ({
        fromDate: s.fromDate ? moment(s.fromDate).format("DD/MM/YYYY") : "?",
        toDate:   s.toDate   ? moment(s.toDate).format("DD/MM/YYYY")   : "?",
      }));

      tourSegmentInfoMap[String(seg._id)] = { tourName, shortCode, timeSegments, isOwnCompany, companyName };
    });

    // ── Resolve hành khách của TỪNG phòng vật lý cho mỗi tour booking ─────
    const _resolved = await _resolveBookingPassengers(bookings);
    const bookingPaxMap  = _resolved.paxMap;
    const bookingModeMap = _resolved.modeMap;

    // ── Multi-occupant: load tourSeg.assignments để biết tất cả đơn share TH ─
    // Gom theo holdBookingId (= TH booking _id) → [{guestName, phone, orderCode, guestStatus}]
    const calSegIds = [...new Set(bookings.filter(b => b.tourSegmentId).map(b => String(b.tourSegmentId)))];
    const calAssignsByThId = {}; // thId → assignee[]
    if (calSegIds.length) {
      const calSegs = await TourSegment.find({ _id: { $in: calSegIds } })
        .select("assignments")
        .lean();
      for (const seg of calSegs) {
        for (const a of seg.assignments || []) {
          if (!a.holdBookingId) continue;
          const k = String(a.holdBookingId);
          if (!calAssignsByThId[k]) calAssignsByThId[k] = [];
          calAssignsByThId[k].push({
            guestName:   a.guestName || "",
            phone:       a.phone || "",
            orderCode:   a.orderCode || "",
            guestStatus: a.guestStatus || "confirmed",
          });
        }
      }
    }

    // Map roomId -> bookings
    const roomBookingsMap = {};
    bookings.forEach(b => {
      const roomIdStr = String(b.roomId);
      if (!roomBookingsMap[roomIdStr]) roomBookingsMap[roomIdStr] = [];

      const segInfo      = b.tourSegmentId ? tourSegmentInfoMap[String(b.tourSegmentId)] : null;
      const rawGuestName = b.guest?.fullName || "";
      const isAssigned   = !!b.tourSegmentId
        && rawGuestName !== ""
        && rawGuestName !== "[Tour Hold]";

      // Xây coOccupants: gộp primary + các đơn share
      const _bid = String(b._id);
      const assignees = calAssignsByThId[_bid] || [];
      const coMap = {};
      for (const a of assignees) {
        const k = a.orderCode || a.guestName;
        if (k && !coMap[k]) coMap[k] = a;
      }
      if (isAssigned && rawGuestName && rawGuestName !== "[Tour Hold]") {
        const k = b.orderCode || rawGuestName;
        if (!coMap[k]) coMap[k] = { guestName: rawGuestName, phone: b.guest?.phone || "", orderCode: b.orderCode || "", guestStatus: b.status || "confirmed" };
      }
      const coOccupants = Object.values(coMap);

      roomBookingsMap[roomIdStr].push({
        bookingId:       b.code,
        code:            b.code,
        guestName:       rawGuestName || "Khách",
        phone:           b.guest?.phone || "",
        startDate:       b.checkIn,
        endDate:         b.checkOut,
        checkInFmt:      b.checkIn  ? moment(b.checkIn).format("DD/MM/YYYY")  : "",
        checkOutFmt:     b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "",
        status:          b.status,
        isTourHold:      !!b.tourSegmentId,
        isAssigned,
        tourShortCode:   segInfo ? segInfo.shortCode    : null,
        tourName:        segInfo ? segInfo.tourName     : null,
        isOwnCompany:    segInfo ? segInfo.isOwnCompany : true,
        tourCompanyName: segInfo ? segInfo.companyName  : "",
        note:            b.note || "",
        roomPassengers:  bookingPaxMap[_bid] || [],
        accommodationMode: bookingModeMap[_bid] || (b.tourSegmentId ? "shared" : ""),
        coOccupants,
      });
    });

    // Map bookings với phòng
    const roomsWithBookings = allRooms.map(room => ({
      roomNumber: room.roomNumber,
      roomType:   room.roomType,
      bookings:   roomBookingsMap[String(room._id)] || [],
    }));

    // Xây dựng legend cho bảng chú thích dưới lịch
    const tourHoldLegend = Object.entries(tourSegmentInfoMap).map(([segId, info]) => {
      // Tính tổng phòng/người đang giữ của segment này
      const holdBookings = tourHoldBookingsRaw.filter(b => String(b.tourSegmentId) === segId);
      const totalRooms   = holdBookings.reduce((s, b) => s + (b.rooms  || 1), 0);
      const totalPeople  = holdBookings.reduce((s, b) => s + (b.adults || 0), 0);
      return {
        shortCode:    info.shortCode,
        tourName:     info.tourName,
        timeSegments: info.timeSegments,
        totalRooms,
        totalPeople,
        isOwnCompany: info.isOwnCompany,
        companyName:  info.companyName,
      };
    });

    const calendarData = {
      currentMonth:    currentMonthText,
      currentYear:     year,
      currentMonthNum: month,
      rooms:           roomsWithBookings,
      tourHoldLegend,
      activeTab: "calendar"
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Lịch phòng",
      bookingsData: calendarData,
      selectedHotelId: hotelId,
      ownCompanyName,
      pathAdmin,
      moment,
      isBookingManagement: true,
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
    
    const emptyGuestData = { hotelGuests: [], tourGuests: [], guestTab: "hotel", activeTab: "guest-list" };

    if (!companyId) {
      return res.render("admin/pages/hotel-booking", {
        pageTitle: "Danh sách khách hàng",
        bookingsData: emptyGuestData,
        selectedHotelId: null,
        ownCompanyName: "",
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
          bookingsData: emptyGuestData,
          hotelList: [],
          selectedHotelId: null,
          ownCompanyName: "",
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

    // Helper: parse một booking thành row dùng cho cả 2 danh sách
    function parseGuestRow(booking) {
      const roomTypeName = roomTypesMap[String(booking.roomTypeId)] || "Chưa xác định";
      const roomNum = roomsMap[String(booking.roomId)] || "N/A";

      let roomsDetails = [];
      if (booking.roomsData) {
        try { roomsDetails = JSON.parse(decodeURIComponent(booking.roomsData)); } catch (e) {}
      }
      if (!roomsDetails || roomsDetails.length === 0) {
        roomsDetails = [{ adults: booking.adults || 0, children: booking.childrenDetails || [] }];
      }

      let roomDetail = roomsDetails[0] || {};
      const rmMatch = booking.code.match(/-R(\d+)(-\d+)?$/);
      if (rmMatch && roomsDetails.length > 1) {
        const idx = parseInt(rmMatch[1]) - 1;
        if (idx >= 0 && idx < roomsDetails.length) roomDetail = roomsDetails[idx];
      }

      const adults = roomDetail.adults || booking.adults || 0;
      const childrenInRoom = roomDetail.children || booking.childrenDetails || [];
      const childrenCount = Array.isArray(childrenInRoom) ? childrenInRoom.length : (booking.children || 0);

      return {
        bookingCode: booking.code,
        guestName: booking.guest?.fullName || "N/A",
        guestEmail: booking.guest?.email || "N/A",
        guestPhone: booking.guest?.phone || "",
        cccdImages: booking.guest?.cccdImages || [],
        checkInDisplay: moment(booking.checkIn).format("DD/MM/YYYY"),
        checkOutDisplay: moment(booking.checkOut).format("DD/MM/YYYY"),
        roomType: roomTypeName,
        roomNumber: roomNum,
        adults,
        children: childrenCount,
        childrenDetails: Array.isArray(childrenInRoom) ? childrenInRoom : [],
        status: booking.status,
        // Tour-specific (filled later)
        tourName: "",
        tourCode: "",
        tourDeparture: "",
        tourCompanyName: "",
        isOwnCompanyTour: false,
      };
    }

    // ── Danh sách 1: Khách đặt phòng trực tiếp (không liên kết tour) ──
    const hotelBookingFilter = { ...bookingFilter, tourSegmentId: null };
    const hotelBookings = await HotelBooking.find(hotelBookingFilter)
      .select("code guest checkIn checkOut adults children childrenDetails roomId roomTypeId status roomsData tourSegmentId")
      .sort({ checkIn: -1 })
      .lean();
    const hotelGuests = hotelBookings.map(parseGuestRow);

    // ── Danh sách 2: Khách đặt tour liên kết tới khách sạn này ──
    const tourBookingFilter = {
      ...bookingFilter,
      tourSegmentId: { $ne: null, $exists: true },
    };
    const tourBookingsRaw = await HotelBooking.find(tourBookingFilter)
      .select("code guest checkIn checkOut adults children childrenDetails roomId roomTypeId status roomsData tourSegmentId")
      .sort({ checkIn: -1 })
      .lean();
    // Chỉ hiện khi đã gán khách thật — ẩn slot giữ chỗ tour ([Tour Hold])
    const tourBookings = tourBookingsRaw.filter((b) => {
      const name = (b.guest?.fullName || "").trim();
      return name && name !== "[Tour Hold]";
    });

    // Lấy tên tour từ TourSegment → Tour
    const TourSegment = require("../../models/tour-segment.model");
    const Tour        = require("../../models/tour.model");
    const uniqueSegIds = [...new Set(tourBookings.map(b => String(b.tourSegmentId)).filter(Boolean))];
    let segmentNameMap = {}; // segmentId → { tourName, departureDate, tourCompanyName, isOwnCompanyTour }
    let ownCompanyName = "";
    const Company = require("../../models/company.model");
    if (uniqueSegIds.length > 0) {
      const segments = await TourSegment.find({ _id: { $in: uniqueSegIds } })
        .select("tourId departureDate companyId")
        .lean();
      const tourIds = [...new Set(segments.map(s => String(s.tourId)).filter(Boolean))];
      const tours = tourIds.length
        ? await Tour.find({ _id: { $in: tourIds } }).select("_id name").lean()
        : [];
      const tourNameMap = Object.fromEntries(tours.map(t => [String(t._id), t.name]));

      const allGuestCompanyIds = [...new Set([String(companyId), ...segments.map(s => String(s.companyId)).filter(Boolean)])];
      const companies = allGuestCompanyIds.length
        ? await Company.find({ _id: { $in: allGuestCompanyIds } }).select("name").lean()
        : [];
      const companyNameMap = Object.fromEntries(companies.map(c => [String(c._id), c.name || ""]));
      ownCompanyName = companyNameMap[String(companyId)] || "";

      segments.forEach(seg => {
        const segCompanyId = String(seg.companyId || "");
        segmentNameMap[String(seg._id)] = {
          tourName: tourNameMap[String(seg.tourId)] || "Tour",
          departureDate: seg.departureDate ? moment(seg.departureDate).format("DD/MM/YYYY") : "",
          tourCompanyName: companyNameMap[segCompanyId] || "",
          isOwnCompanyTour: segCompanyId === String(companyId),
        };
      });
    }
    if (!ownCompanyName) {
      const co = await Company.findById(companyId).select("name").lean();
      ownCompanyName = co?.name || "";
    }

    const tourGuests = tourBookings.map(b => {
      const row = parseGuestRow(b);
      const segInfo = segmentNameMap[String(b.tourSegmentId)] || {};
      row.tourName = segInfo.tourName || "";
      row.tourDeparture = segInfo.departureDate || "";
      row.tourCompanyName = segInfo.tourCompanyName || "";
      row.isOwnCompanyTour = segInfo.isOwnCompanyTour === true;
      return row;
    });

    const guestListData = {
      hotelGuests,
      tourGuests,
      activeTab: "guest-list",
      guestTab: req.query.guestTab || "hotel", // "hotel" | "tour"
      searchGuestName,
      searchCheckInDate,
      searchCheckOutDate,
    };

    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Danh sách khách hàng",
      bookingsData: guestListData,
      selectedHotelId: hotelId,
      ownCompanyName,
      pathAdmin,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel guest list error:", error);
    return res.render("admin/pages/hotel-booking", {
      pageTitle: "Danh sách khách hàng",
      bookingsData: { 
        hotelGuests: [],
        tourGuests: [],
        guestTab: "hotel",
        activeTab: "guest-list" 
      },
      hotelList: [],
      selectedHotelId: null,
      ownCompanyName: "",
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
        .select("name address _id rooms")
        .sort({ name: 1 })
        .lean();
      
      // Nếu không có hotelId trong URL, redirect đến hotel đầu tiên
      if (!req.query.hotelId && hotelList.length > 0) {
        const firstHotelId = hotelList[0]._id;
        return res.redirect(`/${pathAdmin}/hotel/rooms/list?hotelId=${firstHotelId}`);
      }
      
      // Số phòng = tổng phòng vật lý (hotel.rooms), cùng nguồn với /hotel/:id/rooms/list
      hotelList = hotelList.map(hotel => {
        const roomCount = Array.isArray(hotel.rooms) ? hotel.rooms.length : 0;
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

    const parseFloorNumber = (floor) =>
      parseInt(String(floor || "").replace(/\D/g, ""), 10) || 0;
    
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
      const floorA = parseFloorNumber(a.floor);
      const floorB = parseFloorNumber(b.floor);
      
      if (floorA !== floorB) {
        return floorA - floorB;
      }
      
      const roomA = parseInt(String(a.roomNumber).replace(/\D/g, ""), 10) || 0;
      const roomB = parseInt(String(b.roomNumber).replace(/\D/g, ""), 10) || 0;
      
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

    // Tính summary dựa trên trạng thái thực tế (toàn khách sạn)
    const summary = {
      total: hotelRooms.length,
      vacant: formattedRooms.filter(r => r.status === 'Trống').length,
      inUse: formattedRooms.filter(r => r.status === 'Đang sử dụng').length,
      outOfService: formattedRooms.filter(r => r.status === 'Ngừng hoạt động').length,
      cleaning: formattedRooms.filter(r => r.status === 'Đang dọn').length
    };

    // Phân trang theo tầng — mỗi trang = 1 tầng
    const roomsByFloor = new Map();
    for (const room of formattedRooms) {
      const floorKey = String(room.floor ?? "").trim() || "Chưa xác định";
      if (!roomsByFloor.has(floorKey)) roomsByFloor.set(floorKey, []);
      roomsByFloor.get(floorKey).push(room);
    }

    const floorKeys = [...roomsByFloor.keys()].sort(
      (a, b) => parseFloorNumber(a) - parseFloorNumber(b)
    );

    const totalPages = floorKeys.length;
    const pageParam = parseInt(req.query.page, 10);
    let currentPage = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    if (totalPages > 0 && currentPage > totalPages) currentPage = totalPages;

    const currentFloor = totalPages > 0 ? floorKeys[currentPage - 1] : null;
    const currentFloorRooms = currentFloor
      ? roomsByFloor.get(currentFloor) || []
      : [];

    const floorPagination = {
      currentPage,
      totalPages,
      currentFloor,
      currentFloorRoomCount: currentFloorRooms.length,
      floors: floorKeys.map((floor, idx) => ({
        page: idx + 1,
        floor,
        roomCount: roomsByFloor.get(floor)?.length || 0,
      })),
    };

    const roomsData = {
      rooms: currentFloorRooms,
      summary: summary
    };

    return res.render("admin/pages/hotel-rooms-list", {
      pageTitle: `Danh sách phòng - ${hotel.name}`,
      roomsData,
      floorPagination,
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
    
    // Lấy danh sách room types và số phòng đã có từ hotel đã chọn
    let roomTypes = [];
    let existingRoomNumbers = [];
    if (hotelId && hotelId !== "all") {
      const hotel = await Hotel.findOne({ _id: hotelId, companyId, deleted: false });
      if (hotel) {
        if (hotel.roomTypes) {
          roomTypes = hotel.roomTypes.map(rt => ({
            _id: rt._id,
            name: rt.name
          }));
        }
        if (hotel.rooms) {
          existingRoomNumbers = hotel.rooms.map(r => r.roomNumber);
        }
      }
    }

    return res.render("admin/pages/hotel-room-individual-create", {
      pageTitle: "Thêm phòng mới",
      hotelId: hotelId,
      hotelList: hotelList,
      roomTypes: roomTypes,
      existingRoomNumbers: existingRoomNumbers,
      pathAdmin,
    });
  } catch (error) {
    console.error("hotel room create error:", error);
    return res.render("admin/pages/hotel-room-individual-create", {
      pageTitle: "Thêm phòng mới",
      hotelId: null,
      hotelList: [],
      roomTypes: [],
      existingRoomNumbers: [],
      pathAdmin,
    });
  }
};

module.exports.customersList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    const _emptyCustomers = { hotelCustomers: [], tourCustomers: [], customerTab: "hotel" };
    if (!companyId) {
      return res.render("admin/pages/hotel-customers", {
        pageTitle: "Khách hàng",
        customersData: _emptyCustomers,
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
        customersData: _emptyCustomers,
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

    const TourSegment = require("../../models/tour-segment.model");
    const Tour        = require("../../models/tour.model");
    const customerTab = req.query.customerTab || "hotel";

    // Helper: extract base code
    const extractBaseCode = (code) => {
      let baseCode = code;
      baseCode = baseCode.replace(/-R\d+(-\d+)?$/, '');
      while (baseCode.match(/-\d+$/)) {
        baseCode = baseCode.replace(/-\d+$/, '');
      }
      return baseCode;
    };

    // Helper: initials từ tên
    const getInitials = (name) => {
      const parts = (name || "").split(" ");
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      if (parts[0]?.length >= 2) return parts[0].substring(0, 2).toUpperCase();
      return "KL";
    };

    // Helper: build customer map từ danh sách unique bookings
    const buildCustomerMap = (uniqueBookings) => {
      const map = {};
      uniqueBookings.forEach(b => {
        const guestEmail = b.guest?.email || "";
        const guestPhone = b.guest?.phone || "";
        const guestName  = b.guest?.fullName || "Khách lẻ";
        const key = guestEmail || guestPhone || `guest_${b._id}`;
        if (!map[key]) {
          map[key] = {
            id: key,
            initials: getInitials(guestName),
            name: guestName,
            email: guestEmail || "—",
            phone: guestPhone || "—",
            bookings: 0,
            spending: 0,
            lastActivity: null,
            bookingList: [],
          };
        }
        map[key].bookings += 1;
        map[key].spending += Number(b.orderTotal || b.totalAmount || 0);
        map[key].bookingList.push({
          code:        b.baseCode,
          checkIn:     b.checkIn  ? moment(b.checkIn).format("DD/MM/YYYY")  : "—",
          checkOut:    b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "—",
          totalAmount: Math.round(Number(b.orderTotal || b.totalAmount || 0) / 1000),
          status:      b.status,
          createdAt:   b.createdAt ? moment(b.createdAt).format("DD/MM/YYYY") : "—",
          rooms:       b.totalRooms,
          tourName:    b.tourName     || null,
          tourDeparture: b.tourDeparture || null,
        });
        if (!map[key].lastActivity || b.createdAt > map[key].lastActivity) {
          map[key].lastActivity = b.createdAt;
        }
      });
      return Object.values(map).map(c => ({
        ...c,
        spending:     Math.round(c.spending / 1000),
        lastActivity: c.lastActivity ? moment(c.lastActivity).format("DD/MM/YYYY") : "—",
        isVIP:        c.bookings >= 5 || c.spending >= 5000,
      })).sort((a, b) => b.bookings - a.bookings);
    };

    /** Mã đơn tour trên booking: field orderCode hoặc trích từ note phân công `[TOUR] Đơn #OD…` */
    const extractTourOrderCodeFromBooking = (b) => {
      const oc = b.orderCode && String(b.orderCode).trim();
      if (oc) return oc;
      const note = String(b.note || "");
      const m = note.match(/\[TOUR\]\s*Đơn\s*#\s*([A-Za-z0-9]+)/i);
      return m ? m[1].trim() : "";
    };

    /**
     * Tab «Khách đặt tour liên kết»: email/SĐT/tên ưu tiên từ Order (+ email tài khoản nếu thiếu);
     * chi tiêu = `total` đơn tour khi đã thanh toán (paymentStatus paid hoặc status done).
     */
    const buildTourCustomerMap = (groupedBookings, orderByCode) => {
      const map = {};
      groupedBookings.forEach((b) => {
        const resolvedCode = extractTourOrderCodeFromBooking(b);
        const ord =
          resolvedCode && orderByCode[resolvedCode]
            ? orderByCode[resolvedCode]
            : null;
        const guestEmail =
          (ord?.email && String(ord.email).trim()) ||
          (b.guest?.email && String(b.guest.email).trim()) ||
          "";
        const guestPhone =
          (ord?.phone && String(ord.phone).trim()) ||
          (b.guest?.phone && String(b.guest.phone).trim()) ||
          "";
        const guestName =
          (ord?.fullName && String(ord.fullName).trim()) ||
          (b.guest?.fullName && String(b.guest.fullName).trim()) ||
          "Khách lẻ";
        const key = guestEmail || guestPhone || `guest_${b._id}`;
        if (!map[key]) {
          map[key] = {
            id: key,
            initials: getInitials(guestName),
            name: guestName,
            email: guestEmail || "—",
            phone: guestPhone || "—",
            bookings: 0,
            spendingRaw: 0,
            lastActivity: null,
            bookingList: [],
            _countedOrderCodes: new Set(),
          };
        }
        map[key].bookings += 1;

        const ps = ord ? String(ord.paymentStatus || "").toLowerCase() : "";
        const st = ord ? String(ord.status || "").toLowerCase() : "";
        const paid = ord && (ps === "paid" || st === "done");
        const paidAmountVnd = paid ? Number(ord.total) || 0 : 0;
        if (resolvedCode && paidAmountVnd > 0 && !map[key]._countedOrderCodes.has(resolvedCode)) {
          map[key]._countedOrderCodes.add(resolvedCode);
          map[key].spendingRaw += paidAmountVnd;
        }

        map[key].bookingList.push({
          code: b.baseCode,
          checkIn: b.checkIn ? moment(b.checkIn).format("DD/MM/YYYY") : "—",
          checkOut: b.checkOut ? moment(b.checkOut).format("DD/MM/YYYY") : "—",
          totalAmount: Math.round(paidAmountVnd / 1000),
          orderPaid: paid,
          status: b.status,
          createdAt: b.createdAt ? moment(b.createdAt).format("DD/MM/YYYY") : "—",
          rooms: b.totalRooms,
          tourName: b.tourName || null,
          tourDeparture: b.tourDeparture || null,
        });
        if (!map[key].lastActivity || b.createdAt > map[key].lastActivity) {
          map[key].lastActivity = b.createdAt;
        }
      });

      return Object.values(map)
        .map((c) => {
          const spendingK = Math.round(c.spendingRaw / 1000);
          return {
            id: c.id,
            initials: c.initials,
            name: c.name,
            email: c.email,
            phone: c.phone,
            bookings: c.bookings,
            spending: spendingK,
            lastActivity: c.lastActivity ? moment(c.lastActivity).format("DD/MM/YYYY") : "—",
            bookingList: c.bookingList,
            isVIP: c.bookings >= 5 || spendingK >= 5000,
          };
        })
        .sort((a, b) => b.bookings - a.bookings);
    };

    // Helper: group bookings theo base code
    const groupByBaseCode = (bookings) => {
      const map = {};
      bookings.forEach(b => {
        const baseCode = extractBaseCode(b.code);
        if (!map[baseCode]) map[baseCode] = { baseCode, bookings: [], firstBooking: b };
        map[baseCode].bookings.push(b);
      });
      return Object.values(map).map(g => ({
        ...g.firstBooking,
        totalRooms: g.bookings.reduce((s, x) => s + (x.rooms || 1), 0),
        baseCode:   g.baseCode,
      }));
    };

    // ── 1. Khách đặt phòng trực tiếp (không qua tour) ──────────────────────
    const directBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
      $or: [{ tourSegmentId: null }, { tourSegmentId: { $exists: false } }],
    }).sort({ createdAt: -1 }).lean();

    const hotelCustomers = buildCustomerMap(groupByBaseCode(directBookings));

    // ── 2. Khách đặt qua tour (bỏ qua giữ chỗ chưa gán khách: [Tour Hold]) ──
    const tourBookingsRaw = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
      tourSegmentId: { $ne: null, $exists: true },
    }).sort({ createdAt: -1 }).lean();
    const tourBookings = tourBookingsRaw.filter((b) => {
      const name = (b.guest?.fullName || "").trim();
      return name && name !== "[Tour Hold]";
    });

    // Enrich: lấy tên tour và ngày khởi hành
    const segIds  = [...new Set(tourBookings.map(b => String(b.tourSegmentId)).filter(Boolean))];
    const segs    = await TourSegment.find({ _id: { $in: segIds } }).lean();
    const segMap  = {};
    for (const s of segs) segMap[String(s._id)] = s;

    const tourIds = [...new Set(segs.map(s => String(s.tourId)))];
    const tours   = await Tour.find({ _id: { $in: tourIds } }).select("name").lean();
    const tourMap = {};
    for (const t of tours) tourMap[String(t._id)] = t;

    const enrichedTourBookings = tourBookings.map(b => {
      const seg  = segMap[String(b.tourSegmentId)] || {};
      const tour = tourMap[String(seg.tourId)]      || {};
      return {
        ...b,
        tourName:     tour.name || "—",
        tourDeparture: seg.departureDate ? moment(seg.departureDate).format("DD/MM/YYYY") : "—",
      };
    });

    const Order = require("../../models/order.model");
    const AccountUser = require("../../models/account-user.model");
    const tourOrderCodes = [
      ...new Set(enrichedTourBookings.map(extractTourOrderCodeFromBooking).filter(Boolean)),
    ];
    const tourOrders =
      tourOrderCodes.length > 0
        ? await Order.find({
            code: { $in: tourOrderCodes },
            deleted: { $ne: true },
          })
            .select("code email phone fullName total paymentStatus status userId")
            .lean()
        : [];
    const needUserIds = [
      ...new Set(
        tourOrders
          .filter((o) => !String(o.email || "").trim() && o.userId)
          .map((o) => String(o.userId))
      ),
    ];
    let userEmailById = {};
    if (needUserIds.length) {
      const usrRows = await AccountUser.find({ _id: { $in: needUserIds } })
        .select("email")
        .lean();
      userEmailById = Object.fromEntries(
        usrRows.map((u) => [String(u._id), String(u.email || "").trim()])
      );
    }
    for (const o of tourOrders) {
      if (!String(o.email || "").trim() && o.userId) {
        const em = userEmailById[String(o.userId)];
        if (em) o.email = em;
      }
    }
    const orderByCodeForTour = Object.fromEntries(
      tourOrders.map((o) => [o.code, o])
    );

    const tourCustomers = buildTourCustomerMap(
      groupByBaseCode(enrichedTourBookings),
      orderByCodeForTour
    );

    const customersData = {
      hotelCustomers,
      tourCustomers,
      customerTab,
    };

    return res.render("admin/pages/hotel-customers", {
      pageTitle: "Khách hàng",
      customersData,
      pathAdmin,
      hotelList: hotels,
      selectedHotelId,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel customers list error:", error);
    return res.render("admin/pages/hotel-customers", {
      pageTitle: "Khách hàng",
      customersData: { hotelCustomers: [], tourCustomers: [], customerTab: "hotel" },
      pathAdmin,
      hotelList: [],
      selectedHotelId: null,
      isBookingManagement: true,
    });
  }
};

module.exports.roomCreatePost = async (req, res) => {
  try {
    const { hotelId, rooms } = req.body;
    const companyId = req.account?.companyId || null;

    if (!hotelId || !rooms || !Array.isArray(rooms) || rooms.length === 0) {
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

    // Kiểm tra tất cả roomTypeId trong payload có tồn tại không
    const roomTypeIds = [...new Set(rooms.map(r => String(r.roomTypeId)).filter(Boolean))];
    for (const rtId of roomTypeIds) {
      const found = hotel.roomTypes.find(rt => String(rt._id) === rtId);
      if (!found) {
        return res.json({
          code: "error",
          message: `Không tìm thấy loại phòng với ID: ${rtId}`,
        });
      }
    }

    // Kiểm tra trùng số phòng với phòng đã có trong hotel
    const existingNumbers = new Set(hotel.rooms.map(r => String(r.roomNumber).toLowerCase()));
    const submittedNumbers = rooms.map(r => String(r.roomNumber).trim().toLowerCase()).filter(Boolean);
    const duplicates = submittedNumbers.filter(n => existingNumbers.has(n));
    if (duplicates.length > 0) {
      return res.json({
        code: "error",
        message: `Số phòng đã tồn tại trong khách sạn: ${duplicates.join(", ")}`,
      });
    }

    // Xử lý và lưu các phòng vào database (mỗi room mang floor + roomTypeId riêng)
    const roomsToAdd = [];
    rooms.forEach(room => {
      const roomFloor    = room.floor || "";
      const roomTypeId   = String(room.roomTypeId || "");
      const roomNumbers  = String(room.roomNumber).split(',').map(r => r.trim()).filter(r => r);

      roomNumbers.forEach(roomNum => {
        roomsToAdd.push({
          roomNumber: roomNum,
          floor: roomFloor,
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

// Xóa một phòng cụ thể (phần tử trong hotel.rooms)
module.exports.individualRoomDelete = async (req, res) => {
  try {
    const { hotelId, roomId } = req.params;
    const companyId = req.account?.companyId || null;

    const find = { _id: hotelId, deleted: false };
    if (companyId) find.companyId = companyId;

    const hotel = await Hotel.findOne(find);
    if (!hotel) {
      return res.json({ code: "error", message: "Không tìm thấy khách sạn!" });
    }

    const sub = hotel.rooms.id(roomId);
    if (!sub) {
      return res.json({ code: "error", message: "Không tìm thấy phòng!" });
    }

    const now = new Date();
    const blocking = await HotelBooking.exists({
      roomId,
      "hotel.hotelId": hotel._id,
      status: { $nin: ["cancelled", "checked_out"] },
      checkOut: { $gt: now },
    });

    if (blocking) {
      return res.json({
        code: "error",
        message: "Không thể xóa phòng đang có đặt phòng hoặc giữ chỗ còn hiệu lực.",
      });
    }

    sub.deleteOne();
    hotel.updatedBy = req.account.id;
    await hotel.save();

    return res.json({ code: "success", message: "Đã xóa phòng." });
  } catch (error) {
    console.error("individualRoomDelete error:", error);
    return res.json({ code: "error", message: "Có lỗi xảy ra khi xóa phòng!" });
  }
};

module.exports.paymentsList = async (req, res) => {
  try {
    const companyId = req.account?.companyId || null;
    
    const _emptyPayments = { hotelInvoices: [], tourInvoices: [], hotelSummary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 }, tourSummary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 }, paymentTab: "hotel" };
    if (!companyId) {
      return res.render("admin/pages/hotel-payments", {
        pageTitle: "Thanh toán",
        paymentsData: _emptyPayments,
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
        paymentsData: _emptyPayments,
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

    const TourSegment = require("../../models/tour-segment.model");
    const Tour        = require("../../models/tour.model");
    const paymentTab  = req.query.paymentTab || "hotel";

    // Helper: extract base code
    const extractBaseCode = (code) => {
      let base = code.replace(/-R\d+(-\d+)?$/, '');
      while (base.match(/-\d+$/)) base = base.replace(/-\d+$/, '');
      return base;
    };

    // Helper: group rawBookings → invoices array
    const buildInvoices = (rawBookings, segmentMap = {}, tourMap = {}) => {
      const groups = {};
      rawBookings.forEach(b => {
        const base = extractBaseCode(b.code);
        if (!groups[base]) groups[base] = [];
        groups[base].push(b);
      });
      return Object.entries(groups).map(([baseCode, group]) => {
        const b = group[0];
        const roomCount   = group.reduce((s, x) => s + (x.rooms || 1), 0);
        const totalAmount = Number(b.orderTotal || b.totalAmount || 0);
        const isPaid      = b.paymentStatus === "paid";
        const seg  = b.tourSegmentId ? (segmentMap[String(b.tourSegmentId)] || {}) : {};
        const tour = seg.tourId ? (tourMap[String(seg.tourId)] || {}) : {};
        return {
          bookingCode:  baseCode,
          customerName: b.guest?.fullName || "Khách lẻ",
          issueDate:    b.createdAt ? moment(b.createdAt).format("DD/MM/YYYY") : "—",
          dueDate:      b.checkIn   ? moment(b.checkIn).format("DD/MM/YYYY")  : "—",
          roomCount,
          totalAmount:  Math.round(totalAmount / 1000),
          paidAmount:   isPaid ? Math.round(totalAmount / 1000) : 0,
          status:       isPaid ? "paid" : "pending",
          statusText:   isPaid ? "Đã thanh toán" : "Chờ thanh toán",
          statusColor:  isPaid ? "green" : "orange",
          tourName:     tour.name || null,
          tourDeparture: seg.departureDate ? moment(seg.departureDate).format("DD/MM/YYYY") : null,
        };
      });
    };

    // Helper: tính summary từ invoices
    const buildSummary = (invoices) => ({
      totalRevenue:    invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.totalAmount, 0),
      pendingPayments: invoices.filter(i => i.status !== "paid").reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0),
      unpaidInvoices:  invoices.filter(i => i.status !== "paid").length,
    });

    // Giữ chỗ tour chưa gán khách — không hiển thị ở trang thanh toán
    const notTourHoldGuest = { "guest.fullName": { $ne: "[Tour Hold]" } };

    // ── 1. Đặt phòng trực tiếp ──────────────────────────────────────────────
    const directBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
      $or: [{ tourSegmentId: null }, { tourSegmentId: { $exists: false } }],
      ...notTourHoldGuest,
    }).sort({ createdAt: -1 }).lean();

    const hotelInvoices = buildInvoices(directBookings);
    const hotelSummary  = buildSummary(hotelInvoices);

    // ── 2. Đặt qua tour ─────────────────────────────────────────────────────
    const tourBookings = await HotelBooking.find({
      "hotel.hotelId": selectedHotelId,
      status: { $ne: "cancelled" },
      tourSegmentId: { $ne: null, $exists: true },
      ...notTourHoldGuest,
    }).sort({ createdAt: -1 }).lean();

    const segIds  = [...new Set(tourBookings.map(b => String(b.tourSegmentId)).filter(Boolean))];
    const segs    = await TourSegment.find({ _id: { $in: segIds } }).lean();
    const segMap  = {};
    for (const s of segs) segMap[String(s._id)] = s;
    const tourIds = [...new Set(segs.map(s => String(s.tourId)))];
    const tours   = await Tour.find({ _id: { $in: tourIds } }).select("name").lean();
    const tourMap = {};
    for (const t of tours) tourMap[String(t._id)] = t;

    const tourInvoices = buildInvoices(tourBookings, segMap, tourMap);
    const tourSummary  = buildSummary(tourInvoices);

    const paymentsData = {
      hotelInvoices,
      hotelSummary,
      tourInvoices,
      tourSummary,
      paymentTab,
    };

    return res.render("admin/pages/hotel-payments", {
      pageTitle: "Thanh toán",
      paymentsData,
      pathAdmin,
      hotelList: hotels,
      selectedHotelId,
      isBookingManagement: true,
    });
  } catch (error) {
    console.error("hotel payments list error:", error);
    return res.render("admin/pages/hotel-payments", {
      pageTitle: "Thanh toán",
      paymentsData: { hotelInvoices: [], tourInvoices: [], hotelSummary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 }, tourSummary: { totalRevenue: 0, pendingPayments: 0, unpaidInvoices: 0 }, paymentTab: "hotel" },
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

