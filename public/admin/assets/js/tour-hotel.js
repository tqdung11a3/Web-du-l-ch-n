/**
 * tour-hotel.js
 * Logic cho trang "Liên kết Tour – Khách sạn" (tour-hotel-detail.pug)
 *
 * Chức năng:
 *  - Thêm/xoá khung thời gian (segment)
 *  - Với mỗi khung: chọn hotel → AJAX lấy tình trạng phòng
 *  - Hiển thị room types + cho phép admin nhập số phòng giữ
 *  - Nút "Gợi ý tự động" → AJAX lấy phân bổ tối thiểu
 *  - Tính tổng capacity real-time
 *  - Lưu bản nháp / Xác nhận & Giữ phòng
 */

(function () {
  // ── Lấy dữ liệu từ thẻ script hidden ───────────────────────────────────────
  const existingData  = JSON.parse(document.getElementById("existing-data")?.textContent || "null");
  const hotelsData    = JSON.parse(document.getElementById("hotels-data")?.textContent   || "[]");
  const departureMeta = JSON.parse(document.getElementById("departure-meta")?.textContent|| "{}");
  const pathAdmin     = JSON.parse(document.getElementById("path-admin")?.textContent    || '""');
  const currentCompanyId = JSON.parse(document.getElementById("current-company-id")?.textContent || '""');
  const isTourOnlyAdmin  = JSON.parse(document.getElementById("is-tour-only-admin")?.textContent || "false");

  /** Thông báo góc màn hình (Notyf), thay alert */
  function toastError(msg) {
    if (typeof notify !== "undefined" && notify && typeof notify.error === "function") {
      notify.error(msg);
    }
  }
  function toastSuccess(msg) {
    if (typeof notify !== "undefined" && notify && typeof notify.success === "function") {
      notify.success(msg);
    }
  }

  /**
   * Hộp thoại xác nhận trong trang (thay window.confirm).
   * @returns {Promise<boolean>}
   */
  function showThConfirm(opts) {
    const message = opts.message || "";
    const title = opts.title || "Xác nhận";
    const confirmText = opts.confirmText || "Tiếp tục";
    const cancelText = opts.cancelText || "Huỷ";

    const wrap = document.getElementById("th-app-dialog");
    if (!wrap) {
      return Promise.resolve(window.confirm(message));
    }

    return new Promise((resolve) => {
      const titleEl = document.getElementById("th-app-dialog-title");
      const bodyEl = document.getElementById("th-app-dialog-body");
      const okBtn = document.getElementById("th-app-dialog-ok");
      const cancelBtn = document.getElementById("th-app-dialog-cancel");
      const closeBtn = document.getElementById("th-app-dialog-close");
      const backdrop = wrap.querySelector(".th-app-dialog__backdrop");

      if (!titleEl || !bodyEl || !okBtn || !cancelBtn || !closeBtn || !backdrop) {
        resolve(window.confirm(message));
        return;
      }

      titleEl.textContent = title;
      bodyEl.textContent = message;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      let settled = false;
      function finish(val) {
        if (settled) return;
        settled = true;
        wrap.classList.remove("is-open");
        wrap.setAttribute("aria-hidden", "true");
        document.removeEventListener("keydown", onKey);
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        closeBtn.removeEventListener("click", onCancel);
        backdrop.removeEventListener("click", onCancel);
        resolve(val);
      }
      function onOk() {
        finish(true);
      }
      function onCancel() {
        finish(false);
      }
      function onKey(ev) {
        if (ev.key === "Escape") onCancel();
      }

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      closeBtn.addEventListener("click", onCancel);
      backdrop.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);

      wrap.classList.add("is-open");
      wrap.setAttribute("aria-hidden", "false");
      okBtn.focus();
    });
  }

  const segmentsWrapper   = document.getElementById("segments-wrapper");
  const addSegmentBtn     = document.getElementById("add-segment-btn");
  const paxInput          = document.getElementById("pax-required");
  const totalCapDisplay   = document.getElementById("total-capacity-display");
  const paxRequiredDisplay= document.getElementById("pax-required-display");
  const capacityStatusItem= document.getElementById("capacity-status-item");
  const saveDraftBtn      = document.getElementById("save-draft-btn");
  const confirmBtn        = document.getElementById("confirm-btn");
  const cancelBtn         = document.getElementById("cancel-btn");

  if (!segmentsWrapper) return; // Trang list, không làm gì

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Khởi tạo dữ liệu từ existing segment ───────────────────────────────────
  function init() {
    if (existingData && existingData.segments && existingData.segments.length > 0) {
      for (const seg of existingData.segments) {
        const segEl = createSegmentElement();
        segmentsWrapper.appendChild(segEl);
        const fromDate = formatDateInput(seg.fromDate);
        const toDate   = formatDateInput(seg.toDate);
        segEl.querySelector(".seg-from-date").value = fromDate;
        segEl.querySelector(".seg-to-date").value   = toDate;
        for (const h of seg.hotels || []) {
          renderRestoredHotel(segEl, h, fromDate, toDate);
        }
        updateSegmentCapacity(segEl);
      }
    } else {
      // Thêm 1 segment trống mặc định
      segmentsWrapper.appendChild(createSegmentElement());
    }
    updateGrandTotal();
    updatePaxDisplay();
  }

  function formatDateInput(dateStr) {
    if (!dateStr) return "";
    return dateStr.substring(0, 10); // "YYYY-MM-DD"
  }

  // ── Tạo 1 phần tử khung thời gian ──────────────────────────────────────────
  function createSegmentElement() {
    const tmpl = document.getElementById("segment-template");
    const clone = tmpl.content.cloneNode(true);
    const el    = clone.querySelector(".th-segment-item");

    // Đổ danh sách hotel vào select (phân biệt cùng/khác company)
    const sel = el.querySelector(".seg-hotel-select");
    for (const h of hotelsData) {
      const opt = document.createElement("option");
      opt.value = h._id;
      const isCross = currentCompanyId && String(h.companyId) !== currentCompanyId;
      const ownerLabel = (h.companyName || "").trim() || "Công ty khác";
      opt.textContent = isCross ? `${h.name} [${ownerLabel}]` : h.name;
      if (isCross) opt.style.color = "#d97706";
      sel.appendChild(opt);
    }

    // Nút Xoá khung
    el.querySelector(".seg-remove-btn").addEventListener("click", () => {
      if (segmentsWrapper.children.length <= 1) {
        el.querySelector(".seg-from-date").value = "";
        el.querySelector(".seg-to-date").value   = "";
        clearHotelsInSegment(el);
        updateSegmentCapacity(el);
        updateGrandTotal();
      } else {
        el.remove();
        updateGrandTotal();
      }
    });

    // Nút Thêm khách sạn
    el.querySelector(".seg-add-hotel-btn").addEventListener("click", () => {
      const hotelId = sel.value;
      if (!hotelId) { toastError("Vui lòng chọn khách sạn trước"); return; }
      const fromDate  = el.querySelector(".seg-from-date").value;
      const toDate    = el.querySelector(".seg-to-date").value;
      if (!fromDate || !toDate) { toastError("Vui lòng chọn ngày từ/đến trước"); return; }
      addHotelToSegment(el, hotelId, false, fromDate, toDate);
    });

    // Nút Gợi ý tự động
    el.querySelector(".seg-suggest-btn").addEventListener("click", () => {
      suggestAllocation(el);
    });

    // Ngày thay đổi → re-fetch phòng trống cho tất cả khách sạn đã có + cập nhật capacity
    const onDateChange = () => refreshHotelsInSegment(el);
    el.querySelector(".seg-from-date").addEventListener("change", onDateChange);
    el.querySelector(".seg-to-date").addEventListener("change",   onDateChange);

    return el;
  }

  // ── Tải lại phòng trống cho tất cả khách sạn trong khung khi ngày thay đổi ──
  async function refreshHotelsInSegment(segEl) {
    const fromDate = segEl.querySelector(".seg-from-date").value;
    const toDate   = segEl.querySelector(".seg-to-date").value;

    // Chưa chọn đủ ngày thì chỉ cập nhật badge
    if (!fromDate || !toDate) {
      updateSegmentCapacity(segEl);
      updateGrandTotal();
      return;
    }

    const cards = segEl.querySelectorAll(".seg-hotel-card");
    if (cards.length === 0) return;

    // Re-fetch song song cho tất cả khách sạn đã có
    const promises = Array.from(cards).map((card) => {
      const hotelId = card.dataset.hotelId;
      return fetchAndRenderRoomTypes(card, hotelId, fromDate, toDate);
    });
    await Promise.all(promises);

    updateSegmentCapacity(segEl);
    updateGrandTotal();
  }

  function clearHotelsInSegment(segEl) {
    segEl.querySelector(".seg-hotels-list").innerHTML = "";
  }

  // ── Thêm khách sạn vào khung (qua AJAX) ────────────────────────────────────
  async function addHotelToSegment(segEl, hotelId, isPrimary, fromDate, toDate) {
    const hotelName = hotelsData.find((h) => h._id == hotelId)?.name || "";

    // Kiểm tra trùng
    const existing = segEl.querySelector(`.seg-hotel-card[data-hotel-id="${hotelId}"]`);
    if (existing) { toastError("Khách sạn này đã được thêm vào khung này"); return; }

    const card = createHotelCard(hotelId, hotelName, isPrimary);
    segEl.querySelector(".seg-hotels-list").appendChild(card);

    await fetchAndRenderRoomTypes(card, hotelId, fromDate, toDate);
    updateSegmentCapacity(segEl);
    updateGrandTotal();
  }

  /**
   * Khôi phục hotel từ dữ liệu đã lưu, nhưng số "Còn trống" luôn gọi API live
   * để phản ánh đúng tình trạng phòng hiện tại trong khoảng ngày của segment.
   */
  async function renderRestoredHotel(segEl, hotelData, fromDate, toDate) {
    const card = createHotelCard(
      String(hotelData.hotelId),
      hotelData.hotelName,
      hotelData.isPrimary
    );
    segEl.querySelector(".seg-hotels-list").appendChild(card);

    const rtContainer = card.querySelector(".seg-room-types");
    const loading = card.querySelector(".seg-room-types-loading");

    const savedByType = new Map();
    for (const ra of hotelData.roomAllocations || []) {
      savedByType.set(String(ra.roomTypeId), ra);
    }

    function renderFromSaved() {
      rtContainer.innerHTML = "";
      for (const ra of hotelData.roomAllocations || []) {
        rtContainer.appendChild(
          createRoomTypeRow(
            ra.roomTypeId,
            ra.roomTypeName,
            ra.baseOccupancy,
            ra.assignedRooms,
            ra.assignedRooms,
            segEl
          )
        );
      }
      renderHotelTotal(card);
    }

    if (!fromDate || !toDate) {
      renderFromSaved();
      return;
    }

    if (loading) loading.style.display = "block";
    try {
      const res = await fetch(
        `/${pathAdmin}/tour-hotel/api/hotel-availability?hotelId=${encodeURIComponent(
          String(hotelData.hotelId)
        )}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`
      );
      const data = await res.json();
      if (loading) loading.style.display = "none";

      if (!data.success || !Array.isArray(data.roomTypes)) {
        renderFromSaved();
        return;
      }

      rtContainer.innerHTML = "";

      const liveIds = new Set(data.roomTypes.map((rt) => String(rt.roomTypeId)));

      for (const rt of data.roomTypes) {
        const saved = savedByType.get(String(rt.roomTypeId));
        const assigned = saved ? saved.assignedRooms : 0;
        const maxSlider = Math.max(rt.availableRooms || 0, assigned);
        rtContainer.appendChild(
          createRoomTypeRow(
            rt.roomTypeId,
            rt.roomTypeName,
            rt.baseOccupancy,
            maxSlider,
            assigned,
            segEl
          )
        );
      }

      for (const ra of hotelData.roomAllocations || []) {
        if (liveIds.has(String(ra.roomTypeId))) continue;
        rtContainer.appendChild(
          createRoomTypeRow(
            ra.roomTypeId,
            ra.roomTypeName,
            ra.baseOccupancy,
            ra.assignedRooms,
            ra.assignedRooms,
            segEl
          )
        );
      }

      renderHotelTotal(card);
      updateSegmentCapacity(segEl);
      updateGrandTotal();
    } catch (e) {
      if (loading) loading.style.display = "none";
      renderFromSaved();
    }
  }

  // ── Tạo card khách sạn ──────────────────────────────────────────────────────
  function createHotelCard(hotelId, hotelName, isPrimary) {
    const card = document.createElement("div");
    card.className = "seg-hotel-card";
    card.dataset.hotelId  = hotelId;
    card.dataset.isPrimary = isPrimary ? "1" : "0";

    const hotelData = hotelsData.find((h) => h._id === hotelId);
    const isCross = hotelData && currentCompanyId && String(hotelData.companyId) !== currentCompanyId;
    const ownerLabel = (hotelData && (hotelData.companyName || "").trim()) || "Công ty khác";
    const crossBadge = isCross
      ? ` <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:6px">${escapeHtml(ownerLabel)}</span>`
      : "";

    card.innerHTML = `
      <div class="seg-hotel-card__header">
        <div class="seg-hotel-card__title">
          <strong>${escapeHtml(hotelName)}</strong>${crossBadge}
        </div>
        <button type="button" class="seg-hotel-remove-btn">
          <i class="fa-solid fa-xmark"></i> Xoá
        </button>
      </div>
      <div class="seg-room-types-loading" style="display:none">
        <i class="fa-solid fa-spinner fa-spin"></i> Đang tải tình trạng phòng...
      </div>
      <div class="seg-room-types"></div>
      <div class="seg-hotel-total">Tổng sức chứa: <strong class="seg-hotel-total-val">0</strong> người</div>
    `;

    card.querySelector(".seg-hotel-remove-btn").addEventListener("click", () => {
      const segEl = card.closest(".th-segment-item");
      card.remove();
      updateSegmentCapacity(segEl);
      updateGrandTotal();
    });

    return card;
  }

  // ── AJAX: lấy tình trạng phòng và render ────────────────────────────────────
  async function fetchAndRenderRoomTypes(card, hotelId, fromDate, toDate) {
    const loading    = card.querySelector(".seg-room-types-loading");
    const rtContainer= card.querySelector(".seg-room-types");
    loading.style.display = "block";
    rtContainer.innerHTML  = "";

    try {
      const res = await fetch(
        `/${pathAdmin}/tour-hotel/api/hotel-availability?hotelId=${hotelId}&fromDate=${fromDate}&toDate=${toDate}`
      );
      const data = await res.json();
      loading.style.display = "none";

      if (!data.success) {
        rtContainer.innerHTML = `<p class="seg-error">${data.message}</p>`;
        return;
      }

      if (!data.roomTypes || data.roomTypes.length === 0) {
        rtContainer.innerHTML = `<p class="seg-empty">Không còn phòng trống trong khoảng ngày này.</p>`;
        return;
      }

      const segEl = card.closest(".th-segment-item");
      for (const rt of data.roomTypes) {
        rtContainer.appendChild(
          createRoomTypeRow(rt.roomTypeId, rt.roomTypeName, rt.baseOccupancy, rt.availableRooms, 0, segEl)
        );
      }
      renderHotelTotal(card);
    } catch (e) {
      loading.style.display = "none";
      rtContainer.innerHTML = `<p class="seg-error">Lỗi kết nối</p>`;
    }
  }

  // ── Tạo 1 dòng room type ───────────────────────────────────────────────────
  function createRoomTypeRow(roomTypeId, roomTypeName, baseOccupancy, availableRooms, defaultAssigned, segEl) {
    const row = document.createElement("div");
    row.className = "seg-rt-row";
    row.dataset.roomTypeId    = roomTypeId;
    row.dataset.baseOccupancy = baseOccupancy;
    row.dataset.available     = availableRooms ?? 0;

    row.innerHTML = `
      <div class="seg-rt-info">
        <span class="seg-rt-name">${roomTypeName}</span>
        <span class="seg-rt-occ">${baseOccupancy} người/phòng</span>
        <span class="seg-rt-avail">Còn trống: ${availableRooms ?? "?"} phòng</span>
      </div>
      <div class="seg-rt-input-group">
        <label>Số phòng giữ:</label>
        <input type="number" class="seg-rt-rooms" min="0" max="${availableRooms ?? 9999}"
               value="${defaultAssigned}" placeholder="0">
        <span class="seg-rt-capacity-label">= <strong class="seg-rt-cap">0</strong> người</span>
      </div>
    `;

    const input = row.querySelector(".seg-rt-rooms");
    const capEl = row.querySelector(".seg-rt-cap");

    function updateRowCap() {
      const rooms = parseInt(input.value, 10) || 0;
      const cap   = rooms * baseOccupancy;
      capEl.textContent = cap;
      // Bubble up
      const card  = row.closest(".seg-hotel-card");
      if (card) renderHotelTotal(card);
      if (segEl) updateSegmentCapacity(segEl);
      updateGrandTotal();
    }
    input.addEventListener("input", updateRowCap);
    // Khởi tạo lần đầu
    const initRooms = parseInt(defaultAssigned, 10) || 0;
    capEl.textContent = initRooms * baseOccupancy;

    return row;
  }

  // ── Tính tổng sức chứa của 1 hotel card ────────────────────────────────────
  function renderHotelTotal(card) {
    let total = 0;
    card.querySelectorAll(".seg-rt-row").forEach((row) => {
      const rooms = parseInt(row.querySelector(".seg-rt-rooms").value, 10) || 0;
      const occ   = parseInt(row.dataset.baseOccupancy, 10) || 2;
      total += rooms * occ;
    });
    const el = card.querySelector(".seg-hotel-total-val");
    if (el) el.textContent = total;
    return total;
  }

  // ── Cập nhật capacity badge của 1 segment ──────────────────────────────────
  function updateSegmentCapacity(segEl) {
    let total = 0;
    segEl.querySelectorAll(".seg-hotel-card").forEach((card) => {
      total += renderHotelTotal(card);
    });
    const badge = segEl.querySelector(".th-segment-capacity-badge");
    if (badge) badge.textContent = `Sức chứa: ${total} người`;
    return total;
  }

  // ── Cập nhật capacity toàn bộ ───────────────────────────────────────────────
  // Logic: mỗi khung thời gian phải RIÊNG LẺ đủ chỗ cho paxRequired người
  // (40 người di chuyển qua N khung liên tiếp → tại mỗi thời điểm chỉ cần 40 chỗ)
  // → "Tổng sức chứa" = sức chứa NHỎ NHẤT trong tất cả các khung (bottleneck)
  // → "Đủ chỗ" = TẤT CẢ các khung đều >= paxRequired
  function updateGrandTotal() {
    const segEls = Array.from(segmentsWrapper.querySelectorAll(".th-segment-item"));
    const segCapacities = segEls.map((seg) => updateSegmentCapacity(seg));

    const pax = parseInt(paxInput?.value, 10) || 0;

    if (segCapacities.length === 0) {
      if (totalCapDisplay) totalCapDisplay.textContent = "0 người";
      updateCapacityStatus([], pax);
      return;
    }

    // Bottleneck = sức chứa nhỏ nhất (khung yếu nhất)
    const minCap = Math.min(...segCapacities);
    if (totalCapDisplay) totalCapDisplay.textContent = `${minCap} người`;

    updateCapacityStatus(segCapacities, pax);
  }

  function updatePaxDisplay() {
    const pax = parseInt(paxInput?.value, 10) || 0;
    if (paxRequiredDisplay) paxRequiredDisplay.textContent = `${pax} người`;
    updateGrandTotal();
  }

  // segCapacities: mảng sức chứa của từng khung
  function updateCapacityStatus(segCapacities, pax) {
    if (!capacityStatusItem) return;
    if (!pax || segCapacities.length === 0) { capacityStatusItem.innerHTML = ""; return; }

    const allOk    = segCapacities.every((c) => c >= pax);
    const minCap   = Math.min(...segCapacities);
    const weakIdx  = segCapacities.findIndex((c) => c < pax); // chỉ số khung thiếu đầu tiên

    if (allOk) {
      capacityStatusItem.innerHTML =
        `<span class="badge badge--green"><i class="fa-solid fa-circle-check"></i> Đủ chỗ (${minCap}/${pax})</span>`;
    } else {
      const missing = pax - segCapacities[weakIdx];
      capacityStatusItem.innerHTML =
        `<span class="badge badge--red"><i class="fa-solid fa-circle-exclamation"></i> Khung ${weakIdx + 1} thiếu ${missing} chỗ (${segCapacities[weakIdx]}/${pax})</span>`;
    }
  }

  // ── Gợi ý phân bổ tự động ──────────────────────────────────────────────────
  async function suggestAllocation(segEl) {
    const fromDate = segEl.querySelector(".seg-from-date").value;
    const toDate   = segEl.querySelector(".seg-to-date").value;
    const pax      = parseInt(paxInput?.value, 10) || 0;

    if (!fromDate || !toDate) { toastError("Vui lòng nhập ngày từ/đến của khung"); return; }
    if (!pax) { toastError("Vui lòng nhập số người cần bố trí"); return; }

    // Thu thập danh sách hotel đã chọn trong khung này
    const hotelCards = segEl.querySelectorAll(".seg-hotel-card");
    if (hotelCards.length === 0) { toastError("Vui lòng thêm ít nhất 1 khách sạn vào khung trước"); return; }

    const hotelsList = [];
    hotelCards.forEach((card) => {
      hotelsList.push({ hotelId: card.dataset.hotelId, isPrimary: card.dataset.isPrimary === "1" });
    });

    const params = new URLSearchParams({
      fromDate, toDate, paxRequired: pax,
      hotels: JSON.stringify(hotelsList),
    });

    try {
      const res  = await fetch(`/${pathAdmin}/tour-hotel/api/suggest-allocation?${params}`);
      const data = await res.json();
      if (!data.success) { toastError(data.message); return; }

      // Áp dụng kết quả gợi ý vào các hotel cards
      for (const suggestion of data.hotels) {
        const card = segEl.querySelector(`.seg-hotel-card[data-hotel-id="${suggestion.hotelId}"]`);
        if (!card) continue;
        for (const ra of suggestion.roomAllocations) {
          const rtRow = card.querySelector(`.seg-rt-row[data-room-type-id="${ra.roomTypeId}"]`);
          if (rtRow) {
            rtRow.querySelector(".seg-rt-rooms").value = ra.assignedRooms;
            rtRow.querySelector(".seg-rt-cap").textContent = ra.totalPeople;
          }
        }
        renderHotelTotal(card);
      }
      updateSegmentCapacity(segEl);
      updateGrandTotal();

      const msg = data.status === "ok"
        ? `✅ Gợi ý: Đủ chỗ cho ${pax} người`
        : `⚠️ Gợi ý: Chỉ đủ ${pax - data.remaining}/${pax} người`;
      toastSuccess(msg);
    } catch (e) {
      toastError("Lỗi kết nối");
    }
  }

  // ── Thu thập dữ liệu segments để gửi ───────────────────────────────────────
  function collectSegments() {
    const segments = [];
    segmentsWrapper.querySelectorAll(".th-segment-item").forEach((segEl) => {
      const fromDate = segEl.querySelector(".seg-from-date").value;
      const toDate   = segEl.querySelector(".seg-to-date").value;
      if (!fromDate || !toDate) return;

      const hotels = [];
      segEl.querySelectorAll(".seg-hotel-card").forEach((card) => {
        const roomAllocations = [];
        let totalPeople = 0;
        card.querySelectorAll(".seg-rt-row").forEach((row) => {
          const rooms = parseInt(row.querySelector(".seg-rt-rooms").value, 10) || 0;
          if (rooms <= 0) return;
          const occ = parseInt(row.dataset.baseOccupancy, 10) || 2;
          const people = rooms * occ;
          totalPeople += people;
          roomAllocations.push({
            roomTypeId:    row.dataset.roomTypeId,
            roomTypeName:  row.querySelector(".seg-rt-name").textContent,
            baseOccupancy: occ,
            assignedRooms: rooms,
            totalPeople:   people,
          });
        });
        if (roomAllocations.length === 0) return;

        hotels.push({
          hotelId:    card.dataset.hotelId,
          hotelName:  card.querySelector("strong").textContent,
          isPrimary:  card.dataset.isPrimary === "1",
          roomAllocations,
          totalPeople,
        });
      });

      const totalCapacity = hotels.reduce((s, h) => s + h.totalPeople, 0);
      segments.push({ fromDate, toDate, hotels, totalCapacity, status: "draft" });
    });
    return segments;
  }

  // ── Lưu bản nháp (internal, không alert) ───────────────────────────────────
  async function saveDraftInternal() {
    const segments = collectSegments();
    const pax      = parseInt(paxInput?.value, 10) || 0;
    const payload  = {
      tourId:        departureMeta.tourId,
      departureDate: departureMeta.departureDate,
      endDate:       departureMeta.endDate,
      paxRequired:   pax,
      segments:      JSON.stringify(segments),
    };

    const res  = await fetch(`/${pathAdmin}/tour-hotel/api/save-segments`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    return await res.json();
  }

  // ── Lưu bản nháp (nút bấm thủ công → hiển thị alert) ───────────────────────
  async function saveDraft() {
    try {
      const data = await saveDraftInternal();
      if (data && data.success) toastSuccess(data.message || "Đã lưu bản nháp");
      else toastError((data && data.message) || "Không thể lưu bản nháp");
    } catch {
      toastError("Lỗi kết nối");
    }
  }

  // ── Xác nhận & Giữ phòng ───────────────────────────────────────────────────
  async function confirmSegments() {
    const segments = collectSegments();
    if (segments.length === 0) {
      toastError("Chưa có khung thời gian nào");
      return;
    }

    const pax = parseInt(paxInput?.value, 10) || 0;
    // Kiểm tra từng khung: mỗi khung phải đủ chỗ riêng lẻ
    const segEls = Array.from(segmentsWrapper.querySelectorAll(".th-segment-item"));
    const weakSegs = segEls
      .map((seg, i) => ({ idx: i + 1, cap: updateSegmentCapacity(seg) }))
      .filter((s) => s.cap < pax);
    if (weakSegs.length > 0) {
      const desc = weakSegs.map((s) => `Khung ${s.idx} (${s.cap}/${pax})`).join(", ");
      const okWeak = await showThConfirm({
        title: "Khung chưa đủ chỗ",
        message: `Một số khung chưa đủ chỗ: ${desc}.\n\nVẫn tiếp tục xác nhận?`,
        confirmText: "Vẫn tiếp tục",
        cancelText: "Quay lại chỉnh sửa",
      });
      if (!okWeak) return;
    }

    // Thu thập các công ty chủ KS cần gửi yêu cầu duyệt.
    // Với tour-only admin: tất cả KS (kể cả cùng công ty) đều cần duyệt.
    // Với company admin / full: chỉ KS khác công ty mới cần duyệt.
    const partnerCompanyIds = new Set();
    const partnerCompanyNames = [];
    let hasSameCompanyNeedingApproval = false;

    for (const seg of segments) {
      for (const h of seg.hotels || []) {
        const hotelData = hotelsData.find((hd) => String(hd._id) === String(h.hotelId));
        if (!hotelData || !currentCompanyId) continue;

        const isSame = String(hotelData.companyId) === String(currentCompanyId);

        if (isTourOnlyAdmin && isSame) {
          // Tour-only admin + cùng công ty: cũng cần link request
          hasSameCompanyNeedingApproval = true;
          continue;
        }

        if (isSame) continue; // company admin + cùng công ty: auto-hold, không cần cảnh báo

        const cid = String(hotelData.companyId);
        if (partnerCompanyIds.has(cid)) continue;
        partnerCompanyIds.add(cid);
        const nm = (hotelData.companyName || "").trim();
        partnerCompanyNames.push(nm || "Công ty chủ khách sạn (chưa có tên)");
      }
    }

    const hasCrossCompany = partnerCompanyNames.length > 0;
    const needsAnyApproval = hasCrossCompany || hasSameCompanyNeedingApproval;

    if (needsAnyApproval) {
      let title, message;

      if (isTourOnlyAdmin) {
        // Tour-only admin: tất cả KS (kể cả cùng công ty) cần gửi yêu cầu duyệt
        const allCompanyNames = [
          ...(hasSameCompanyNeedingApproval ? ["(cùng công ty)"] : []),
          ...partnerCompanyNames,
        ];
        const allCompaniesHaveExternalOnly = !hasSameCompanyNeedingApproval && hasCrossCompany;
        if (!hasSameCompanyNeedingApproval && partnerCompanyNames.length === 1) {
          const quoted = `«${partnerCompanyNames[0]}»`;
          title = `Yêu cầu liên kết khách sạn — công ty ${quoted}`;
          message = `Tất cả khách sạn trong cấu hình đều cần được phê duyệt trước khi giữ phòng. Hệ thống sẽ gửi yêu cầu tới công ty ${quoted}.\n\nTiếp tục?`;
        } else if (!hasSameCompanyNeedingApproval && partnerCompanyNames.length > 1) {
          const quoted = partnerCompanyNames.map((n) => `«${n}»`).join(", ");
          title = `Yêu cầu liên kết khách sạn — ${partnerCompanyNames.length} công ty`;
          message = `Tất cả khách sạn trong cấu hình đều cần được phê duyệt trước khi giữ phòng. Hệ thống sẽ gửi yêu cầu tới từng công ty: ${quoted}.\n\nTiếp tục?`;
        } else {
          // Có cả cùng công ty và/hoặc khác công ty
          title = "Yêu cầu liên kết khách sạn";
          const details = partnerCompanyNames.length > 0
            ? ` và công ty đối tác: ${partnerCompanyNames.map((n) => `«${n}»`).join(", ")}`
            : "";
          message = `Tài khoản của bạn (Tour Admin) cần gửi yêu cầu duyệt cho tất cả khách sạn${details} — kể cả khách sạn cùng công ty. Phòng sẽ chỉ được giữ sau khi được phê duyệt.\n\nTiếp tục?`;
        }
      } else {
        // Company admin: chỉ KS khác công ty mới cần duyệt
        const quoted = partnerCompanyNames.map((n) => `«${n}»`).join(", ");
        title =
          partnerCompanyNames.length === 1
            ? `Liên kết khách sạn — công ty ${`«${partnerCompanyNames[0]}»`}`
            : `Liên kết khách sạn — ${partnerCompanyNames.length} công ty đối tác`;
        message =
          partnerCompanyNames.length === 1
            ? `Trong cấu hình có khách sạn thuộc công ty «${partnerCompanyNames[0]}» (không cùng công ty với tour của bạn). Hệ thống sẽ gửi yêu cầu duyệt tới công ty «${partnerCompanyNames[0]}». Phòng tại khách sạn cùng công ty với tour của bạn sẽ được giữ ngay.\n\nTiếp tục?`
            : `Trong cấu hình có khách sạn thuộc các công ty đối tác: ${quoted} (không cùng công ty với tour của bạn). Hệ thống sẽ gửi yêu cầu duyệt tới từng công ty sở hữu khách sạn tương ứng. Phòng tại khách sạn cùng công ty với tour của bạn sẽ được giữ ngay.\n\nTiếp tục?`;
      }

      const okCross = await showThConfirm({
        title,
        message,
        confirmText: "Tiếp tục",
        cancelText: "Huỷ",
      });
      if (!okCross) return;
    }

    // Lưu draft ngầm
    try {
      await saveDraftInternal();
    } catch {
      toastError("Lỗi khi lưu dữ liệu, vui lòng thử lại");
      return;
    }

    try {
      const res  = await fetch(`/${pathAdmin}/tour-hotel/api/confirm-segments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          tourId:        departureMeta.tourId,
          departureDate: departureMeta.departureDate,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess(data.message || "Thành công");
        setTimeout(() => location.reload(), 700);
      } else {
        toastError(data.message || "Không thể xác nhận");
      }
    } catch {
      toastError("Lỗi kết nối");
    }
  }

  // ── Huỷ & Giải phóng phòng ────────────────────────────────────────────────
  async function cancelSegments() {
    const ok = await showThConfirm({
      title: "Huỷ & giải phóng phòng",
      message:
        "Huỷ sẽ giải phóng toàn bộ phòng đã giữ cho lịch khởi hành này và đóng các yêu cầu liên kết đang chờ (nếu có).\n\nXác nhận huỷ?",
      confirmText: "Xác nhận huỷ",
      cancelText: "Không",
    });
    if (!ok) return;
    try {
      const res  = await fetch(`/${pathAdmin}/tour-hotel/api/cancel-segments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          tourId:        departureMeta.tourId,
          departureDate: departureMeta.departureDate,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess(data.message || "Đã huỷ");
        setTimeout(() => location.reload(), 600);
      } else {
        toastError(data.message || "Không thể huỷ");
      }
    } catch {
      toastError("Lỗi kết nối");
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────────
  addSegmentBtn?.addEventListener("click", () => {
    segmentsWrapper.appendChild(createSegmentElement());
    updateGrandTotal();
  });

  paxInput?.addEventListener("input", updatePaxDisplay);
  saveDraftBtn?.addEventListener("click", saveDraft);
  confirmBtn?.addEventListener("click", confirmSegments);
  cancelBtn?.addEventListener("click", cancelSegments);

  // Nút đồng bộ paxRequired đã bị xóa — giá trị luôn được lấy trực tiếp từ seatsTotal của tour khi tải trang

  // ── Khởi chạy ───────────────────────────────────────────────────────────────
  init();
})();
