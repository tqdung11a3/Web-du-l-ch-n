const mongoose = require("mongoose");
const { generateRandomNumber } = require("../../helpers/generate.helper");
const Order = require("../../models/order.model");
const Tour = require("../../models/tour.model");
const City = require("../../models/city.model");
const {
  paymentMethodList,
  paymentStatusList,
  statusList,
  pathAdmin,
} = require("../../config/variable.config");
const moment = require("moment");
const {
  allocateHotelsForGroup,
  estimateCheckOut,
} = require("../../helpers/hotel-allocation.helper");
const HotelBooking = require("../../models/hotel-booking.model");
const Notification = require("../../models/notification.model");
const TourSegment = require("../../models/tour-segment.model");
const auditLogHelper = require("../../helpers/audit-log.helper");
const {
  notifyCustomerOrderUpdate,
  buildTourOrderProfileLink,
} = require("../../helpers/customer-order-notify.helper");
const {
  enrichItemBabySeatsDisplay,
} = require("../../helpers/order-baby-seats-display.helper");
const {
  evaluateSharedFeasibility,
  evaluateSharedFeasibilityV2,
  evaluateSharedFeasibilityV2Multi,
  assignSharedAtomsToRooms,
} = require("../../helpers/tour-shared-room.helper");
const {
  buildAtomsFromPassengers,
  reweightAtomsForAgeBands,
  SHARED_INSUFFICIENT_ADULTS_MESSAGE,
  GUARDIAN_MIN_AGE,
  passengerNeedsGuardian,
  isAnchorAdult,
} = require("../../helpers/passenger-atom.helper");
const {
  evaluateTourHotelQuotaPressure,
  maybeNotifyTourQuotaPressure,
} = require("../../helpers/tour-hotel-quota-pressure.helper");

// Gom tourSegmentId duy nhất từ tất cả items trong groups (fire-and-forget notify).
async function _firePressureNotifyForGroups(groups) {
  const segIds = new Set();
  for (const cid of Object.keys(groups || {})) {
    for (const item of groups[cid].items || []) {
      for (const rs of item.roomSelections || []) {
        if (rs.tourSegmentId) segIds.add(String(rs.tourSegmentId));
      }
      for (const r of item.sharedRoomRequest || []) {
        if (r.tourSegmentId) segIds.add(String(r.tourSegmentId));
      }
    }
  }
  for (const segId of segIds) {
    try {
      const pressure = await evaluateTourHotelQuotaPressure({ tourSegmentId: segId });
      await maybeNotifyTourQuotaPressure(pressure);
    } catch (_) {}
  }
}

/** Chuẩn hoá thông báo lỗi ở ghép cho khách (đặc biệt NL–TE). */
function formatSharedFeasibilityFailureMessage(fea) {
  if (!fea) return "Không đủ chỗ ở ghép.";
  if (fea.reason === "insufficient_adults_for_children") {
    return fea.message || SHARED_INSUFFICIENT_ADULTS_MESSAGE;
  }
  return fea.message || "Không đủ chỗ ở ghép.";
}
const {
  validatePrivateAssignmentsForItem,
  validatePrivateMinAdultsForItem,
} = require("../../helpers/private-room-assignment.helper");
const Hotel = require("../../models/hotel.model");

// === Helpers: tính giá em bé theo bậc (theo vị trí bé #1, #2, ...) ===
function babyUnitAt(idx, mode, rules, priceAdult, priceChild, priceBabyFixed) {
  if (mode !== "tiered" || !Array.isArray(rules) || !rules.length) {
    return Number(priceBabyFixed || 0);
  }
  const found = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!found) return 0;
  const base =
    found.ref === "adult" ? Number(priceAdult || 0) : Number(priceChild || 0);
  const pct = Number(found.percent || 0);
  return Math.round((base * pct) / 100);
}

function babyTotalQty(
  qty,
  mode,
  rules,
  priceAdult,
  priceChild,
  priceBabyFixed
) {
  let sum = 0;
  qty = Number(qty || 0);
  for (let i = 1; i <= qty; i++) {
    sum += babyUnitAt(i, mode, rules, priceAdult, priceChild, priceBabyFixed);
  }
  return sum;
}

// ── Helper: hoàn lại ghế cho các item đã decrement trong cùng request ────────
// Dùng khi createPost gặp lỗi sau bước $inc giảm seatsRemaining (ví dụ: bước
// kiểm tra phòng khách sạn fail). Nếu không hoàn, ghế sẽ bị "kẹt" vĩnh viễn
// vì chưa có Order nào được tạo nên cron cleanup-expired-orders không xử lý.
async function _restoreSeatsForGroups(groups) {
  if (!groups) return;
  for (const cid of Object.keys(groups)) {
    const items = groups[cid]?.items || [];
    for (const item of items) {
      if (!item.tourId) continue;
      const seatsToRestore =
        Number(item.quantityAdult    || 0) +
        Number(item.quantityChildren || 0) +
        (item.babySeat ? Number(item.quantityBaby || 0) : 0);
      if (seatsToRestore <= 0) continue;

      try {
        await Tour.updateOne(
          { _id: item.tourId },
          { $inc: { seatsRemaining: seatsToRestore } }
        );
        if (item.departureDateDisplay) {
          const depMoment = moment(item.departureDateDisplay, "DD/MM/YYYY");
          if (depMoment.isValid()) {
            await Tour.updateOne(
              { _id: item.tourId },
              { $inc: { "departures.$[dep].seatsRemaining": seatsToRestore } },
              {
                arrayFilters: [{
                  "dep.departureDate": {
                    $gte: depMoment.clone().startOf("day").toDate(),
                    $lte: depMoment.clone().endOf("day").toDate(),
                  },
                }],
              }
            );
          }
        }
      } catch (err) {
        console.error("_restoreSeatsForGroups error:", err);
      }
    }
  }
}

// ── Helper: hủy đơn hold và trả lại ghế cho tour ─────────────────────────────
async function _cancelHoldAndRestoreSeats(order) {
  try {
    // Chỉ hủy nếu chưa thanh toán
    if (order.paymentStatus === "paid") return;

    // Khôi phục ghế cho từng tour item
    for (const item of order.items || []) {
      if (!item.tourId) continue;

      const seatsToRestore =
        Number(item.quantityAdult    || 0) +
        Number(item.quantityChildren || 0) +
        (item.babySeat ? Number(item.quantityBaby || 0) : 0);

      // 1. Khôi phục top-level seatsRemaining
      await Tour.updateOne(
        { _id: item.tourId },
        { $inc: { seatsRemaining: seatsToRestore } }
      );

      // 2. Khôi phục seatsRemaining cho đúng ngày khởi hành trong departures[]
      if (item.departureDateDisplay && seatsToRestore > 0) {
        const depMoment = moment(item.departureDateDisplay, "DD/MM/YYYY");
        if (depMoment.isValid()) {
          await Tour.updateOne(
            { _id: item.tourId },
            { $inc: { "departures.$[dep].seatsRemaining": seatsToRestore } },
            {
              arrayFilters: [{
                "dep.departureDate": {
                  $gte: depMoment.startOf("day").toDate(),
                  $lte: depMoment.endOf("day").toDate(),
                },
              }],
            }
          );
        }
      }
    }

    // ── Trả lại các HotelBooking giữ chỗ thuộc đơn này ──
    // Mỗi roomSelections (selectedRooms) đã sinh ra 1 HotelBooking với
    // isTemporaryHold = true và orderCode = order.code. Xóa các booking
    // này → số phòng trống của roomType tự động được giải phóng vì
    // `availableRooms` được tính dựa trên các HotelBooking đang giữ.
    if (order.code) {
      try {
        const delResult = await HotelBooking.deleteMany({
          orderCode: order.code,
          isTemporaryHold: true,
          paymentStatus: "unpaid",
          status: { $ne: "cancelled" },
        });
        if (delResult?.deletedCount) {
          console.log(
            `[_cancelHoldAndRestoreSeats] Released ${delResult.deletedCount} hotel hold(s) of order ${order.code}`
          );
        }
      } catch (hbErr) {
        console.error(
          "[_cancelHoldAndRestoreSeats] Release hotel hold error:",
          hbErr
        );
      }
    }

    await Order.updateOne(
      { _id: order._id },
      { status: "cancel", isTemporaryHold: false, holdExpiresAt: null }
    );
  } catch (err) {
    console.error("_cancelHoldAndRestoreSeats error:", err);
  }
}

module.exports.createPost = async (req, res) => {
  // Khai báo ngoài try để catch có thể truy cập và hoàn lại ghế nếu cần.
  const groups = Object.create(null);
  try {
    const body = req.body || {};
    const incomingItems = Array.isArray(body.items) ? body.items : [];
    if (!incomingItems.length) {
      return res.json({ code: "error", message: "Không có tour nào để đặt!" });
    }

    for (const raw of incomingItems) {
      const { tourId } = raw || {};
      if (!tourId) continue;

      // Tour đang active
      const tourInfo = await Tour.findOne({
        _id: tourId,
        deleted: false,
        status: "active",
      }).lean();
      if (!tourInfo) continue;

      // Chuẩn hoá số lượng
      const quantityAdult = Number(raw.quantityAdult || 0);
      const quantityChildren = Number(raw.quantityChildren || 0);
      const quantityBaby = Number(raw.quantityBaby || 0);

      if (quantityAdult < 1) {
        return res.json({
          code: "error",
          message: `Tour "${tourInfo.name}" phải có ít nhất 1 người lớn.`,
        });
      }

      // maxBabiesPerAdult snapshot từ tour config (0 = auto mode: tất cả em bé chiếm ghế)
      const snapshotMaxBabiesPerAdult = Number(tourInfo.maxBabiesPerAdult != null ? tourInfo.maxBabiesPerAdult : 1);
      const isAutoBabyMode = snapshotMaxBabiesPerAdult === 0;

      // Phí ghế riêng em bé (chỉ dùng khi picker mode)
      const tourBabySeatFee = Number(tourInfo.babySeatFee || 0);

      // === CHỖ NGỒI EM BÉ ===
      let babySeats, privateSeatBabyCount, babySeat, babySeatFeeTotal;

      if (isAutoBabyMode) {
        // Auto mode: tất cả em bé tự động chiếm 1 ghế tour, không có lựa chọn
        babySeats = [];
        privateSeatBabyCount = quantityBaby;
        babySeat = quantityBaby > 0;
        babySeatFeeTotal = 0;
      } else {
        // Picker mode: babySeats[i] = { babyIdx, seatType: 'private'|'shared', guardianIdx }
        babySeats = Array.isArray(raw.babySeats)
          ? raw.babySeats.map((b) => ({
              babyIdx: typeof b.babyIdx === "number" ? b.babyIdx : null,
              seatType: b.seatType === "private" ? "private" : "shared",
              guardianIdx: b.guardianIdx != null ? Number(b.guardianIdx) : null,
            }))
          : [];
        // Số em bé chọn ghế riêng (chiếm ghế tour)
        privateSeatBabyCount = babySeats.length > 0
          ? babySeats.filter((b) => b.seatType === "private").length
          : (!!raw.babySeat ? quantityBaby : 0);
        babySeat = privateSeatBabyCount > 0;
        babySeatFeeTotal = babySeats.filter((b) => b.seatType === "private").length * tourBabySeatFee;
      }

      // Tuổi từng trẻ em / em bé (do client cung cấp)
      const childrenAges = Array.isArray(raw.childrenAges)
        ? raw.childrenAges.map(Number).slice(0, quantityChildren)
        : [];
      const babyAges = Array.isArray(raw.babyAges)
        ? raw.babyAges.map(Number).slice(0, quantityBaby)
        : [];

      // Chụp thông tin giá tại thời điểm đặt
      const priceAdult = Number(tourInfo.priceNewAdult || 0);
      const priceChild = Number(tourInfo.priceNewChildren || 0);
      const priceBabyFix = Number(tourInfo.priceNewBaby || 0);

      // Cấu hình tiered (nếu có)
      const babyMode = (tourInfo.babyPricingMode || "fixed").trim();
      const babyRules = Array.isArray(tourInfo.babyPricingRules)
        ? tourInfo.babyPricingRules
        : [];

      // ==== TÍNH TIỀN DÒNG ====
      const moneyAdult = quantityAdult * priceAdult;
      const moneyChild = quantityChildren * priceChild;
      const moneyBaby = babyTotalQty(
        quantityBaby,
        babyMode,
        babyRules,
        priceAdult,
        priceChild,
        priceBabyFix
      );
      // Hình thức lưu trú: "private" (mặc định, đơn cũ tương thích) hoặc "shared".
      const accommodationMode =
        raw.accommodationMode === "shared" ? "shared" : "private";

      // === PASSENGERS (cả 2 mode private + shared) ===
      // Mỗi đơn = 1 đoàn → 1 passengers list, áp cho cả tour.
      // - shared: dùng để build atoms cho thuật toán xếp ghép.
      // - private: dùng để gán passenger vào từng phòng cụ thể.
      // Server self-derive males/females từ passengers (không tin client).
      let passengers = [];
      let derivedMales = 0;
      let derivedFemales = 0;
      if (Array.isArray(raw.passengers) && raw.passengers.length > 0) {
        const adults = quantityAdult;
        passengers = raw.passengers
          .map((p, i) => {
            const idx =
              typeof p.idx === "number" ? Math.floor(p.idx) : i;
            const ageNum = Math.max(
              0,
              Math.floor(Number(p.age) || 0)
            );
            const type =
              p.type === "child" || p.type === "baby" ? p.type : "adult";
            const gender =
              type === "adult" &&
              (p.gender === "male" || p.gender === "female")
                ? p.gender
                : null;
            const rawGuardian =
              p.guardianIdx === null || p.guardianIdx === undefined
                ? null
                : Math.floor(Number(p.guardianIdx));
            const guardianIdx =
              type === "adult" && ageNum >= GUARDIAN_MIN_AGE
                ? null
                : rawGuardian;
            const babySeatType =
              type === "baby" &&
              (p.babySeatType === "private" || p.babySeatType === "shared")
                ? p.babySeatType
                : undefined;
            // roomGuardianIdx: chỉ áp dụng cho em bé khi ở ghép.
            // Quyết định em bé sẽ ở chung PHÒNG với người lớn nào (anchor 18+).
            const rawRoomGuardian =
              p.roomGuardianIdx === null || p.roomGuardianIdx === undefined
                ? null
                : Math.floor(Number(p.roomGuardianIdx));
            const roomGuardianIdx =
              type === "baby" && accommodationMode === "shared"
                ? rawRoomGuardian
                : null;
            return {
              idx,
              name: String(p.name || "").trim(),
              age: ageNum,
              type,
              gender,
              guardianIdx,
              roomGuardianIdx,
              babySeatType,
            };
          })
          .filter(
            (p, i, arr) =>
              // bỏ duplicate idx (giữ entry đầu tiên)
              arr.findIndex((q) => q.idx === p.idx) === i
          );

        // Counts phải khớp client form (NL/TE/EB).
        const countByType = passengers.reduce(
          (acc, p) => {
            acc[p.type] = (acc[p.type] || 0) + 1;
            return acc;
          },
          { adult: 0, child: 0, baby: 0 }
        );
        if (
          countByType.adult !== quantityAdult ||
          countByType.child !== quantityChildren ||
          countByType.baby !== quantityBaby
        ) {
          return res.json({
            code: "error",
            message: `Danh sách hành khách (${countByType.adult} NL, ${countByType.child} TE, ${countByType.baby} EB) không khớp số lượng đăng ký (${quantityAdult} NL, ${quantityChildren} TE, ${quantityBaby} EB).`,
          });
        }

        // Validate adult fields + guardian references.
        const anchorAdultIdxSet = new Set(
          passengers
            .filter((p) => p.type === "adult" && isAnchorAdult(p))
            .map((p) => p.idx)
        );
        const allAdultIdxSet = new Set(
          passengers.filter((p) => p.type === "adult").map((p) => p.idx)
        );
        for (const p of passengers) {
          if (!p.name) {
            return res.json({
              code: "error",
              message: `Hành khách #${p.idx + 1} chưa khai họ tên.`,
            });
          }
          if (p.type === "adult") {
            if (!p.gender) {
              return res.json({
                code: "error",
                message: `Người lớn "${p.name}" chưa chọn giới tính.`,
              });
            }
            if (p.gender === "male") derivedMales++;
            else derivedFemales++;
            if (
              accommodationMode === "shared" &&
              isAnchorAdult(p) &&
              p.guardianIdx !== null
            ) {
              return res.json({
                code: "error",
                message: `Người lớn "${p.name}" từ ${GUARDIAN_MIN_AGE} tuổi trở lên không thể chọn người đi cùng.`,
              });
            }
          }
          // Guardian bắt buộc: TE và NL tính giá NL nhưng < 18 tuổi (ở ghép).
          // Em bé xử lý riêng theo babySeats bên dưới.
          if (
            p.type !== "baby" &&
            accommodationMode === "shared" &&
            passengerNeedsGuardian(p)
          ) {
            if (
              p.guardianIdx === null ||
              !anchorAdultIdxSet.has(p.guardianIdx)
            ) {
              const who = p.type === "child" ? "Trẻ em" : "Hành khách";
              return res.json({
                code: "error",
                message: `${who} "${p.name}" chưa chọn người lớn đi cùng từ ${GUARDIAN_MIN_AGE} tuổi trở lên hợp lệ.`,
              });
            }
          }
        }

        if (
          accommodationMode === "shared" &&
          passengers.length > 0 &&
          !passengers.some((p) => isAnchorAdult(p))
        ) {
          return res.json({
            code: "error",
            message: `Đoàn phải có ít nhất 1 người lớn từ ${GUARDIAN_MIN_AGE} tuổi trở lên.`,
          });
        }

        if (derivedMales + derivedFemales !== adults) {
          return res.json({
            code: "error",
            message: `Tổng số người lớn theo giới tính (${derivedMales} nam + ${derivedFemales} nữ) không khớp số người lớn đăng ký (${adults}).`,
          });
        }

        // === Validate chỗ ngồi em bé ===
        if (quantityBaby > 0) {
          // Đoàn phải có ít nhất 1 người lớn 18+ dù em bé ở chế độ nào
          if (anchorAdultIdxSet.size === 0) {
            return res.json({
              code: "error",
              message: `Đoàn có em bé phải có ít nhất 1 người lớn từ ${GUARDIAN_MIN_AGE} tuổi trở lên đi cùng.`,
            });
          }

          // Em bé khi ở ghép phải chọn roomGuardianIdx = anchor adult 18+
          if (accommodationMode === "shared") {
            const babyPassengersForRoom = passengers.filter(
              (p) => p.type === "baby"
            );
            for (const baby of babyPassengersForRoom) {
              if (
                baby.roomGuardianIdx === null ||
                baby.roomGuardianIdx === undefined
              ) {
                return res.json({
                  code: "error",
                  message: `Em bé "${baby.name}" chưa chọn người lớn ở cùng phòng khách sạn.`,
                });
              }
              if (!anchorAdultIdxSet.has(baby.roomGuardianIdx)) {
                return res.json({
                  code: "error",
                  message: `Em bé "${baby.name}" có người ở cùng phòng không hợp lệ (phải là người lớn từ ${GUARDIAN_MIN_AGE} tuổi trở lên trong đoàn).`,
                });
              }
            }
          }

          if (!isAutoBabyMode) {
            // Picker mode: kiểm tra guardian và maxBabiesPerAdult
            if (babySeats.length > 0) {
              const babiesPerGuardian = {};
              for (const bs of babySeats) {
                if (bs.seatType === "shared") {
                  if (bs.guardianIdx === null || !allAdultIdxSet.has(bs.guardianIdx)) {
                    return res.json({
                      code: "error",
                      message: `Một em bé chọn "Ngồi cùng người lớn" nhưng chưa chọn người lớn đi cùng hợp lệ trong đoàn.`,
                    });
                  }
                  babiesPerGuardian[bs.guardianIdx] = (babiesPerGuardian[bs.guardianIdx] || 0) + 1;
                }
              }
              // Kiểm tra maxBabiesPerAdult
              for (const [adultIdx, count] of Object.entries(babiesPerGuardian)) {
                if (count > snapshotMaxBabiesPerAdult) {
                  const guardian = passengers.find((p) => p.idx === parseInt(adultIdx, 10));
                  const guardianLabel = guardian && guardian.name ? guardian.name : `Người lớn #${parseInt(adultIdx, 10) + 1}`;
                  return res.json({
                    code: "error",
                    message: `${guardianLabel} đang đi cùng ${count} em bé, vượt quá giới hạn tối đa ${snapshotMaxBabiesPerAdult} em bé/người lớn.`,
                  });
                }
              }
            } else if (accommodationMode === "shared") {
              // Legacy: không có babySeats → validate guardian ở ghép như cũ
              const babyPassengers = passengers.filter((p) => p.type === "baby");
              for (const p of babyPassengers) {
                if (p.guardianIdx === null || !anchorAdultIdxSet.has(p.guardianIdx)) {
                  return res.json({
                    code: "error",
                    message: `Em bé "${p.name}" chưa chọn người lớn đi cùng từ ${GUARDIAN_MIN_AGE} tuổi trở lên hợp lệ.`,
                  });
                }
              }
            }
          }
          // Auto mode (isAutoBabyMode === true): không cần validate thêm, tất cả em bé đã tự chiếm ghế
        }
      }

      // ── sharedRoomRequest: gom 1 entry/segment+khung. Server resolve danh
      // sách candidateHotels từ TourSegment để khách không thể tự ý sửa thứ
      // tự / hotel ngoài cấu hình. `hotelAllocations[]` sẽ được fill sau khi
      // chạy feasibility V2-Multi (nếu thành công).
      const _sharedFrames = new Map(); // key = `${segId}|${from}|${to}`
      if (
        accommodationMode === "shared" &&
        Array.isArray(raw.sharedRoomRequest)
      ) {
        for (const r of raw.sharedRoomRequest) {
          const segId = String(r.tourSegmentId || "");
          const fromDate = r.fromDate || "";
          const toDate = r.toDate || "";
          if (!segId || !fromDate || !toDate) continue;
          const key = `${segId}|${fromDate}|${toDate}`;
          if (_sharedFrames.has(key)) continue; // de-dupe; chỉ giữ entry đầu
          _sharedFrames.set(key, {
            tourSegmentId: segId,
            fromDate,
            toDate,
          });
        }
      }
      const sharedRoomRequest = [];
      if (accommodationMode === "shared" && _sharedFrames.size > 0) {
        for (const frame of _sharedFrames.values()) {
          // Resolve candidateHotels theo cấu hình TourSegment, lọc đúng khung.
          let ts = null;
          try {
            ts = await TourSegment.findById(frame.tourSegmentId).lean();
          } catch (_) {
            ts = null;
          }
          const candidates = [];
          if (ts && Array.isArray(ts.segments)) {
            for (const sub of ts.segments) {
              const subFrom = sub.fromDate
                ? moment(sub.fromDate).format("YYYY-MM-DD")
                : "";
              const subTo = sub.toDate
                ? moment(sub.toDate).format("YYYY-MM-DD")
                : "";
              if (subFrom !== frame.fromDate || subTo !== frame.toDate) continue;
              for (const h of sub.hotels || []) {
                if (!h || !h.hotelId) continue;
                candidates.push({
                  hotelId: String(h.hotelId),
                  hotelName: String(h.hotelName || ""),
                });
              }
              break;
            }
          }
          sharedRoomRequest.push({
            tourSegmentId: frame.tourSegmentId,
            fromDate: frame.fromDate,
            toDate: frame.toDate,
            // Primary hotel — sẽ được set lại theo allocation sau feasibility.
            hotelId: candidates[0] ? candidates[0].hotelId : "",
            hotelName: candidates[0] ? candidates[0].hotelName : "",
            males: passengers.length > 0 ? derivedMales : 0,
            females: passengers.length > 0 ? derivedFemales : 0,
            candidateHotels: candidates,
            // hotelAllocations sẽ được fill sau bước feasibility.
            hotelAllocations: [],
          });
        }
      }

      // ── Chặn đặt tour khi tour có KS bắt buộc nhưng client không chọn phòng ──
      // Kiểm tra xem tourId này có TourSegment confirmed với roomAllocations không.
      // Nếu có, phải có ít nhất 1 roomSelections hoặc sharedRoomRequest hợp lệ.
      {
        const hasRoomSelection = Array.isArray(raw.roomSelections) && raw.roomSelections.length > 0;
        const hasSharedRequest = sharedRoomRequest.length > 0;
        if (!hasRoomSelection && !hasSharedRequest) {
          const segWithRooms = await TourSegment.findOne({
            tourId: tourInfo._id,
            status: { $in: ["confirmed", "pending_approval"] },
            "segments.hotels.roomAllocations.0": { $exists: true },
          }).select("_id").lean();
          if (segWithRooms) {
            return res.json({
              code: "room_unavailable",
              message: "Tour này yêu cầu chọn lưu trú. Tất cả phòng trong quota hiện đã hết chỗ. Vui lòng liên hệ công ty du lịch để được hỗ trợ.",
            });
          }
        }
      }

      // Mode "shared" KHÔNG cộng phụ phí phòng (giữ giá tour cơ bản),
      // dù client có gửi extraRoomCost > 0 cũng bỏ qua.
      const extraRoomCost =
        accommodationMode === "shared" ? 0 : Number(raw.extraRoomCost || 0);
      const lineSubTotal = moneyAdult + moneyChild + moneyBaby + extraRoomCost + babySeatFeeTotal;

      // ==== TÍNH GHẾ & CẬP NHẬT ATOMIC ====
      // seatsUsed: NL + TE + số EB chiếm ghế (auto mode: tất cả; picker mode: chỉ ghế riêng)
      const seatsUsed = quantityAdult + quantityChildren + privateSeatBabyCount;

      // ── Kiểm tra & giảm ghế bằng atomic conditional update ──────────────────
      // Điều kiện: seatsRemaining >= seatsUsed (tránh race condition khi nhiều
      // user cùng đặt tour còn ít chỗ).
      // $inc giảm nguyên tử → chỉ 1 request thắng nếu ghế vừa đủ.
      const seatUpdateResult = await Tour.updateOne(
        {
          _id:            tourInfo._id,
          deleted:        false,
          status:         "active",
          seatsRemaining: { $gte: seatsUsed }, // CHỈ update nếu còn đủ ghế
        },
        {
          $inc: { seatsRemaining: -seatsUsed },
        }
      );

      // Nếu không có bản ghi nào được cập nhật → tour không còn đủ ghế
      if (seatUpdateResult.modifiedCount === 0) {
        // Phân biệt 2 trường hợp:
        //   (a) đang có đơn khác giữ chỗ chưa thanh toán → "Có người khác đang thanh toán tour này"
        //   (b) không có hold, ghế vừa giảm do người khác mới thanh toán xong → "Có người vừa thanh toán xong, tour chỉ còn N chỗ"
        const nowDate = new Date();
        const holdingOrder = await Order.findOne({
          deleted: false,
          isTemporaryHold: true,
          paymentStatus: "unpaid",
          status: { $ne: "cancel" },
          $or: [
            { holdExpiresAt: { $gt: nowDate } },
            { holdExpiresAt: null },
          ],
          items: {
            $elemMatch: { tourId: String(tourInfo._id) },
          },
        })
          .select("_id")
          .lean();

        if (holdingOrder) {
          return res.json({
            code:    "error",
            message: `Tour "${tourInfo.name}" vừa hết chỗ! Lý do: Có người khác đang thanh toán tour này.`,
          });
        }

        const tourLatest = await Tour.findById(tourInfo._id)
          .select("seatsRemaining")
          .lean();
        const seatsLeft = Number(tourLatest?.seatsRemaining || 0);

        return res.json({
          code:    "error",
          message: `Có người vừa thanh toán xong, tour "${tourInfo.name}" chỉ còn ${seatsLeft} chỗ.`,
        });
      }

      // Giảm seatsRemaining cho đúng ngày khởi hành trong departures[]
      const departureDateDisplay = raw.departureDateDisplay;
      if (departureDateDisplay && seatsUsed > 0) {
        const depMoment = moment(departureDateDisplay, "DD/MM/YYYY");
        if (depMoment.isValid()) {
          await Tour.updateOne(
            { _id: tourInfo._id },
            { $inc: { "departures.$[dep].seatsRemaining": -seatsUsed } },
            {
              arrayFilters: [{
                "dep.departureDate": {
                  $gte: depMoment.clone().startOf("day").toDate(),
                  $lte: depMoment.clone().endOf("day").toDate(),
                },
              }],
            }
          );
        }
      }

      // Gom theo công ty
      const companyId = String(tourInfo.companyId || "");
      if (!groups[companyId]) groups[companyId] = { items: [], subTotal: 0 };

      // === LỚP TRUNG GIAN: Greedy phân bổ đoàn vào các khách sạn của tour ===
      // Số người cần chỗ ở = người lớn + trẻ em (em bé thường không tính phòng riêng)
      const totalPeopleForHotel = quantityAdult + quantityChildren;

      let hotelAllocation = {
        status: "no_hotels",
        totalPeople: totalPeopleForHotel,
        totalAssigned: 0,
        remaining: totalPeopleForHotel,
        checkIn: null,
        checkOut: null,
        allocations: [],
      };

      const tourAccommodations = Array.isArray(tourInfo.accommodations)
        ? tourInfo.accommodations
        : [];

      if (tourAccommodations.length > 0 && totalPeopleForHotel > 0) {
        // Xác định ngày nhận phòng từ ngày khởi hành khách đã chọn
        const checkIn = raw.departureDateDisplay
          ? moment(raw.departureDateDisplay, "DD/MM/YYYY").toDate()
          : tourInfo.departureDate
          ? new Date(tourInfo.departureDate)
          : new Date();

        // Tìm ngày kết thúc tương ứng trong mảng departures của tour
        let checkOut = null;
        if (Array.isArray(tourInfo.departures) && tourInfo.departures.length > 0) {
          const matched = tourInfo.departures.find((d) => {
            if (!d.departureDate) return false;
            const depStr = moment(d.departureDate).format("DD/MM/YYYY");
            return depStr === (raw.departureDateDisplay || "");
          });
          if (matched && matched.endDate) {
            checkOut = new Date(matched.endDate);
          }
        }
        // Fallback: ước tính từ chuỗi time nếu không tìm được endDate
        if (!checkOut) {
          checkOut = estimateCheckOut(checkIn, tourInfo.time);
        }

        // Chạy thuật toán Greedy phân bổ
        const allocationResult = await allocateHotelsForGroup(
          totalPeopleForHotel,
          tourAccommodations,
          checkIn,
          checkOut
        );

        hotelAllocation = {
          ...allocationResult,
          totalPeople: totalPeopleForHotel,
          checkIn,
          checkOut,
        };
      }

      groups[companyId].items.push({
        tourId: String(tourInfo._id),

        // KHÔNG dùng locationFrom nữa, lưu departureCity
        departureCity: tourInfo.departureCity || null,

        // Lưu lại ngày khởi hành mà client đã chọn (nếu có)
        departureDateDisplay:
          (raw.departureDateDisplay &&
            String(raw.departureDateDisplay).trim()) || null,

        quantityAdult,
        quantityChildren,
        quantityBaby,
        babySeat,
        babySeats,
        babySeatFeeTotal,
        maxBabiesPerAdult: snapshotMaxBabiesPerAdult,
        childrenAges,
        babyAges,

        // Giá snapshot
        priceNewAdult: priceAdult,
        priceNewChildren: priceChild,
        priceNewBaby: priceBabyFix,

        // Chụp cấu hình tính giá em bé để các màn hiển thị dùng lại
        babyPricingMode: babyMode,
        babyPricingRules: babyRules,

        // Thông tin render
        departureDate: tourInfo.departureDate,
        avatar: tourInfo.avatar,
        name: tourInfo.name,
        slug: tourInfo.slug,

        // Quyền theo công ty
        companyId: tourInfo.companyId || null,

        // Kết quả phân bổ Greedy: ai ở khách sạn nào
        hotelAllocation,

        // Hình thức lưu trú
        accommodationMode,

        // Mode "private": phòng khách sạn khách chọn từ tour-hotel liên kết.
        // Mỗi roomSelection có thể đính kèm `roomAssignments[]` mô tả việc
        // gán passenger vào từng phòng vật lý (đơn cũ không có field này).
        roomSelections:
          accommodationMode === "private" && Array.isArray(raw.roomSelections)
            ? raw.roomSelections.map((sel) => {
                const cleanAssignments = Array.isArray(sel.roomAssignments)
                  ? sel.roomAssignments
                      .map((a, i) => ({
                        roomIndex:
                          typeof a.roomIndex === "number"
                            ? Math.floor(a.roomIndex)
                            : i,
                        passengerIdxs: Array.isArray(a.passengerIdxs)
                          ? a.passengerIdxs
                              .map((x) => Math.floor(Number(x)))
                              .filter((x) => Number.isFinite(x) && x >= 0)
                          : [],
                        usedCapacity:
                          a.usedCapacity === null ||
                          a.usedCapacity === undefined
                            ? 0
                            : Math.max(0, Number(a.usedCapacity) || 0),
                      }))
                      .sort((a, b) => a.roomIndex - b.roomIndex)
                  : [];
                return { ...sel, roomAssignments: cleanAssignments };
              })
            : [],

        // Mode "shared": khai báo nam/nữ — admin tiếp tục gán phòng vật lý sau
        sharedRoomRequest,

        // Danh sách hành khách chi tiết (1 list/đơn) — dùng cho cả private + shared.
        // Đơn cũ KHÔNG có field này; helper feasibility tự fallback synthesize.
        passengers,

        // Chi phí phụ thu phòng (private = full giá phòng; shared = 0)
        extraRoomCost: extraRoomCost || 0,
      });

      groups[companyId].subTotal += lineSubTotal;
    }

    const companyIds = Object.keys(groups);
    if (!companyIds.length) {
      return res.json({
        code: "error",
        message: "Các tour bạn chọn hiện không khả dụng!",
      });
    }

    // ── Kiểm tra phân bổ passenger vào từng phòng vật lý cho mode "Ở riêng" ──
    // Sanity check chống bypass UI: trùng idx, vượt baseOccupancy, đủ adult+child,
    // guardian phải ở cùng phòng. Resolve ageBands theo TourSegment.hotels.
    const privateFailures = [];
    for (const cid of companyIds) {
      for (const item of groups[cid].items) {
        if (item.accommodationMode !== "private") continue;
        if (
          !Array.isArray(item.roomSelections) ||
          item.roomSelections.length === 0
        )
          continue;
        const minAdultsCheck = validatePrivateMinAdultsForItem(item);
        if (!minAdultsCheck.ok) privateFailures.push(...minAdultsCheck.errors);
        // Đơn cũ / không có passengers → helper sẽ skip.
        const segIds = Array.from(
          new Set(item.roomSelections.map((s) => String(s.tourSegmentId || "")))
        ).filter(Boolean);
        const hotelsByTourSegmentId = new Map();
        for (const segId of segIds) {
          try {
            const ts = await TourSegment.findById(segId).lean();
            if (!ts || !Array.isArray(ts.segments)) continue;
            const hotels = [];
            for (const sub of ts.segments) {
              for (const h of sub.hotels || []) {
                if (!h || !h.hotelId) continue;
                const hid = String(h.hotelId);
                if (hotels.some((x) => String(x.hotelId) === hid)) continue;
                const hotelDoc = await Hotel.findById(hid)
                  .select("ageBands")
                  .lean();
                hotels.push({
                  hotelId: hid,
                  ageBands: (hotelDoc?.ageBands || []).map((ab) => ({
                    bandName: ab.bandName || "",
                    minAge: typeof ab.minAge === "number" ? ab.minAge : 0,
                    maxAge:
                      ab.maxAge === null || ab.maxAge === undefined
                        ? null
                        : ab.maxAge,
                    countInOccupancy: !!ab.countInOccupancy,
                    occupancyWeight: ab.countInOccupancy
                      ? ab.occupancyWeight ?? 1
                      : 0,
                  })),
                });
              }
            }
            hotelsByTourSegmentId.set(segId, hotels);
          } catch (_) {}
        }
        const r = validatePrivateAssignmentsForItem({
          item,
          hotelsByTourSegmentId,
        });
        if (!r.ok) privateFailures.push(...r.errors);
      }
    }
    if (privateFailures.length > 0) {
      await _restoreSeatsForGroups(groups);
      const message =
        privateFailures.length === 1
          ? privateFailures[0]
          : "Phân bổ hành khách vào phòng chưa hợp lệ:\n" +
            privateFailures.map((m, i) => `${i + 1}. ${m}`).join("\n");
      return res.json({ code: "error", message });
    }

    // ── Kiểm tra tính khả thi cho mode "Ở ghép" trước (cộng dồn nam/nữ
    // trong cùng segment + hotel + khung thời gian từ TẤT CẢ Order khác đang
    // còn hiệu lực, sau đó duyệt thuật toán xếp ghép). Nếu fail → trả message
    // multi-line giống pattern của private room conflicts. ──────────────────
    const sharedFailures = [];
    for (const cid of companyIds) {
      for (const item of groups[cid].items) {
        if (item.accommodationMode !== "shared") continue;
        if (!Array.isArray(item.sharedRoomRequest) || !item.sharedRoomRequest.length)
          continue;
        for (const r of item.sharedRoomRequest) {
          const hasPassengers =
            Array.isArray(item.passengers) && item.passengers.length > 0;
          // Đơn có passengers chi tiết:
          //   • Nếu segment có ≥ 1 candidateHotel → dùng V2-Multi (multi-hotel
          //     pooling, fallback giữa các hotel cùng segment).
          //   • Nếu vì lý do nào đó chưa có candidate (đơn cũ legacy gửi hotelId
          //     cứng) → fallback V2 single hotel.
          // Đơn không có passengers → V1 (chỉ males/females, single hotel).
          if (hasPassengers && Array.isArray(r.candidateHotels) && r.candidateHotels.length > 0) {
            const fea = await evaluateSharedFeasibilityV2Multi({
              tourSegmentId: r.tourSegmentId,
              fromDate: r.fromDate,
              toDate: r.toDate,
              hotels: r.candidateHotels,
              passengers: item.passengers,
              excludeOrderId: null,
            });
            if (!fea.ok) {
              sharedFailures.push(formatSharedFeasibilityFailureMessage(fea));
              continue;
            }
            // Feasibility OK: ghi lại allocations + chọn primary hotel
            // (= hotel có nhiều atom nhất; nếu hoà thì hotel đầu tiên).
            const allocs = Array.isArray(fea.allocations) ? fea.allocations : [];

            // ── Auto-assign atoms vào loại phòng cụ thể cho từng hotel ──
            // Build atoms 1 lần (theo ageBands hotel đầu tiên có atoms),
            // map theo anchorIdx để lookup atom theo allocation.
            const allocsWithAssign = [];
            let assignFailMessage = null;
            for (const a of allocs) {
              if (!a.atomAnchorIdxs || a.atomAnchorIdxs.length === 0) {
                allocsWithAssign.push({ ...a, roomAssignments: [] });
                continue;
              }
              // Lấy ageBands chính xác của hotel này (atom phải reweight).
              const hotelDoc = await Hotel.findById(a.hotelId)
                .select("ageBands name")
                .lean();
              const hotelAgeBands = (hotelDoc?.ageBands || []).map((ab) => ({
                bandName: ab.bandName || "",
                minAge: typeof ab.minAge === "number" ? ab.minAge : 0,
                maxAge:
                  ab.maxAge === null || ab.maxAge === undefined
                    ? null
                    : ab.maxAge,
                countInOccupancy: !!ab.countInOccupancy,
                occupancyWeight: ab.countInOccupancy
                  ? ab.occupancyWeight ?? 1
                  : 0,
              }));
              let atomsForHotel = [];
              try {
                const allAtoms = buildAtomsFromPassengers(
                  item.passengers,
                  hotelAgeBands
                );
                atomsForHotel = allAtoms.filter((at) =>
                  a.atomAnchorIdxs.includes(at.anchorIdx)
                );
              } catch (e) {
                assignFailMessage = e.message || "Không xếp được khách ở ghép.";
                break;
              }
              const ar = await assignSharedAtomsToRooms({
                tourSegmentId: r.tourSegmentId,
                hotelId: a.hotelId,
                hotelName: a.hotelName,
                ageBands: hotelAgeBands,
                fromDate: r.fromDate,
                toDate: r.toDate,
                atoms: atomsForHotel,
              });
              if (!ar.ok) {
                assignFailMessage =
                  ar.message ||
                  `Không xếp được phòng tại ${a.hotelName || "khách sạn"}.`;
                break;
              }
              allocsWithAssign.push({
                ...a,
                roomAssignments: ar.assignments,
              });
            }
            if (assignFailMessage) {
              sharedFailures.push(assignFailMessage);
              continue;
            }

            r.hotelAllocations = allocsWithAssign.map((a) => ({
              hotelId: a.hotelId,
              hotelName: a.hotelName,
              atomAnchorIdxs: Array.isArray(a.atomAnchorIdxs) ? a.atomAnchorIdxs : [],
              atomLabels: Array.isArray(a.atomLabels) ? a.atomLabels : [],
              totalEffectiveSize: Number(a.totalEffectiveSize) || 0,
              roomAssignments: a.roomAssignments || [],
            }));
            if (allocs.length > 0) {
              const primary = [...allocs].sort(
                (a, b) =>
                  (b.atomAnchorIdxs?.length || 0) -
                    (a.atomAnchorIdxs?.length || 0) ||
                  (b.totalEffectiveSize || 0) - (a.totalEffectiveSize || 0)
              )[0];
              r.hotelId = primary.hotelId;
              r.hotelName = primary.hotelName;
            }
            continue;
          }
          // Fallback đơn-cũ: V2 single hoặc V1 (legacy males/females).
          const fea = hasPassengers
            ? await evaluateSharedFeasibilityV2({
                tourSegmentId: r.tourSegmentId,
                hotelId: r.hotelId,
                hotelName: r.hotelName,
                fromDate: r.fromDate,
                toDate: r.toDate,
                passengers: item.passengers,
                excludeOrderId: null,
              })
            : await evaluateSharedFeasibility({
                tourSegmentId: r.tourSegmentId,
                hotelId: r.hotelId,
                hotelName: r.hotelName,
                fromDate: r.fromDate,
                toDate: r.toDate,
                males: r.males,
                females: r.females,
                excludeOrderId: null,
              });
          if (!fea.ok) {
            sharedFailures.push(formatSharedFeasibilityFailureMessage(fea));
          }
        }
      }
    }
    if (sharedFailures.length > 0) {
      await _restoreSeatsForGroups(groups);
      _firePressureNotifyForGroups(groups).catch(() => {});
      const message =
        sharedFailures.length === 1
          ? sharedFailures[0]
          : "Một số yêu cầu ở ghép không khả thi:\n" +
            sharedFailures.map((m, i) => `${i + 1}. ${m}`).join("\n");
      return res.json({ code: "room_unavailable", message });
    }

    // ── Kiểm tra phòng khách sạn trước khi tạo đơn (race condition check) ──
    const allRoomSelections = [];
    for (const cid of companyIds) {
      for (const item of groups[cid].items) {
        if (item.accommodationMode === "shared") continue;
        if (!Array.isArray(item.roomSelections) || item.roomSelections.length === 0) continue;
        for (const sel of item.roomSelections) {
          allRoomSelections.push(sel);
        }
      }
    }

    if (allRoomSelections.length > 0) {
      // Tích lũy mọi loại phòng bị xung đột — KHÔNG return ngay sau cái đầu
      // tiên — để có thể báo cho khách biết tất cả các loại phòng cùng số
      // phòng đang thiếu trong cùng một thông báo.
      const roomConflicts = []; // { kind: 'hold'|'paid'|'shortage', roomTypeName, hotelLabel, blockedCount, availableForClient }
      let segmentInvalid = false;

      for (const sel of allRoomSelections) {
        const ts = await TourSegment.findById(sel.tourSegmentId).lean();
        if (!ts || (ts.status !== "confirmed" && ts.status !== "pending_approval")) {
          segmentInvalid = true;
          break;
        }

        let assignedRooms = 0;
        for (const seg of (ts.segments || [])) {
          for (const h of (seg.hotels || [])) {
            if (String(h.hotelId) !== String(sel.hotelId)) continue;
            for (const ra of (h.roomAllocations || [])) {
              if (String(ra.roomTypeId) === String(sel.roomTypeId)) {
                assignedRooms += ra.assignedRooms || 0;
              }
            }
          }
        }

        // ── Đếm phòng đã được khách KHÁC giữ chỗ / thanh toán cho cùng segment ──
        // Phân biệt 2 nhóm để chọn câu thông báo khác nhau khi xung đột:
        //   • holdRoomsByOthers  → đơn của khách khác đang trong giai đoạn giữ
        //                          chỗ (chưa thanh toán, chưa hết hạn, chưa huỷ)
        //                          → "Đang có khách đặt N phòng cho loại phòng X"
        //   • paidRoomsByOthers  → đơn của khách khác đã thanh toán xong
        //                          → "Đã có khách đặt N phòng cho loại phòng X,
        //                             hiện loại phòng đó còn M phòng"
        // Truy vấn theo Order (nguồn dữ liệu sống lâu hơn HotelBooking — các
        // HotelBooking dạng [Tour Booking] có TTL 15 phút, nên sau khi đơn được
        // thanh toán mà chưa kịp gỡ TTL thì có thể bị xoá; còn Order luôn còn).
        const conflictOrders = await Order.find({
          deleted: { $ne: true },
          status: { $ne: "cancel" },
          "items.roomSelections.hotelId": String(sel.hotelId),
          "items.roomSelections.roomTypeId": String(sel.roomTypeId),
        })
          .select("code status paymentStatus isTemporaryHold holdExpiresAt items")
          .lean();

        const nowDate = new Date();
        let holdRoomsByOthers = 0;
        let paidRoomsByOthers = 0;
        for (const ord of conflictOrders) {
          let roomsInOrder = 0;
          for (const it of ord.items || []) {
            for (const rs of it.roomSelections || []) {
              if (
                String(rs.tourSegmentId) === String(ts._id) &&
                String(rs.hotelId) === String(sel.hotelId) &&
                String(rs.roomTypeId) === String(sel.roomTypeId) &&
                String(rs.fromDate) === String(sel.fromDate) &&
                String(rs.toDate) === String(sel.toDate)
              ) {
                roomsInOrder += Number(rs.selectedRooms || 0);
              }
            }
          }
          if (roomsInOrder === 0) continue;

          if (ord.paymentStatus === "paid") {
            paidRoomsByOthers += roomsInOrder;
          } else if (
            ord.isTemporaryHold &&
            (!ord.holdExpiresAt || new Date(ord.holdExpiresAt) > nowDate)
          ) {
            holdRoomsByOthers += roomsInOrder;
          }
        }

        const availableForClient = Math.max(
          0,
          assignedRooms - holdRoomsByOthers - paidRoomsByOthers
        );

        if (sel.selectedRooms > availableForClient) {
          const hotelLabel = sel.hotelName ? ` tại ${sel.hotelName}` : "";
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
            roomTypeName: sel.roomTypeName,
            hotelLabel,
            blockedCount,
            availableForClient,
            requestedRooms: Number(sel.selectedRooms || 0),
          });
        }
      }

      if (segmentInvalid) {
        await _restoreSeatsForGroups(groups);
        return res.json({
          code: "room_unavailable",
          message: `Tour segment không còn khả dụng. Vui lòng tải lại trang và chọn lại.`,
        });
      }

      if (roomConflicts.length > 0) {
        // Hoàn lại ghế đã decrement cho TẤT CẢ item của request này — vì
        // chưa có Order nào được tạo, cron không có cách phục hồi tự động.
        await _restoreSeatsForGroups(groups);

        // Nếu chỉ có 1 xung đột → giữ message ngắn gọn như cũ.
        // Nếu nhiều → gộp thành nhiều dòng, mỗi dòng cho 1 loại phòng.
        const buildLine = (c) => {
          if (c.kind === "hold") {
            return `Đang có khách đặt ${c.blockedCount} phòng cho loại phòng "${c.roomTypeName}"${c.hotelLabel}. Vui lòng chọn loại phòng khác.`;
          }
          if (c.kind === "paid") {
            return `Đã có khách đặt ${c.blockedCount} phòng cho loại phòng "${c.roomTypeName}"${c.hotelLabel}, hiện loại phòng đó còn ${c.availableForClient} phòng.`;
          }
          return `Loại phòng "${c.roomTypeName}"${c.hotelLabel} chỉ còn ${c.availableForClient} phòng. Vui lòng chọn lại.`;
        };

        const message =
          roomConflicts.length === 1
            ? buildLine(roomConflicts[0])
            : "Một số loại phòng bạn chọn không còn đủ:\n" +
              roomConflicts.map((c, i) => `${i + 1}. ${buildLine(c)}`).join("\n");

        _firePressureNotifyForGroups(groups).catch(() => {});
        return res.json({
          code: "room_unavailable",
          message,
        });
      }
    }

    // Lấy user đang đăng nhập (nếu có) từ middleware attachUser
    const currentUser = req.account || null;
    const userId = currentUser?._id || null;
    const userName = currentUser?.fullName || currentUser?.email || "";

    const holdExpiresAt = moment().add(15, "minutes").toDate();

    // Tên công ty cho audit log (tránh hiển thị ObjectId thô trong "Thay đổi")
    const _CompanyForAudit = require("../../models/company.model");
    const _validCompanyIds = companyIds.filter((id) =>
      mongoose.Types.ObjectId.isValid(String(id))
    );
    const _companiesForAudit = _validCompanyIds.length
      ? await _CompanyForAudit.find({ _id: { $in: _validCompanyIds } })
          .select("_id name")
          .lean()
      : [];
    const _companyNameById = Object.fromEntries(
      _companiesForAudit.map((c) => [String(c._id), c.name])
    );

    // Tạo đơn cho từng công ty
    const createdOrders = [];
    for (const cid of companyIds) {
      const { items, subTotal } = groups[cid];

      const code = "OD" + generateRandomNumber(10);
      const discount = 0;
      const total = subTotal - discount;

      const newRecord = new Order({
        code,
        fullName: (body.fullName || "").trim(),
        phone: (body.phone || "").trim(),
        email: (body.email || "").trim(),
        cccdImages: Array.isArray(body.cccdImages) ? body.cccdImages : [],
        note: body.note || "",
        items,
        subTotal,
        discount,
        total,
        paymentMethod: body.paymentMethod,
        paymentStatus: "unpaid",
        status: "initial",

        ...(userId ? { userId } : {}),
        ...(userName ? { userName } : {}),

        isTemporaryHold: true,
        holdExpiresAt,
      });

      await newRecord.save();

      auditLogHelper.log(req, {
        action: "customer.order.create",
        resourceType: "Order",
        resourceId: newRecord._id,
        resourceLabel: code,
        after: {
          total,
          subTotal,
          paymentMethod: newRecord.paymentMethod,
          companyName: _companyNameById[String(cid || "")] || "",
          items: items.length,
        },
        asCompanyId: cid || null,
        summary: `Khách đặt tour — đơn "${code}" (${items.length} tour, tổng ${total})`,
        metadata: {
          phone: body.phone || "",
          email: body.email || "",
        },
      });

      // ── Tạo HotelBooking hold cho roomSelections (mode "private") ──
      // Nếu có roomAssignments[] (đơn mới), inject tên hành khách vào note
      // để admin /admin/hotel/tour-assignments thấy được ai ở phòng nào.
      for (const item of items) {
        if (item.accommodationMode === "shared") continue;
        if (!Array.isArray(item.roomSelections) || item.roomSelections.length === 0) continue;
        const itemPaxByIdx = new Map();
        for (const p of item.passengers || []) {
          if (typeof p.idx === "number") itemPaxByIdx.set(p.idx, p);
        }
        for (const sel of item.roomSelections) {
          for (let i = 0; i < sel.selectedRooms; i++) {
            const assignment = (sel.roomAssignments || []).find(
              (a) => a.roomIndex === i
            );
            const paxLabels = [];
            if (assignment && Array.isArray(assignment.passengerIdxs)) {
              for (const idx of assignment.passengerIdxs) {
                const p = itemPaxByIdx.get(idx);
                if (!p) continue;
                const typeShort =
                  p.type === "child" ? "TE" : p.type === "baby" ? "EB" : "NL";
                paxLabels.push(
                  `${p.name || "Hành khách #" + (idx + 1)} (${typeShort})`
                );
              }
            }
            const noteSuffix = paxLabels.length
              ? " | " + paxLabels.join(", ")
              : "";
            await new HotelBooking({
              code: "HB" + generateRandomNumber(10),
              guest: {
                fullName: (body.fullName || "").trim(),
                phone: (body.phone || "").trim(),
                email: (body.email || "").trim(),
              },
              checkIn: new Date(sel.fromDate),
              checkOut: new Date(sel.toDate),
              adults: sel.baseOccupancy || 2,
              children: 0,
              rooms: 1,
              roomTypeId: sel.roomTypeId,
              hotel: {
                hotelId: sel.hotelId,
                name: sel.hotelName,
              },
              status: "pending",
              paymentStatus: "unpaid",
              paymentMethod: body.paymentMethod || "money",
              note: `[Tour Booking] Đặt phòng qua tour - Đơn ${code}${noteSuffix}`,
              tourSegmentId: sel.tourSegmentId,
              isTemporaryHold: true,
              holdExpiresAt,
              orderCode: code,
              ...(userId ? { userId } : {}),
            }).save();
          }
        }
      }

      // ── Auto-assign mode "shared" → chiếm TH (Tour Hold) sẵn có ──
      // Với mỗi entry trong `hotelAllocations[].roomAssignments[]` (= 1 phòng
      // vật lý đã được hệ thống tự gán), thay vì tạo HotelBooking mới (không
      // có roomId), chiếm dụng 1 TH HotelBooking cùng segment + hotel +
      // roomType + dates đang ở trạng thái "[Tour Hold]" (chưa gán khách),
      // gắn với khách hàng đặt tour, đồng thời push vào TourSegment.assignments
      // để admin /admin/hotel/tour-assignments hiển thị phòng cụ thể được gán.
      const _segCacheById = {}; // segId -> { doc, usedHoldIds:Set }
      const _hotelDocCache = {}; // hotelId -> { _id, rooms, name }
      const pendingSegPushes = {}; // segId -> Array<assignment>

      const _getSegment = async (segId) => {
        const k = String(segId);
        if (_segCacheById[k]) return _segCacheById[k];
        const doc = await TourSegment.findById(k)
          .select("assignments")
          .lean();
        const used = new Set(
          (doc?.assignments || [])
            .map((a) => (a.holdBookingId ? String(a.holdBookingId) : ""))
            .filter(Boolean)
        );
        _segCacheById[k] = { doc, usedHoldIds: used };
        return _segCacheById[k];
      };

      const _getHotelDoc = async (hotelId) => {
        const k = String(hotelId);
        if (_hotelDocCache[k]) return _hotelDocCache[k];
        const doc = await Hotel.findById(k).select("rooms name").lean();
        _hotelDocCache[k] = doc || null;
        return doc || null;
      };

      for (const item of items) {
        if (item.accommodationMode !== "shared") continue;
        if (!Array.isArray(item.sharedRoomRequest) || !item.sharedRoomRequest.length) continue;
        for (const r of item.sharedRoomRequest) {
          const segCache = await _getSegment(r.tourSegmentId);
          for (const alloc of r.hotelAllocations || []) {
            const hotelDoc = await _getHotelDoc(alloc.hotelId);
            for (const ra of alloc.roomAssignments || []) {
              const noteTxt = `[Tour Booking - Ở ghép] Đặt phòng qua tour - Đơn ${code}${
                Array.isArray(ra.atomLabels) && ra.atomLabels.length
                  ? " | " + ra.atomLabels.join(" || ")
                  : ""
              }`;
              const guestFullName =
                (body.fullName || "").trim() || "Khách tour";

              // ── Trường hợp ghép cross-order: ra._reuseThId trỏ vào TH đã có
              //   khách đơn khác đang ở ghép. KHÔNG đổi guest của TH; chỉ
              //   append note + push entry tourSeg.assignments với cùng
              //   holdBookingId (multi-occupant share).
              let pickedTh = null;
              if (ra._reuseThId) {
                const reuse = await HotelBooking.findById(ra._reuseThId)
                  .select("_id roomId roomTypeId hotel guest note")
                  .lean();
                if (reuse) {
                  pickedTh = reuse;
                  // Append marker đơn này vào note để admin thấy nhiều khách
                  // đang share phòng. Format: "...|| đơn OD1234: AtomLabel".
                  const appendStr = `|| Đơn ${code}: ${
                    Array.isArray(ra.atomLabels) && ra.atomLabels.length
                      ? ra.atomLabels.join(" || ")
                      : guestFullName
                  }`;
                  const newNote = (reuse.note || "") + " " + appendStr;
                  await HotelBooking.findByIdAndUpdate(reuse._id, {
                    $set: { note: newNote },
                  });
                }
              }

              // Nếu không reuse được → chiếm TH trống mới như cũ.
              // ATOMIC: claim từng TH bằng findOneAndUpdate có điều kiện
              // (guest.fullName vẫn là "[Tour Hold]" và orderCode trống).
              // Tránh race condition khi 2 đơn cùng được submit gần như đồng
              // thời pick cùng 1 TH (cùng pool candidates) → cả 2 cùng nhảy
              // vào 1 phòng vật lý gây overcap/ghép sai giới.
              if (!pickedTh) {
                const candidates = await HotelBooking.find({
                  tourSegmentId: String(r.tourSegmentId),
                  "hotel.hotelId": alloc.hotelId,
                  roomTypeId: ra.roomTypeId,
                  roomId: { $ne: null },
                  checkIn: new Date(r.fromDate),
                  checkOut: new Date(r.toDate),
                  status: { $nin: ["cancelled", "checked_out"] },
                  "guest.fullName": "[Tour Hold]",
                  $or: [
                    { orderCode: { $in: [null, ""] } },
                    { orderCode: { $exists: false } },
                  ],
                })
                  .select("_id roomId roomTypeId hotel")
                  .lean();

                for (const cand of candidates) {
                  const cid = String(cand._id);
                  if (segCache.usedHoldIds.has(cid)) continue;
                  // Atomic claim — chỉ thành công nếu TH này VẪN còn ở
                  // trạng thái "[Tour Hold]" (chưa bị đơn khác chiếm trong
                  // race). Nếu thất bại (null) → thử candidate tiếp theo.
                  const claimed = await HotelBooking.findOneAndUpdate(
                    {
                      _id: cand._id,
                      "guest.fullName": "[Tour Hold]",
                      $or: [
                        { orderCode: { $in: [null, ""] } },
                        { orderCode: { $exists: false } },
                      ],
                    },
                    {
                      $set: {
                        "guest.fullName": guestFullName,
                        "guest.phone": (body.phone || "").trim(),
                        "guest.email": (body.email || "").trim(),
                        orderCode: code,
                        note: noteTxt,
                        paymentStatus: "unpaid",
                        paymentMethod: body.paymentMethod || "money",
                        ...(userId ? { userId } : {}),
                      },
                    },
                    { new: true }
                  );
                  if (!claimed) continue;
                  pickedTh = claimed;
                  segCache.usedHoldIds.add(cid);
                  break;
                }
              }

              if (pickedTh) {
                let roomNumber = "";
                if (hotelDoc && Array.isArray(hotelDoc.rooms)) {
                  const rDoc = hotelDoc.rooms.find(
                    (rr) => String(rr._id) === String(pickedTh.roomId)
                  );
                  if (rDoc) roomNumber = rDoc.roomNumber || "";
                }
                const segKey = String(r.tourSegmentId);
                if (!pendingSegPushes[segKey]) pendingSegPushes[segKey] = [];
                pendingSegPushes[segKey].push({
                  orderId: newRecord._id,
                  orderCode: code,
                  guestName: guestFullName,
                  phone: (body.phone || "").trim(),
                  numPeople:
                    Number(ra.usedCapacity) ||
                    Number(ra.baseOccupancy) ||
                    2,
                  hotelId: new mongoose.Types.ObjectId(alloc.hotelId),
                  hotelName: alloc.hotelName || hotelDoc?.name || "",
                  roomId: pickedTh.roomId,
                  roomNumber,
                  roomTypeName: ra.roomTypeName || "",
                  holdBookingId: pickedTh._id,
                  accommodationMode: "shared",
                  gender: ra.gender || null,
                  atomLabels: Array.isArray(ra.atomLabels) ? ra.atomLabels : [],
                  // anchorIdx (NL ≥ 18) — giúp getPartialSharedRooms về sau
                  // resolve effSize/gender chính xác (không phụ thuộc parse
                  // atomLabels) khi đơn khác auto-assign vào cùng phòng.
                  atomAnchorIdxs: Array.isArray(ra.atomAnchorIdxs)
                    ? ra.atomAnchorIdxs.map(Number).filter((n) => Number.isFinite(n))
                    : [],
                });
              } else {
                // Fallback (không nên xảy ra do feasibility đã check): vẫn
                // tạo HotelBooking dạng cũ để trừ phòng còn lại — admin sẽ
                // gán thủ công sau.
                await new HotelBooking({
                  code: "HB" + generateRandomNumber(10),
                  guest: {
                    fullName: guestFullName,
                    phone: (body.phone || "").trim(),
                    email: (body.email || "").trim(),
                  },
                  checkIn: new Date(r.fromDate),
                  checkOut: new Date(r.toDate),
                  adults: ra.baseOccupancy || 2,
                  children: 0,
                  rooms: 1,
                  roomTypeId: ra.roomTypeId,
                  hotel: {
                    hotelId: alloc.hotelId,
                    name: alloc.hotelName,
                  },
                  status: "pending",
                  paymentStatus: "unpaid",
                  paymentMethod: body.paymentMethod || "money",
                  note: noteTxt,
                  tourSegmentId: r.tourSegmentId,
                  isTemporaryHold: true,
                  holdExpiresAt,
                  orderCode: code,
                  ...(userId ? { userId } : {}),
                }).save();
              }
            }
          }
        }
      }

      // ── Pre-persist validation (last line of defense) ──
      // Trước khi push assignments mới vào TourSegment, tái-kiểm phòng vật
      // lý (theo holdBookingId): tổng numPeople (assignments cũ + assignments
      // sắp push) KHÔNG được vượt baseOccupancy của loại phòng, và toàn bộ
      // phải cùng giới tính. Đây là LƯỚI AN TOÀN cuối cùng khi race condition
      // hoặc bug ở các bước trước khiến 2 đơn cùng cố nhồi vào 1 TH.
      //
      // Nếu phát hiện vi phạm → ROLLBACK:
      //   • Reset các HotelBooking đã update về "[Tour Hold]" + clear orderCode.
      //   • Xoá Order vừa save và các HotelBooking legacy đã tạo (orderCode=code).
      //   • Trả lỗi cho client.
      {
        const claimedThIds = [];
        for (const arr of Object.values(pendingSegPushes)) {
          for (const entry of arr || []) {
            if (entry.holdBookingId) claimedThIds.push(String(entry.holdBookingId));
          }
        }
        const segIdsToCheck = Object.keys(pendingSegPushes);
        let conflictMsg = null;
        for (const segId of segIdsToCheck) {
          if (conflictMsg) break;
          const arr = pendingSegPushes[segId] || [];
          if (!arr.length) continue;

          const segDoc = await TourSegment.findById(segId)
            .select("assignments")
            .lean();
          const existing = (segDoc?.assignments || []).filter(
            (a) => a && a.holdBookingId
          );
          const groupedByHold = {};
          for (const a of existing) {
            const k = String(a.holdBookingId);
            if (!groupedByHold[k]) groupedByHold[k] = [];
            groupedByHold[k].push({
              numPeople: Number(a.numPeople) || 0,
              gender: a.gender || null,
              accommodationMode: a.accommodationMode || "private",
              roomNumber: a.roomNumber || "",
            });
          }
          for (const entry of arr) {
            const k = String(entry.holdBookingId);
            if (!groupedByHold[k]) groupedByHold[k] = [];
            groupedByHold[k].push({
              numPeople: Number(entry.numPeople) || 0,
              gender: entry.gender || null,
              accommodationMode: entry.accommodationMode || "private",
              roomNumber: entry.roomNumber || "",
            });
          }

          // Lookup capacity từ HotelBooking → Hotel.roomTypes.
          const thIds = Object.keys(groupedByHold);
          const ths = await HotelBooking.find({ _id: { $in: thIds } })
            .select("_id hotel roomTypeId")
            .lean();
          const thById = Object.fromEntries(ths.map((t) => [String(t._id), t]));
          const hotelIdsUsed = [
            ...new Set(ths.map((t) => String(t.hotel?.hotelId || "")).filter(Boolean)),
          ];
          const Hotel = require("../../models/hotel.model");
          const hotelDocs = await Hotel.find({ _id: { $in: hotelIdsUsed } })
            .select("roomTypes")
            .lean();
          const hotelById = Object.fromEntries(
            hotelDocs.map((h) => [String(h._id), h])
          );

          for (const thId of thIds) {
            const list = groupedByHold[thId];
            // Chỉ xét nhóm có ÍT NHẤT 1 entry shared (private = 1 đơn/phòng,
            // không cần check ghép cùng phòng).
            const sharedList = list.filter(
              (x) => x.accommodationMode === "shared"
            );
            if (sharedList.length === 0) continue;

            const th = thById[thId];
            if (!th) continue;
            const hotel = hotelById[String(th.hotel?.hotelId || "")];
            const rt = hotel
              ? (hotel.roomTypes || []).find(
                  (x) => String(x._id) === String(th.roomTypeId)
                )
              : null;
            const cap =
              rt && Number.isFinite(Number(rt.baseOccupancy))
                ? Math.max(1, Math.round(Number(rt.baseOccupancy)))
                : 0;
            if (cap <= 0) continue;

            const totalUsed = sharedList.reduce(
              (s, x) => s + (Number(x.numPeople) || 0),
              0
            );
            const genders = new Set(
              sharedList.map((x) => x.gender).filter((g) => g === "male" || g === "female")
            );
            const roomNumber = list[0].roomNumber || "?";
            if (totalUsed > cap) {
              conflictMsg =
                `Phòng ${roomNumber} bị vượt sức chứa khi xếp khách ` +
                `(${totalUsed}/${cap}). Có thể do một đơn khác vừa giữ chỗ ` +
                `cùng phòng. Vui lòng thử lại hoặc liên hệ công ty du lịch.`;
              break;
            }
            if (genders.size > 1) {
              conflictMsg =
                `Phòng ${roomNumber} bị ghép khách khác giới khi xếp tự động. ` +
                `Có thể do một đơn khác vừa giữ chỗ cùng phòng. ` +
                `Vui lòng thử lại hoặc chuyển sang ở riêng.`;
              break;
            }
          }
        }

        if (conflictMsg) {
          // ── ROLLBACK ──
          // 1) Reset các TH đã claim về [Tour Hold] + clear orderCode/userId.
          try {
            if (claimedThIds.length > 0) {
              await HotelBooking.updateMany(
                { _id: { $in: claimedThIds } },
                {
                  $set: {
                    "guest.fullName": "[Tour Hold]",
                    "guest.phone": "",
                    "guest.email": "",
                    status: "confirmed",
                    isTemporaryHold: false,
                  },
                  $unset: { orderCode: "", holdExpiresAt: "", userId: "" },
                }
              );
            }
          } catch (rollbackErr) {
            console.error("[createPost rollback resetTH]", rollbackErr);
          }
          // 2) Xoá HotelBooking legacy (orderCode=code) — fallback rooms đã
          //    tạo mới (line ~1442) cũng cần xoá.
          try {
            if (code) await HotelBooking.deleteMany({ orderCode: code });
          } catch (rollbackErr) {
            console.error("[createPost rollback delHB]", rollbackErr);
          }
          // 3) Xoá Order vừa save.
          try {
            await Order.deleteOne({ _id: newRecord._id });
          } catch (rollbackErr) {
            console.error("[createPost rollback delOrder]", rollbackErr);
          }
          // 4) Khôi phục lại ghế đã trừ (best-effort).
          try {
            await _restoreSeatsForGroups(groups);
          } catch (rollbackErr) {
            console.error("[createPost rollback restoreSeats]", rollbackErr);
          }
          return res.json({ code: "error", message: conflictMsg });
        }
      }

      // Persist các assignment mới vào từng TourSegment (1 update/segId).
      for (const segId of Object.keys(pendingSegPushes)) {
        const arr = pendingSegPushes[segId];
        if (!arr.length) continue;
        await TourSegment.updateOne(
          { _id: segId },
          { $push: { assignments: { $each: arr } } }
        );
      }

      // Notify khách hàng biết phòng vừa được xếp — chỉ cho non-VNPay.
      // VNPay: notify được dời sang paymentVNPayResult sau khi giao dịch xác nhận.
      const allNewAssignments = Object.values(pendingSegPushes).flat();
      if (
        allNewAssignments.length > 0 &&
        body.paymentMethod !== "vnpay" &&
        (userId || (body.email || "").trim())
      ) {
        try {
          const roomLines = allNewAssignments.map((a) => {
            const parts = [];
            if (a.hotelName) parts.push(a.hotelName);
            if (a.roomNumber) parts.push(`Phòng ${a.roomNumber}`);
            if (a.roomTypeName) parts.push(`(${a.roomTypeName})`);
            return parts.join(" — ");
          });
          const tourNameForNotify =
            (items.find((i) => i.accommodationMode === "shared") || items[0])
              ?.name || "Tour";
          await notifyCustomerOrderUpdate({
            userId: userId || null,
            email: (body.email || "").trim() || null,
            customerName: (body.fullName || "").trim() || null,
            type: "room_assignment",
            resourceLabel: code,
            orderCode: code,
            orderId: newRecord._id,
            link: buildTourOrderProfileLink(code, "initial"),
            changes: roomLines.map((line) => ({
              label: "Phòng được xếp",
              from: null,
              to: line,
            })),
            introLine: `Bạn đã được xếp phòng cho chuyến đi "${tourNameForNotify}".`,
          });
        } catch (notifyErr) {
          console.error("[createPost] room-assign notify:", notifyErr);
        }
      }

      createdOrders.push({
        orderCode: code,
        companyId: cid || null,
        phone: body.phone,
        total,
      });

      // ── Gửi thông báo cho company admin ──
      if (cid && body.paymentMethod !== "vnpay") {
        try {
          const pmName =
            body.paymentMethod === "bank" ? "Chuyển khoản ngân hàng" : "Tiền mặt";
          const tourNames = items.map((i) => i.name).filter(Boolean).join(", ");
          const fullName = (body.fullName || "").trim();
          await Notification.create({
            companyId: cid,
            type: "order",
            title: "Đơn tour mới",
            content: `${fullName} đã đặt tour: ${tourNames} (${pmName})`,
            link: `/${pathAdmin}/order/edit/${newRecord._id}`,
            metadata: {
              bookingCode: code,
              customerName: fullName,
              paymentMethod: pmName,
              amount: total,
            },
          });
        } catch (notifErr) {
          console.error("Error creating order notification:", notifErr);
        }
      }
    }

    _firePressureNotifyForGroups(groups).catch(() => {});
    return res.json({
      code: "success",
      message: "Tạo đơn hàng thành công!",
      isMulti: createdOrders.length > 1,
      orders: createdOrders,
    });
  } catch (error) {
    console.error("order.createPost error:", error);
    // Cố gắng hoàn lại ghế đã decrement nếu có lỗi bất ngờ ở giữa luồng,
    // tránh ghế bị "kẹt" do chưa kịp tạo Order.
    try {
      await _restoreSeatsForGroups(groups);
    } catch (restoreErr) {
      console.error("order.createPost restore error:", restoreErr);
    }
    return res.json({ code: "error", message: "Dữ liệu không hợp lệ!" });
  }
};

/**
 * GET /order/pending?orderCode=...&phone=...
 * Hiển thị trang đơn tour đang chờ xác nhận / thanh toán
 */
module.exports.pending = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.redirect("/");
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    }).lean();

    if (!orderDetail) {
      return res.redirect("/");
    }

    // Nếu đã thanh toán → chuyển thẳng sang trang thành công
    if (orderDetail.paymentStatus === "paid") {
      return res.redirect(
        `/order/success?orderCode=${orderDetail.code}&phone=${phone}`
      );
    }

    // Nếu đơn tạm đã hết hạn mà chưa thanh toán → tự động hủy và restore ghế
    if (
      orderDetail.isTemporaryHold &&
      orderDetail.paymentStatus === "unpaid" &&
      orderDetail.holdExpiresAt &&
      new Date() > new Date(orderDetail.holdExpiresAt)
    ) {
      await _cancelHoldAndRestoreSeats(orderDetail);
      return res.redirect("/?expired=1");
    }

    // Gắn tên hiển thị cho phương thức thanh toán
    const pm = paymentMethodList.find((item) => item.value === orderDetail.paymentMethod);
    orderDetail.paymentMethodName = pm ? pm.label : "Không xác định";

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format("HH:mm - DD/MM/YYYY");

    // Format ngày khởi hành và tên thành phố cho từng item
    for (const item of orderDetail.items) {
      const departureDisplay =
        (item.departureDateDisplay && String(item.departureDateDisplay).trim()) ||
        (item.departureDate ? moment(item.departureDate).format("DD/MM/YYYY") : "");
      item.departureDateFormat = departureDisplay;

      const cityId = item.departureCity || item.locationFrom || null;
      if (cityId) {
        const city = await City.findOne({ _id: cityId });
        item.cityName = city ? city.name : "";
      } else {
        item.cityName = "";
      }
      enrichItemBabySeatsDisplay(item);
    }

    return res.render("client/pages/order-pending", {
      pageTitle: "Đơn tour đang chờ xác nhận",
      orderDetail,
      phone,
      transferProofImages: orderDetail.transferProofImages || [],
    });
  } catch (error) {
    console.error("order.pending error:", error);
    return res.redirect("/");
  }
};

/**
 * GET /order/success?orderCode=...&phone=...
 * Hiển thị trang "Đặt hàng thành công"
 */
module.exports.success = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.redirect("/");
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!orderDetail) {
      return res.redirect("/");
    }

    // Gắn tên hiển thị cho method/status (tránh lỗi khi không tìm thấy)
    const pm = paymentMethodList.find(
      (item) => item.value === orderDetail.paymentMethod
    );
    const ps = paymentStatusList.find(
      (item) => item.value === orderDetail.paymentStatus
    );
    const st = statusList.find((item) => item.value === orderDetail.status);

    orderDetail.paymentMethodName = pm ? pm.label : "Không xác định";
    orderDetail.paymentStatusName = ps ? ps.label : "Không xác định";
    orderDetail.statusName = st ? st.label : "Không xác định";

    orderDetail.createdAtFormat = moment(orderDetail.createdAt).format(
      "HH:mm - DD/MM/YYYY"
    );

    // Lấy company slugs cho các tour
    const tourSlugs = orderDetail.items
      .map((it) => it.slug)
      .filter(Boolean);
    let companySlugMap = {};
    if (tourSlugs.length > 0) {
      const Tour = require("../../models/tour.model");
      const Company = require("../../models/company.model");
      const tours = await Tour.find({ slug: { $in: tourSlugs } })
        .select("slug companyId")
        .lean();
      const companyIds = [...new Set(tours.map((t) => t.companyId).filter(Boolean))];
      if (companyIds.length > 0) {
        const companies = await Company.find({ _id: { $in: companyIds } })
          .select("_id slug")
          .lean();
        const companyMap = Object.fromEntries(
          companies.map((c) => [String(c._id), c.slug])
        );
        companySlugMap = Object.fromEntries(
          tours.map((t) => [t.slug, companyMap[String(t.companyId)] || null])
        );
      }
    }

    // Bổ sung cityName + format ngày khởi hành cho từng item
    for (const item of orderDetail.items) {
      // Ưu tiên ngày khởi hành mà khách đã chọn khi đặt (departureDateDisplay),
      // nếu không có thì fallback về departureDate (ngày mặc định của tour)
      const departureDisplay =
        (item.departureDateDisplay &&
          String(item.departureDateDisplay).trim()) ||
        (item.departureDate
          ? moment(item.departureDate).format("DD/MM/YYYY")
          : "");
      item.departureDateFormat = departureDisplay;

      // Ưu tiên departureCity, fallback locationFrom để không lỗi đơn cũ
      const cityId = item.departureCity || item.locationFrom || null;

      if (cityId) {
        const city = await City.findOne({ _id: cityId });
        item.cityName = city ? city.name : "";
      } else {
        item.cityName = "";
      }

      // Thêm company slug
      item.companySlug = item.slug ? (companySlugMap[item.slug] || null) : null;
      enrichItemBabySeatsDisplay(item);
    }

    return res.render("client/pages/order-success", {
      pageTitle: "Đặt hàng thành công",
      orderDetail,
    });
  } catch (error) {
    console.error("order.success error:", error);
    return res.redirect("/");
  }
};

module.exports.paymentVNPay = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode && !phone) {
      res.redirect("/");
      return;
    }

    const orderDetail = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!orderDetail) {
      res.redirect("/");
      return;
    }

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
    let returnUrl = `${process.env.WEBSITE_DOMAIN}/order/payment-vnpay-result`;
    let orderId = `${orderCode}-${phone}-${Date.now()}`;
    let amount = orderDetail.total;
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
    vnp_Params["vnp_OrderInfo"] = "Thanh toan cho ma GD:" + orderId;
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
    console.log(error);
    res.redirect("/");
  }
};

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
      //Kiem tra xem du lieu trong db co hop le hay khong va thong bao ket qua
      const [orderCode, phone] = vnp_Params["vnp_TxnRef"].split("-");
      
      // Kiểm tra mã phản hồi từ VNPay
      const responseCode = vnp_Params["vnp_ResponseCode"];
      
      if (responseCode === "00") {
        // Giao dịch thành công
        await Order.updateOne(
          { code: orderCode, phone: phone },
          {
            paymentStatus:   "paid",
            isTemporaryHold: false,
            holdExpiresAt:   null,
          }
        );

        // Notify phân phòng cho đơn VNPay (xếp phòng đã xong ở createPost,
        // nhưng thông báo chỉ gửi sau khi thanh toán được xác nhận).
        try {
          const paidOrder = await Order.findOne({ code: orderCode, phone })
            .select("_id code userId email fullName items status")
            .lean();
          if (paidOrder) {
            const sharedItems = (paidOrder.items || []).filter(
              (i) => i.accommodationMode === "shared"
            );
            if (sharedItems.length > 0 && (paidOrder.userId || paidOrder.email)) {
              // Tìm assignments tương ứng trong TourSegment
              const segIds = [
                ...new Set(
                  sharedItems
                    .flatMap((i) => (i.sharedRoomRequest || []).map((r) => String(r.tourSegmentId)))
                    .filter(Boolean)
                ),
              ];
              if (segIds.length > 0) {
                const segs = await TourSegment.find({ _id: { $in: segIds } })
                  .select("assignments")
                  .lean();
                const assignedRooms = [];
                for (const seg of segs) {
                  for (const a of seg.assignments || []) {
                    if (String(a.orderId) === String(paidOrder._id)) {
                      const parts = [];
                      if (a.hotelName) parts.push(a.hotelName);
                      if (a.roomNumber) parts.push(`Phòng ${a.roomNumber}`);
                      if (a.roomTypeName) parts.push(`(${a.roomTypeName})`);
                      if (parts.length > 0) assignedRooms.push(parts.join(" — "));
                    }
                  }
                }
                if (assignedRooms.length > 0) {
                  const tourName =
                    sharedItems[0]?.name || "Tour";
                  await notifyCustomerOrderUpdate({
                    userId: paidOrder.userId || null,
                    email: paidOrder.email || null,
                    customerName: paidOrder.fullName || null,
                    type: "room_assignment",
                    resourceLabel: orderCode,
                    orderCode,
                    orderId: paidOrder._id,
                    link: buildTourOrderProfileLink(orderCode, paidOrder.status),
                    changes: assignedRooms.map((line) => ({
                      label: "Phòng được xếp",
                      from: null,
                      to: line,
                    })),
                    introLine: `Thanh toán thành công! Bạn đã được xếp phòng cho chuyến đi "${tourName}".`,
                  });
                }
              }
            }
          }
        } catch (notifyErr) {
          console.error("[paymentVNPayResult] room-assign notify:", notifyErr);
        }

        return res.redirect(
          `${process.env.WEBSITE_DOMAIN}/order/success?orderCode=${orderCode}&phone=${phone}`
        );
      } else {
        // Giao dịch thất bại
        console.log("VNPay payment failed with response code:", responseCode);
        return res.redirect("/?message=Thanh toán không thành công. Vui lòng thử lại.");
      }
    } else {
      // Chữ ký không hợp lệ - có thể bị giả mạo
      console.error("VNPay signature verification failed");
      return res.redirect("/?message=Xác thực thanh toán thất bại. Vui lòng liên hệ hỗ trợ.");
    }
  } catch (error) {
    console.log(error);
    res.redirect("/");
  }
};

/**
 * GET /order/cancel-hold?orderCode=...&phone=...
 * Hủy đơn tạm (được gọi từ client khi countdown về 0 hoặc khi khách chủ động hủy)
 */
module.exports.cancelHold = async (req, res) => {
  try {
    // Hỗ trợ cả GET (query string) và POST (sendBeacon gửi body dạng text/plain)
    let orderCode = req.query.orderCode || req.body?.orderCode;
    let phone     = req.query.phone     || req.body?.phone;

    // sendBeacon gửi body dạng "orderCode=X&phone=Y" (URLSearchParams)
    if (!orderCode && req.body && typeof req.body === "string") {
      const params = new URLSearchParams(req.body);
      orderCode = params.get("orderCode");
      phone     = params.get("phone");
    }
    if (!orderCode || !phone) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    const order = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    }).lean();

    if (!order) {
      return res.json({ code: "error", message: "Không tìm thấy đơn hàng" });
    }

    if (order.paymentStatus === "paid") {
      return res.json({ code: "error", message: "Đơn đã thanh toán, không thể hủy" });
    }

    if (order.status === "cancel") {
      return res.json({ code: "ok", message: "Đơn đã hủy trước đó" });
    }

    // Nếu đơn còn trong thời hạn hold VÀ request đến từ sendBeacon (không phải
    // user chủ động hủy), giữ nguyên đơn — cron sẽ xử lý khi hết hạn.
    // Phân biệt: user chủ động hủy qua nút → gửi thêm header X-Cancel-Reason: explicit
    const isExplicit = req.headers["x-cancel-reason"] === "explicit" ||
                       req.method === "GET"; // GET = gọi từ countdown hoặc nút "Hủy đơn"
    const isExpired  = order.holdExpiresAt && new Date() > new Date(order.holdExpiresAt);

    if (!isExpired && !isExplicit) {
      // sendBeacon gửi do refresh hoặc điều hướng trong khi đơn chưa hết hạn
      // → KHÔNG hủy, để giữ cho user có thể quay lại thanh toán
      return res.json({ code: "skipped", message: "Đơn chưa hết hạn, giữ nguyên" });
    }

    await _cancelHoldAndRestoreSeats(order);

    return res.json({ code: "success", message: "Đã hủy đơn và hoàn lại ghế" });
  } catch (err) {
    console.error("order.cancelHold error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

/**
 * PATCH /order/transfer-proof
 * Lưu ảnh chứng từ chuyển khoản do khách hàng gửi lên
 * Body: { orderCode, phone, images: [url, ...] }
 */
module.exports.saveTransferProof = async (req, res) => {
  try {
    const { orderCode, phone, images } = req.body;

    if (!orderCode || !phone || !Array.isArray(images) || images.length === 0) {
      return res.json({ code: "error", message: "Dữ liệu không hợp lệ" });
    }

    const order = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    });

    if (!order) {
      return res.json({ code: "error", message: "Không tìm thấy đơn hàng" });
    }

    if (order.paymentStatus === "paid") {
      return res.json({ code: "error", message: "Đơn đã thanh toán" });
    }

    await Order.updateOne(
      { _id: order._id },
      { $push: { transferProofImages: { $each: images } } }
    );

    return res.json({ code: "ok", message: "Đã lưu ảnh chứng từ thành công" });
  } catch (err) {
    console.error("order.saveTransferProof error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

/**
 * GET /order/check-payment-status?orderCode=...&phone=...
 * Trả về trạng thái thanh toán của đơn hàng (dùng cho polling phía client)
 */
module.exports.checkPaymentStatus = async (req, res) => {
  try {
    const { orderCode, phone } = req.query;

    if (!orderCode || !phone) {
      return res.json({ code: "error", message: "Thiếu tham số" });
    }

    const order = await Order.findOne({
      code: orderCode,
      phone: phone,
      deleted: false,
    })
      .select("paymentStatus")
      .lean();

    if (!order) {
      return res.json({ code: "error", message: "Không tìm thấy đơn hàng" });
    }

    return res.json({ code: "ok", paymentStatus: order.paymentStatus });
  } catch (err) {
    console.error("order.checkPaymentStatus error:", err);
    return res.json({ code: "error", message: "Lỗi server" });
  }
};

function sortObject(obj) {
  if (typeof obj !== "object" || obj === null) {
    throw new TypeError("Input must be a plain object");
  }

  let sorted = {};
  let str = [];
  let key;

  // Duyệt qua các thuộc tính của đối tượng
  for (key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      str.push(encodeURIComponent(key));
    }
  }

  // Sắp xếp các khóa
  str.sort();

  // Tạo đối tượng mới với các khóa đã sắp xếp
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
  }

  return sorted;
}
