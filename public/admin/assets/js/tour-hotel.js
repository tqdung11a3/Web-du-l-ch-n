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

  // Trước khi gửi, trang đã biết tour nào, khách sạn nào, và trạng thái yêu cầu liên kết từng KS:
  const existingData  = JSON.parse(document.getElementById("existing-data")?.textContent || "null");
  const hotelsData    = JSON.parse(document.getElementById("hotels-data")?.textContent   || "[]");
  const departureMeta = JSON.parse(document.getElementById("departure-meta")?.textContent|| "{}");
  const pathAdmin     = JSON.parse(document.getElementById("path-admin")?.textContent    || '""');
  const currentCompanyId = JSON.parse(document.getElementById("current-company-id")?.textContent || '""');
  const isTourOnlyAdmin  = JSON.parse(document.getElementById("is-tour-only-admin")?.textContent || "false");
  // hotelId → link request status: 'pending'|'approved'|'partially_approved'|'rejected'|'cancelled'
  const hotelLinkStatusMap = JSON.parse(document.getElementById("hotel-link-status-map")?.textContent || "{}");

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
    const alertOnly = !!opts.alertOnly;

    const wrap = document.getElementById("th-app-dialog");
    if (!wrap) {
      if (alertOnly) {
        window.alert(message);
        return Promise.resolve(false);
      }
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
        if (alertOnly) {
          window.alert(message);
          resolve(false);
        } else {
          resolve(window.confirm(message));
        }
        return;
      }

      titleEl.textContent = title;
      // Hỗ trợ xuống dòng (\n) trong message — escape HTML rồi thay \n → <br>
      bodyEl.innerHTML = message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;
      okBtn.style.display = alertOnly ? "none" : "";

      let settled = false;
      function finish(val) {
        if (settled) return;
        settled = true;
        wrap.classList.remove("is-open");
        wrap.setAttribute("aria-hidden", "true");
        okBtn.style.display = "";
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
      (alertOnly ? cancelBtn : okBtn).focus();
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
  // Kiểu nó sẽ khôi phục lại những giá trị mà admin đã điền ở segment, sau đó render ra giao diện
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

    // Admin bấm nút Thêm khách sạn → hiện modal chọn khách sạn
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

    // Khóa vùng ngày cho phép chọn = [departureDate, endDate] của tour để
    // admin không thể tự nhập khung nằm ngoài khoảng tour.
    const fromInput = el.querySelector(".seg-from-date");
    const toInput   = el.querySelector(".seg-to-date");
    if (departureMeta.departureDate) {
      fromInput.min = departureMeta.departureDate;
      toInput.min   = departureMeta.departureDate;
    }
    if (departureMeta.endDate) {
      fromInput.max = departureMeta.endDate;
      toInput.max   = departureMeta.endDate;
    }

    // Ngày thay đổi → validate range, re-fetch phòng trống cho tất cả khách sạn
    // đã có + cập nhật capacity. Nếu ngoài range → reset ô + báo lỗi.
    const onDateChange = (ev) => {
      if (!enforceSegmentDateRange(el, ev && ev.target)) return;
      refreshHotelsInSegment(el);
    };
    fromInput.addEventListener("change", onDateChange);
    toInput.addEventListener("change",   onDateChange);

    return el;
  }

  // ── Validate 1 segment nằm trong khoảng tour ─────────────────────────────
  // Trả về true nếu hợp lệ; false + toast + reset ô nếu ngoài khoảng /
  // fromDate > toDate. targetInput là ô admin vừa sửa để reset đúng ô đó.
  function enforceSegmentDateRange(segEl, targetInput) {
    const fromInput = segEl.querySelector(".seg-from-date");
    const toInput   = segEl.querySelector(".seg-to-date");
    const minStr = departureMeta.departureDate || "";
    const maxStr = departureMeta.endDate || "";
    const fmt = (s) => {
      if (!s || s.length < 10) return s || "";
      return `${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}`;
    };
    const from = fromInput.value;
    const to   = toInput.value;

    if (from && minStr && from < minStr) {
      toastError(`Ngày phải nằm trong khoảng tour ${fmt(minStr)} → ${fmt(maxStr)}`);
      fromInput.value = "";
      return false;
    }
    if (from && maxStr && from > maxStr) {
      toastError(`Ngày phải nằm trong khoảng tour ${fmt(minStr)} → ${fmt(maxStr)}`);
      fromInput.value = "";
      return false;
    }
    if (to && minStr && to < minStr) {
      toastError(`Ngày phải nằm trong khoảng tour ${fmt(minStr)} → ${fmt(maxStr)}`);
      toInput.value = "";
      return false;
    }
    if (to && maxStr && to > maxStr) {
      toastError(`Ngày phải nằm trong khoảng tour ${fmt(minStr)} → ${fmt(maxStr)}`);
      toInput.value = "";
      return false;
    }
    if (from && to && from > to) {
      toastError(`"Từ ngày" phải ≤ "Đến ngày"`);
      if (targetInput === fromInput) fromInput.value = "";
      else toInput.value = "";
      return false;
    }
    return true;
  }

  // ── Validate toàn bộ segments trước khi lưu / xác nhận ────────────────────
  function validateAllSegmentsInRange() {
    const minStr = departureMeta.departureDate || "";
    const maxStr = departureMeta.endDate || "";
    const fmt = (s) => {
      if (!s || s.length < 10) return s || "";
      return `${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}`;
    };
    const errors = [];
    const segEls = Array.from(segmentsWrapper.querySelectorAll(".th-segment-item"));
    segEls.forEach((segEl, idx) => {
      const f = segEl.querySelector(".seg-from-date").value;
      const t = segEl.querySelector(".seg-to-date").value;
      if (!f || !t) return;
      if (f > t) {
        errors.push(`Khung ${idx + 1}: "Từ ngày" phải ≤ "Đến ngày".`);
        return;
      }
      if ((minStr && f < minStr) || (maxStr && t > maxStr)) {
        errors.push(
          `Khung ${idx + 1}: ngày ${fmt(f)} → ${fmt(t)} nằm ngoài khoảng tour ${fmt(minStr)} → ${fmt(maxStr)}.`
        );
      }
    });
    return errors;
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

    // gọi api lấy tình trạng phòng và render lên card
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
        const row = createRoomTypeRow(
          ra.roomTypeId,
          ra.roomTypeName,
          ra.baseOccupancy,
          null,           // không có dữ liệu tồn kho live
          ra.assignedRooms,
          segEl
        );
        rtContainer.appendChild(row);
        applyCardLockToRow(card, row);
      }
      renderHotelTotal(card);
    }

    if (!fromDate || !toDate) {
      renderFromSaved();
      return;
    }

    if (loading) loading.style.display = "block";
    try {
      const excludeSegId = existingData && existingData._id ? `&excludeTourSegmentId=${encodeURIComponent(String(existingData._id))}` : "";
      const res = await fetch(
        `/${pathAdmin}/tour-hotel/api/hotel-availability?hotelId=${encodeURIComponent(
          String(hotelData.hotelId)
        )}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}${excludeSegId}`
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
        const row = createRoomTypeRow(
          rt.roomTypeId,
          rt.roomTypeName,
          rt.baseOccupancy,
          rt.availableRooms || 0,
          assigned,
          segEl
        );
        rtContainer.appendChild(row);
        applyCardLockToRow(card, row);
      }

      for (const ra of hotelData.roomAllocations || []) {
        if (liveIds.has(String(ra.roomTypeId))) continue;
        const row = createRoomTypeRow(
          ra.roomTypeId,
          ra.roomTypeName,
          ra.baseOccupancy,
          null,           // loại phòng không còn trong API, dùng giá trị đã lưu
          ra.assignedRooms,
          segEl
        );
        rtContainer.appendChild(row);
        applyCardLockToRow(card, row);
      }

      renderHotelTotal(card);
      updateSegmentCapacity(segEl);
      updateGrandTotal();
    } catch (e) {
      if (loading) loading.style.display = "none";
      renderFromSaved();
    }
  }

  // ── Badge trạng thái link request cho hotel card ────────────────────────────
  const LINK_STATUS_LABEL = {
    pending:   { text: "Chờ phản hồi", cls: "seg-link-badge--pending",  icon: "fa-clock" },
    approved:  { text: "Đã duyệt",     cls: "seg-link-badge--approved", icon: "fa-circle-check" },
    rejected:  { text: "Từ chối",      cls: "seg-link-badge--rejected", icon: "fa-circle-xmark" },
    cancelled: { text: "Đã đóng",      cls: "seg-link-badge--cancelled", icon: "fa-ban" },
  };

  function buildLinkStatusBadge(hotelId) {
    const status = hotelLinkStatusMap[String(hotelId)];
    if (!status) return "";
    const cfg = LINK_STATUS_LABEL[status];
    if (!cfg) return "";
    return `<span class="seg-link-badge ${cfg.cls}" title="Trạng thái yêu cầu liên kết">
      <i class="fa-solid ${cfg.icon}"></i> ${cfg.text}
    </span>`;
  }

  // ── Tạo card khách sạn ──────────────────────────────────────────────────────
  function createHotelCard(hotelId, hotelName, isPrimary) {
    const card = document.createElement("div");
    card.className = "seg-hotel-card";
    card.dataset.hotelId  = hotelId;
    card.dataset.isPrimary = isPrimary ? "1" : "0";

    const lrStatus = hotelLinkStatusMap[String(hotelId)];
    // Lock input khi đã có yêu cầu liên kết ở trạng thái cần xác nhận lại trước khi sửa
    const needsUnlock = lrStatus === "approved" || lrStatus === "pending" || lrStatus === "rejected";
    if (needsUnlock) card.dataset.locked = "1";

    const hotelData = hotelsData.find((h) => h._id === hotelId);
    const isCross = hotelData && currentCompanyId && String(hotelData.companyId) !== currentCompanyId;
    const ownerLabel = (hotelData && (hotelData.companyName || "").trim()) || "Công ty khác";
    const crossBadge = isCross
      ? ` <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:6px">${escapeHtml(ownerLabel)}</span>`
      : "";
    const statusBadge = buildLinkStatusBadge(hotelId);
    const editBtn = needsUnlock
      ? `<button type="button" class="seg-hotel-unlock-btn" title="Chỉnh sửa số phòng giữ">
           <i class="fa-solid fa-pen-to-square"></i> Chỉnh sửa
         </button>`
      : "";

    card.innerHTML = `
      <div class="seg-hotel-card__header">
        <div class="seg-hotel-card__title">
          <strong>${escapeHtml(hotelName)}</strong>${crossBadge}
          ${statusBadge}
        </div>
        <div class="seg-hotel-card__actions">
          ${editBtn}
          <button type="button" class="seg-hotel-remove-btn">
            <i class="fa-solid fa-xmark"></i> Xoá
          </button>
        </div>
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

    // Nút Chỉnh sửa — hiển thị khi approved, pending hoặc rejected
    const unlockBtn = card.querySelector(".seg-hotel-unlock-btn");
    if (unlockBtn) {
      unlockBtn.addEventListener("click", async () => {
        let title, message;
        if (lrStatus === "approved") {
          title = "Chỉnh sửa phòng đã được duyệt";
          message =
            `Khách sạn "${escapeHtml(hotelName)}" đã được duyệt liên kết.\n\n` +
            `Nếu bạn thay đổi số phòng giữ, hệ thống sẽ cần bấm "Xác nhận lại (Re-assign phòng)" để cập nhật — ` +
            `quá trình này sẽ hủy hold hiện tại tại khách sạn này và gửi yêu cầu mới.\n\n` +
            `Bạn có muốn mở chế độ chỉnh sửa không?`;
        } else if (lrStatus === "pending") {
          title = "Chỉnh sửa phòng đang chờ duyệt";
          message =
            `Yêu cầu liên kết tới "${escapeHtml(hotelName)}" đang chờ khách sạn phản hồi.\n\n` +
            `Nếu bạn thay đổi số phòng và bấm "Xác nhận lại (Re-assign phòng)", yêu cầu đang chờ sẽ bị hủy và một yêu cầu mới sẽ được gửi đi.\n\n` +
            `Bạn có muốn mở chế độ chỉnh sửa không?`;
        } else {
          title = "Chỉnh sửa phòng sau khi bị từ chối";
          message =
            `Yêu cầu liên kết tới "${escapeHtml(hotelName)}" đã bị từ chối.\n\n` +
            `Nếu bạn thay đổi số phòng và bấm "Xác nhận lại (Re-assign phòng)", một yêu cầu mới sẽ được gửi đi tới khách sạn.\n\n` +
            `Bạn có muốn mở chế độ chỉnh sửa không?`;
        }
        const confirmed = await showThConfirm({
          title,
          message,
          confirmText: "Mở chỉnh sửa",
          cancelText: "Không",
        });
        if (!confirmed) return;
        card.dataset.locked = "0";
        unlockBtn.remove();
        // Unlock tất cả input số phòng trong card này
        card.querySelectorAll(".seg-rt-rooms").forEach((inp) => {
          inp.disabled = false;
          inp.classList.remove("seg-rt-rooms--locked");
        });
        // Cập nhật lại capacity (có thể đang bị suppress khi locked)
        const segEl = card.closest(".th-segment-item");
        renderHotelTotal(card);
        updateSegmentCapacity(segEl);
        updateGrandTotal();
      });
    }

    return card;
  }

  // ── AJAX: lấy tình trạng phòng và render ────────────────────────────────────
  async function fetchAndRenderRoomTypes(card, hotelId, fromDate, toDate) {
    const loading    = card.querySelector(".seg-room-types-loading");
    const rtContainer= card.querySelector(".seg-room-types");
    loading.style.display = "block";
    rtContainer.innerHTML  = "";

    try {
      const excludeSegId = existingData && existingData._id ? `&excludeTourSegmentId=${encodeURIComponent(String(existingData._id))}` : "";
      const res = await fetch(
        `/${pathAdmin}/tour-hotel/api/hotel-availability?hotelId=${hotelId}&fromDate=${fromDate}&toDate=${toDate}${excludeSegId}`
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

      // Dữ liệu trả về được dùng ở đây — duyệt data.roomTypes và render từng loại phòng:
      const segEl = card.closest(".th-segment-item");
      for (const rt of data.roomTypes) {
        const row = createRoomTypeRow(rt.roomTypeId, rt.roomTypeName, rt.baseOccupancy, rt.availableRooms, 0, segEl);
        rtContainer.appendChild(row);
        applyCardLockToRow(card, row);
      }
      renderHotelTotal(card);
    } catch (e) {
      loading.style.display = "none";
      rtContainer.innerHTML = `<p class="seg-error">Lỗi kết nối</p>`;
    }
  }

  // ── Đồng bộ 1 dòng loại phòng: số giữ, còn trống, sức chứa ─────────────────
  function syncRoomTypeRow(row) {
    const hasLiveData = row.dataset.available !== undefined && row.dataset.available !== "";
    const realAvail   = hasLiveData ? parseInt(row.dataset.available, 10) || 0 : null;
    const baseOcc     = parseInt(row.dataset.baseOccupancy, 10) || 2;
    const input       = row.querySelector(".seg-rt-rooms");
    const capEl       = row.querySelector(".seg-rt-cap");
    const availCountEl = row.querySelector(".seg-rt-avail-count");
    if (!input) return;

    let rooms = parseInt(input.value, 10) || 0;
    if (hasLiveData && rooms > realAvail) {
      rooms = realAvail;
      input.value = rooms;
    }
    if (capEl) capEl.textContent = rooms * baseOcc;

    if (hasLiveData && availCountEl && !availCountEl.classList.contains("seg-rt-avail-unknown")) {
      const remaining = Math.max(0, realAvail - rooms);
      availCountEl.textContent = remaining;
      row.classList.toggle("seg-rt-low", remaining === 0 && rooms > 0);
    }
  }

  function bubbleRowTotals(row, segEl) {
    const card = row.closest(".seg-hotel-card");
    if (card) renderHotelTotal(card);
    const seg = segEl || row.closest(".th-segment-item");
    if (seg) updateSegmentCapacity(seg);
    updateGrandTotal();
  }

  // ── Tạo 1 dòng room type ───────────────────────────────────────────────────
  // availableRooms = số phòng trống thực từ API, hoặc null nếu không có dữ liệu live
  function createRoomTypeRow(roomTypeId, roomTypeName, baseOccupancy, availableRooms, defaultAssigned, segEl) {
    const hasLiveData  = availableRooms !== null && availableRooms !== undefined;
    const realAvail    = hasLiveData ? (availableRooms || 0) : null;
    const initAssigned = parseInt(defaultAssigned, 10) || 0;
    const initClamped  = hasLiveData ? Math.min(initAssigned, realAvail) : initAssigned;
    const initRemaining = hasLiveData ? Math.max(0, realAvail - initClamped) : null;

    const row = document.createElement("div");
    row.className = "seg-rt-row";
    row.dataset.roomTypeId    = roomTypeId;
    row.dataset.baseOccupancy = baseOccupancy;
    if (hasLiveData) row.dataset.available = realAvail;

    const availDisplay = hasLiveData
      ? `Còn trống: <span class="seg-rt-avail-count">${initRemaining}</span> phòng`
      : `<span class="seg-rt-avail-count seg-rt-avail-unknown">Không có dữ liệu tồn kho</span>`;

    row.innerHTML = `
      <div class="seg-rt-info">
        <span class="seg-rt-name">${roomTypeName}</span>
        <span class="seg-rt-occ">${baseOccupancy} người/phòng</span>
        <span class="seg-rt-avail">${availDisplay}</span>
      </div>
      <div class="seg-rt-input-group">
        <label>Số phòng giữ:</label>
        <input type="number" class="seg-rt-rooms" min="0" ${hasLiveData ? `max="${realAvail}"` : ""}
               value="${initClamped}" placeholder="0">
        <span class="seg-rt-capacity-label">= <strong class="seg-rt-cap">0</strong> người</span>
      </div>
    `;

    const input = row.querySelector(".seg-rt-rooms");

    input.addEventListener("input", () => {
      syncRoomTypeRow(row);
      bubbleRowTotals(row, segEl);
    });
    syncRoomTypeRow(row);

    // Lock state được áp dụng sau khi row được append vào card bởi caller.
    // Caller gọi applyCardLockToRow(card, row) sau khi appendChild.
    return row;
  }

  // Áp lock state cho 1 row vừa append vào card
  function applyCardLockToRow(card, row) {
    if (!card) return;
    const locked = card.dataset.locked !== "0" && !!card.dataset.locked;
    if (locked) {
      const inp = row.querySelector(".seg-rt-rooms");
      if (inp) {
        inp.disabled = true;
        inp.classList.add("seg-rt-rooms--locked");
      }
    }
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
          if (!rtRow) continue;
          const input = rtRow.querySelector(".seg-rt-rooms");
          if (input) input.value = ra.assignedRooms;
          syncRoomTypeRow(rtRow);
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

  // Đây là bước thu thập toàn bộ cấu hình (khung ngày, KS, loại phòng, số phòng giữ) trước khi gửi API:
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
      segments.push({ fromDate, toDate, hotels, totalCapacity });
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
    const rangeErrors = validateAllSegmentsInRange();
    if (rangeErrors.length > 0) {
      toastError(rangeErrors[0]);
      return;
    }
    try {
      const data = await saveDraftInternal();
      if (data && data.success) toastSuccess(data.message || "Đã lưu bản nháp");
      else toastError((data && data.message) || "Không thể lưu bản nháp");
    } catch {
      toastError("Lỗi kết nối");
    }
  }

  // ── Xác nhận & Giữ phòng ───────────────────────────────────────────────────

  // hàm trung tâm gửi yêu cầu liên kết
  // hàm quan trọng nhất, gửi yêu cầu liên kết
  async function confirmSegments() {
    const rangeErrors = validateAllSegmentsInRange();
    if (rangeErrors.length > 0) {
      await showThConfirm({
        title: "Khung ngoài khoảng tour",
        message:
          "Một số khung thời gian nằm ngoài khoảng ngày của tour:\n\n" +
          rangeErrors.map((e, i) => `${i + 1}. ${e}`).join("\n"),
        alertOnly: true,
        cancelText: "Quay lại chỉnh sửa",
      });
      return;
    }
    const segments = collectSegments();
    if (segments.length === 0) {
      toastError("Chưa có khung thời gian nào");
      return;
    }

    // Validate từng khung phải đủ chỗ
    const pax = parseInt(paxInput?.value, 10) || 0;
    // Kiểm tra từng khung: mỗi khung phải đủ chỗ riêng lẻ
    const segEls = Array.from(segmentsWrapper.querySelectorAll(".th-segment-item"));
    const weakSegs = segEls
      .map((seg, i) => ({ idx: i + 1, cap: updateSegmentCapacity(seg) }))
      .filter((s) => s.cap < pax);
    if (weakSegs.length > 0) {
      const desc = weakSegs.map((s) => `Khung ${s.idx} (${s.cap}/${pax})`).join(", ");
      await showThConfirm({
        title: "Khung chưa đủ chỗ",
        message:
          `Một số khung chưa đủ chỗ: ${desc}.\n\n` +
          "Vui lòng bổ sung phòng cho từng khung trước khi xác nhận.",
        alertOnly: true,
        cancelText: "Quay lại chỉnh sửa",
      });
      return;
    }

    // Xác nhận lại cấu hình nếu đã từng confirmed hoặc pending_approval
    const segStatus = existingData?.status;
    if (segStatus === "confirmed" || segStatus === "pending_approval") {
      const okPartial = await showThConfirm({
        title: "Xác nhận lại cấu hình",
        message:
          "Chỉ khách sạn có thay đổi (số phòng, loại phòng hoặc khung thời gian) mới gửi lại yêu cầu liên kết.\n\n" +
          "Các khách sạn không đổi giữ nguyên yêu cầu và phòng đã giữ (nếu đã được duyệt).\n\nTiếp tục?",
        confirmText: "Tiếp tục",
        cancelText: "Quay lại chỉnh sửa",
      });
      if (!okPartial) return;
    }

    // Mọi KS có phân bổ phòng đều đi qua HotelLinkRequest (kể cả cùng công ty).
    const partnerCompanyIds = new Set();
    const partnerCompanyNames = [];
    let hasHotelWithRooms = false;

    for (const seg of segments) {
      for (const h of seg.hotels || []) {
        const hasRooms = (h.roomAllocations || []).some(
          (ra) => Number(ra.assignedRooms) > 0
        );
        if (!hasRooms) continue;
        hasHotelWithRooms = true;

        const hotelData = hotelsData.find((hd) => String(hd._id) === String(h.hotelId));
        if (!hotelData || !currentCompanyId) continue;

        const cid = String(hotelData.companyId);
        if (partnerCompanyIds.has(cid)) continue;
        partnerCompanyIds.add(cid);
        const nm = (hotelData.companyName || "").trim();
        partnerCompanyNames.push(nm || "Công ty chủ khách sạn (chưa có tên)");
      }
    }

    if (hasHotelWithRooms) {
      let title, message;

      if (isTourOnlyAdmin) {
        if (partnerCompanyNames.length === 1) {
          const quoted = `«${partnerCompanyNames[0]}»`;
          title = `Yêu cầu liên kết khách sạn — công ty ${quoted}`;
          message = `Tất cả khách sạn trong cấu hình cần được phê duyệt trước khi giữ phòng. Hệ thống sẽ gửi yêu cầu tới công ty ${quoted}.\n\nTiếp tục?`;
        } else if (partnerCompanyNames.length > 1) {
          const quoted = partnerCompanyNames.map((n) => `«${n}»`).join(", ");
          title = `Yêu cầu liên kết khách sạn — ${partnerCompanyNames.length} công ty`;
          message = `Tất cả khách sạn trong cấu hình cần được phê duyệt trước khi giữ phòng. Hệ thống sẽ gửi yêu cầu tới từng công ty: ${quoted}.\n\nTiếp tục?`;
        } else {
          title = "Yêu cầu liên kết khách sạn";
          message =
            "Tài khoản Tour Admin cần gửi yêu cầu duyệt cho các khách sạn trong cấu hình. Phòng chỉ được giữ sau khi được phê duyệt.\n\nTiếp tục?";
        }
      } else {
        title = "Yêu cầu liên kết khách sạn";
        message =
          "Mọi khách sạn trong cấu hình (kể cả cùng công ty) sẽ được gửi yêu cầu liên kết. " +
          'Phòng chỉ được giữ sau khi duyệt tại mục "Yêu cầu nhận được".\n\n' +
          (partnerCompanyNames.length > 0
            ? `Có khách sạn thuộc công ty đối tác: ${partnerCompanyNames.map((n) => `«${n}»`).join(", ")}.\n\n`
            : "") +
          "Tiếp tục?";
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

      // gọi api xác nhận cấu hình
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
        let toastMsg = data.message || "Thành công";
        if (data.summary) {
          const parts = [];
          if (data.summary.unchanged?.length) {
            parts.push("Giữ nguyên: " + data.summary.unchanged.join(", "));
          }
          if (data.summary.updated?.length) {
            parts.push("Gửi mới/cập nhật: " + data.summary.updated.join(", "));
          }
          if (data.summary.removed?.length) {
            parts.push("Đã gỡ: " + data.summary.removed.join(", "));
          }
          if (parts.length) {
            toastMsg += " — " + parts.join(" | ");
          }
        }
        toastSuccess(toastMsg);
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

  // Bấm “Xác nhận & Giữ phòng” — gửi yêu cầu liên kết
  confirmBtn?.addEventListener("click", confirmSegments);
  cancelBtn?.addEventListener("click", cancelSegments);

  // Nút đồng bộ paxRequired đã bị xóa — giá trị luôn được lấy trực tiếp từ seatsTotal của tour khi tải trang

  // ── Modal yêu cầu bổ sung phòng ─────────────────────────────────────────────
  (function initAdditionalRoomsModal() {
    const pressureRaw = document.getElementById("quota-pressure-data");
    if (!pressureRaw) return;
    let pressure;
    try { pressure = JSON.parse(pressureRaw.textContent); } catch { return; }
    if (!pressure || !["low", "exhausted"].includes(pressure.pressureLevel)) return;

    const modal = document.getElementById("additional-rooms-modal");
    if (!modal) return;

    const openBtn   = document.getElementById("open-additional-rooms-modal");
    const closeBtn  = document.getElementById("close-additional-rooms-modal");
    const cancelBtn2 = document.getElementById("cancel-additional-rooms-modal");
    const submitBtn = document.getElementById("submit-additional-rooms-modal");
    const tableWrap = document.getElementById("additional-rooms-table-wrap");

    function buildTable() {
      const rows = [];
      for (const frame of pressure.frames || []) {
        for (const hotel of frame.hotels || []) {
          for (const rt of hotel.roomTypes || []) {
            rows.push({ frame, hotel, rt });
          }
        }
      }
      if (rows.length === 0) {
        tableWrap.innerHTML = "<p style='color:#64748b;font-size:13px'>Không có dữ liệu phòng.</p>";
        return;
      }

      let html = `<table class="th-add-rooms-table">
        <thead><tr>
          <th>Khung</th><th>Khách sạn</th><th>Loại phòng</th>
          <th>Đã giữ</th><th>Đã đặt</th><th>Còn trống</th>
          <th>Thêm phòng</th><th>Ghi chú</th>
        </tr></thead><tbody>`;
      for (const { frame, hotel, rt } of rows) {
        const rowKey = `${hotel.hotelId}|${rt.roomTypeId}|${frame.fromDate}|${frame.toDate}`;
        html += `<tr data-row-key="${rowKey}"
          data-hotel-id="${hotel.hotelId}" data-hotel-name="${hotel.hotelName}"
          data-room-type-id="${rt.roomTypeId}" data-room-type-name="${rt.roomTypeName}"
          data-base-occupancy="${rt.baseOccupancy}"
          data-from-date="${frame.fromDate}" data-to-date="${frame.toDate}">
          <td style="white-space:nowrap;font-size:12px;color:#64748b">${frame.fromDate} → ${frame.toDate}</td>
          <td>${hotel.hotelName}</td>
          <td>${rt.roomTypeName}<br><span style="font-size:11px;color:#94a3b8">${rt.baseOccupancy} người/phòng</span></td>
          <td style="text-align:center">${rt.assignedRooms}</td>
          <td style="text-align:center">${rt.bookedRooms}</td>
          <td style="text-align:center;font-weight:600;color:${rt.availableRooms === 0 ? "#dc2626" : "#16a34a"}">${rt.availableRooms}</td>
          <td style="text-align:center"><input class="th-add-rooms-input" type="number" min="0" value="0" data-row="${rowKey}"></td>
          <td><input class="th-add-rooms-note-input" type="text" placeholder="Ghi chú..." data-note-row="${rowKey}"></td>
        </tr>`;
      }
      html += "</tbody></table>";
      tableWrap.innerHTML = html;
    }

    function openModal() {
      buildTable();
      modal.removeAttribute("aria-hidden");
      modal.style.removeProperty("display");
    }
    function closeModal() {
      modal.setAttribute("aria-hidden", "true");
    }

    openBtn?.addEventListener("click", openModal);
    closeBtn?.addEventListener("click", closeModal);
    cancelBtn2?.addEventListener("click", closeModal);
    modal.querySelector(".th-add-rooms-modal__backdrop")
      ?.addEventListener("click", closeModal);

    submitBtn?.addEventListener("click", async () => {
      const items = [];
      const inputEls = tableWrap.querySelectorAll(".th-add-rooms-input");
      for (const inp of inputEls) {
        const val = Number(inp.value);
        if (!val || val < 1) continue;
        const row = tableWrap.querySelector(`tr[data-row-key="${inp.dataset.row}"]`);
        if (!row) continue;
        const noteEl = tableWrap.querySelector(`input[data-note-row="${inp.dataset.row}"]`);
        items.push({
          hotelId: row.dataset.hotelId,
          hotelName: row.dataset.hotelName,
          roomTypeId: row.dataset.roomTypeId,
          roomTypeName: row.dataset.roomTypeName,
          baseOccupancy: Number(row.dataset.baseOccupancy) || 2,
          fromDate: row.dataset.fromDate,
          toDate: row.dataset.toDate,
          additionalRooms: val,
          note: noteEl?.value || "",
        });
      }
      if (items.length === 0) {
        alert("Vui lòng nhập số phòng muốn bổ sung (>= 1) cho ít nhất một loại phòng.");
        return;
      }
      submitBtn.disabled = true;
      try {

        // gọi api yêu cầu bổ sung phòng
        const res = await fetch(`/${pathAdmin}/tour-hotel/api/request-additional-rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tourSegmentId: pressure.tourSegmentId,
            items,
          }),
        });
        const data = await res.json();
        if (data.success) {
          closeModal();
          if (typeof toastSuccess === "function") toastSuccess(data.message || "Đã gửi yêu cầu!");
          else alert(data.message || "Đã gửi yêu cầu bổ sung phòng!");
          setTimeout(() => location.reload(), 800);
        } else {
          if (typeof toastError === "function") toastError(data.message || "Lỗi gửi yêu cầu");
          else alert(data.message || "Lỗi gửi yêu cầu");
        }
      } catch {
        if (typeof toastError === "function") toastError("Lỗi kết nối");
        else alert("Lỗi kết nối");
      } finally {
        submitBtn.disabled = false;
      }
    });
  })();

  // ── Khởi chạy ───────────────────────────────────────────────────────────────
  init();
})();
