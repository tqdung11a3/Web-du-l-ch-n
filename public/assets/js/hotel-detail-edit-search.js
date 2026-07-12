// public/assets/js/hotel-detail-edit-search.js

(function () {
  "use strict";

  if (window.hotelDetailEditSearchAttached) return;
  window.hotelDetailEditSearchAttached = true;

  const HGRU = window.HotelGuestRoomsUtils;
  const AGE = HGRU ? HGRU.AGE : {
    ADULT_MIN: 12,
    GUARDIAN_MIN: 18,
    CHILD_MIN: 3,
    CHILD_MAX: 12,
    BABY_MIN: 0,
    BABY_MAX: 2,
    ADULT_DEFAULT: 18,
    CHILD_DEFAULT: 6,
    BABY_DEFAULT: 1,
  };

  const GUEST_TYPES = [
    {
      key: "adults",
      label: "Người lớn",
      hint: "Từ 12 tuổi trở lên",
      minAge: AGE.ADULT_MIN,
      maxAge: 120,
      defaultAge: AGE.ADULT_DEFAULT,
      minCount: 1,
    },
    {
      key: "children",
      label: "Trẻ em",
      hint: "Từ 3 đến 12 tuổi",
      minAge: AGE.CHILD_MIN,
      maxAge: AGE.CHILD_MAX,
      defaultAge: AGE.CHILD_DEFAULT,
      minCount: 0,
    },
    {
      key: "babies",
      label: "Em bé",
      hint: "Từ 0 đến 2 tuổi",
      minAge: AGE.BABY_MIN,
      maxAge: AGE.BABY_MAX,
      defaultAge: AGE.BABY_DEFAULT,
      minCount: 0,
    },
  ];

  const editBtn = document.getElementById("editSearchBtn");
  const modal = document.getElementById("editSearchModal");
  const closeBtn = modal?.querySelector(".edit-search-modal__close");
  const overlay = modal?.querySelector(".edit-search-modal__overlay");
  const form = document.getElementById("editSearchForm");
  const guestBtn = document.getElementById("editGuestBtn");
  const guestsPopup = document.getElementById("editGuestsPopup");
  const roomsContainer = document.getElementById("editRoomsContainer");
  const addRoomBtn = document.getElementById("editAddRoomBtn");
  const guestsDoneBtn = document.getElementById("editGuestsDoneBtn");
  const guestText = document.getElementById("editGuestText");
  const roomsInput = document.getElementById("editRoomsInput");
  const adultsInput = document.getElementById("editAdultsInput");
  const childrenInput = document.getElementById("editChildrenInput");
  const babiesInput = document.getElementById("editBabiesInput");
  const roomsDataInput = document.getElementById("editRoomsDataInput");

  if (!editBtn || !modal || !form) return;

  let roomsData = [];

  function normalizeRoom(raw) {
    return HGRU ? HGRU.normalizeRoom(raw) : raw;
  }

  function normalizeRoomsData(data) {
    return HGRU ? HGRU.normalizeRoomsData(data) : data;
  }

  function allGuests(room) {
    return [...(room.adults || []), ...(room.children || []), ...(room.babies || [])];
  }

  function roomHasGuardian18(room) {
    return allGuests(room).some((g) => Number(g.age) >= AGE.GUARDIAN_MIN);
  }

  function validateGuestAge(type, age) {
    const n = Number(age);
    if (!Number.isFinite(n)) return false;
    if (type === "adults") return n >= AGE.ADULT_MIN;
    if (type === "children") return n >= AGE.CHILD_MIN && n <= AGE.CHILD_MAX;
    if (type === "babies") return n >= AGE.BABY_MIN && n <= AGE.BABY_MAX;
    return false;
  }

  function validateRoomsData(data) {
    const errors = [];
    const typeMap = {
      adults:   { label: "Người lớn", minAge: AGE.ADULT_MIN,  maxAge: 120 },
      children: { label: "Trẻ em",    minAge: AGE.CHILD_MIN,  maxAge: AGE.CHILD_MAX },
      babies:   { label: "Em bé",     minAge: AGE.BABY_MIN,   maxAge: AGE.BABY_MAX },
    };
    (data || []).forEach(function (room, ri) {
      const label = data.length > 1 ? "Phòng " + (ri + 1) + " — " : "";
      ["adults", "children", "babies"].forEach(function (key) {
        const cfg = typeMap[key];
        (room[key] || []).forEach(function (g, i) {
          if (!validateGuestAge(key, g.age)) {
            errors.push(
              label + cfg.label + " " + (i + 1) + ": tuổi phải từ " + cfg.minAge +
              (key === "adults" ? " trở lên." : " đến " + cfg.maxAge + ".")
            );
          }
        });
      });
      if (!roomHasGuardian18(room)) {
        errors.push((label || "Phòng ") + "phải có ít nhất 1 người từ " + AGE.GUARDIAN_MIN + " tuổi trở lên.");
      }
    });
    return errors;
  }

  function parseRoomsDataFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomsDataStr = urlParams.get("roomsData");

    if (roomsDataStr) {
      try {
        roomsData = normalizeRoomsData(
          JSON.parse(decodeURIComponent(roomsDataStr))
        );
      } catch (e) {
        console.warn("Failed to parse roomsData:", e);
        roomsData = [];
      }
    } else {
      const rooms = parseInt(urlParams.get("rooms") || roomsInput?.value || "1", 10);
      const adults = parseInt(urlParams.get("adults") || adultsInput?.value || "1", 10);
      const children = parseInt(urlParams.get("children") || childrenInput?.value || "0", 10);
      const babies = parseInt(urlParams.get("babies") || babiesInput?.value || "0", 10);

      const firstRoom = normalizeRoom({
        adults,
        children: Array.from({ length: children }, () => ({ age: AGE.CHILD_DEFAULT })),
        babies: Array.from({ length: babies }, () => ({ age: AGE.BABY_DEFAULT })),
      });

      roomsData = [firstRoom];
      for (let i = 1; i < rooms; i++) {
        roomsData.push({
          adults: [{ age: AGE.ADULT_DEFAULT }],
          children: [],
          babies: [],
        });
      }
    }

    if (!roomsData.length) {
      roomsData = [{ adults: [{ age: AGE.ADULT_DEFAULT }], children: [], babies: [] }];
    }

    renderRooms();
  }

  function renderGuestAgeInputs(roomIndex, typeKey, cfg, guests) {
    return (guests || [])
      .map(
        (guest, guestIndex) => `
        <div class="guests-popup__guest-item" data-room="${roomIndex}" data-type="${typeKey}" data-index="${guestIndex}">
          <span class="guests-popup__guest-label">${cfg.label} ${guestIndex + 1}</span>
          <input
            type="number"
            class="guests-popup__age-input${validateGuestAge(typeKey, guest.age) ? "" : " is-invalid"}"
            min="${cfg.minAge}"
            max="${cfg.maxAge}"
            step="1"
            value="${guest.age}"
            data-room="${roomIndex}"
            data-type="${typeKey}"
            data-index="${guestIndex}"
            aria-label="Tuổi ${cfg.label} ${guestIndex + 1}"
          />
          <button type="button" class="guests-popup__btn guests-popup__btn--remove-guest"
            data-room="${roomIndex}" data-type="${typeKey}" data-index="${guestIndex}" title="Xóa">×</button>
        </div>`
      )
      .join("");
  }

  function renderRoom(roomIndex, room) {
    const sections = GUEST_TYPES.map((cfg) => {
      const guests = room[cfg.key] || [];
      return `
        <div class="guests-popup__type-block guests-popup__type-block--${cfg.key}">
          <div class="guests-popup__row">
            <div class="guests-popup__left">
              <strong>${cfg.label}</strong>
              <small>${cfg.hint}</small>
            </div>
            <div class="guests-popup__right">
              <button type="button" class="guests-popup__btn" data-room="${roomIndex}" data-type="${cfg.key}" data-action="dec">−</button>
              <input type="text" class="guests-popup__input" value="${guests.length}" readonly tabindex="-1">
              <button type="button" class="guests-popup__btn" data-room="${roomIndex}" data-type="${cfg.key}" data-action="inc">+</button>
            </div>
          </div>
          <div class="guests-popup__guests-list">
            ${renderGuestAgeInputs(roomIndex, cfg.key, cfg, guests)}
          </div>
        </div>`;
    }).join("");

    const guardianOk = roomHasGuardian18(room);
    const warnHtml = guardianOk
      ? ""
      : `<div class="guests-popup__room-warn" data-room-warn="${roomIndex}">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Phòng phải có ít nhất 1 khách từ ${AGE.GUARDIAN_MIN} tuổi trở lên.
        </div>`;

    return `
      <div class="guests-popup__room" data-room-index="${roomIndex}">
        <div class="guests-popup__room-header">
          <strong>Phòng ${roomIndex + 1}</strong>
          ${roomIndex > 0 ? `<button type="button" class="guests-popup__btn--remove-room" data-room="${roomIndex}">×</button>` : ""}
        </div>
        ${sections}
        ${warnHtml}
      </div>`;
  }

  function renderRooms() {
    if (!roomsContainer) return;
    roomsContainer.innerHTML = roomsData
      .map((room, index) => renderRoom(index, room))
      .join("");
    updateSummary();
  }

  function updateSummary() {
    const counts = HGRU
      ? HGRU.countGuests(roomsData)
      : roomsData.reduce(
          (acc, r) => {
            acc.rooms += 1;
            acc.adults += (r.adults || []).length;
            acc.children += (r.children || []).length;
            acc.babies += (r.babies || []).length;
            return acc;
          },
          { rooms: 0, adults: 0, children: 0, babies: 0 }
        );

    if (guestText) {
      let summary = `${counts.rooms} phòng - ${counts.adults} người lớn`;
      if (counts.children > 0) summary += `, ${counts.children} trẻ em`;
      if (counts.babies > 0) summary += `, ${counts.babies} em bé`;
      guestText.textContent = summary;
    }

    if (roomsInput) roomsInput.value = String(counts.rooms);
    if (adultsInput) adultsInput.value = String(counts.adults);
    if (childrenInput) childrenInput.value = String(counts.children);
    if (babiesInput) babiesInput.value = String(counts.babies);
    if (roomsDataInput) {
      roomsDataInput.value = encodeURIComponent(JSON.stringify(roomsData));
    }
  }

  function getTypeConfig(typeKey) {
    return GUEST_TYPES.find((t) => t.key === typeKey);
  }

  function changeQuantity(roomIndex, typeKey, delta) {
    const room = roomsData[roomIndex];
    const cfg = getTypeConfig(typeKey);
    if (!room || !cfg) return;

    if (!Array.isArray(room[typeKey])) room[typeKey] = [];
    const list = room[typeKey];
    const newLen = list.length + delta;
    if (newLen < cfg.minCount) return;

    if (delta > 0) list.push({ age: cfg.defaultAge });
    else if (list.length > cfg.minCount) list.pop();

    renderRooms();
  }

  function removeGuest(roomIndex, typeKey, guestIndex) {
    const room = roomsData[roomIndex];
    const cfg = getTypeConfig(typeKey);
    if (!room || !cfg || !room[typeKey]) return;
    if (room[typeKey].length <= cfg.minCount) return;
    room[typeKey].splice(guestIndex, 1);
    renderRooms();
  }

  function changeGuestAge(roomIndex, typeKey, guestIndex, age) {
    const room = roomsData[roomIndex];
    if (!room || !room[typeKey] || !room[typeKey][guestIndex]) return;
    room[typeKey][guestIndex].age = age;

    const warnEl = guestsPopup?.querySelector(`[data-room-warn="${roomIndex}"]`);
    const ok = roomHasGuardian18(room);
    if (warnEl) {
      warnEl.style.display = ok ? "none" : "";
    } else if (!ok) {
      renderRooms();
      return;
    }
    updateSummary();
  }

  function attachRoomEvents() {
    if (!roomsContainer) return;

    roomsContainer.addEventListener("click", (e) => {
      e.stopPropagation();

      const qtyBtn = e.target.closest("button.guests-popup__btn[data-type][data-action]");
      if (qtyBtn) {
        changeQuantity(
          parseInt(qtyBtn.dataset.room, 10),
          qtyBtn.dataset.type,
          qtyBtn.dataset.action === "inc" ? 1 : -1
        );
        return;
      }

      const removeRoomBtn = e.target.closest("button.guests-popup__btn--remove-room");
      if (removeRoomBtn) {
        const idx = parseInt(removeRoomBtn.dataset.room, 10);
        if (idx > 0 && roomsData.length > 1) {
          roomsData.splice(idx, 1);
          renderRooms();
        }
        return;
      }

      const removeGuestBtn = e.target.closest("button.guests-popup__btn--remove-guest");
      if (removeGuestBtn) {
        removeGuest(
          parseInt(removeGuestBtn.dataset.room, 10),
          removeGuestBtn.dataset.type,
          parseInt(removeGuestBtn.dataset.index, 10)
        );
      }
    });

    roomsContainer.addEventListener("input", (e) => {
      const input = e.target.closest(".guests-popup__age-input");
      if (!input) return;
      changeGuestAge(
        parseInt(input.dataset.room, 10),
        input.dataset.type,
        parseInt(input.dataset.index, 10),
        parseInt(input.value, 10)
      );
    });
  }

  attachRoomEvents();

  editBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    modal.style.display = "block";
    document.body.style.overflow = "hidden";
    parseRoomsDataFromURL();
  });

  function closeModal() {
    modal.style.display = "none";
    document.body.style.overflow = "";
    if (guestsPopup) guestsPopup.setAttribute("aria-hidden", "true");
    if (guestBtn) guestBtn.setAttribute("aria-expanded", "false");
  }

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (overlay) overlay.addEventListener("click", closeModal);

  const cancelBtn = modal?.querySelector(".btn-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = window.location.pathname;
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.style.display === "block") closeModal();
  });

  if (guestBtn && guestsPopup) {
    guestBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = this.getAttribute("aria-expanded") === "true";
      this.setAttribute("aria-expanded", String(!isExpanded));
      guestsPopup.setAttribute("aria-hidden", String(isExpanded));
    });

    document.addEventListener("click", function (e) {
      if (!guestsPopup.contains(e.target) && !guestBtn.contains(e.target)) {
        guestsPopup.setAttribute("aria-hidden", "true");
        guestBtn.setAttribute("aria-expanded", "false");
      }
    });

    guestsPopup.addEventListener("click", (e) => e.stopPropagation());
  }

  if (addRoomBtn) {
    addRoomBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      roomsData.push({
        adults: [{ age: AGE.ADULT_DEFAULT }],
        children: [],
        babies: [],
      });
      renderRooms();
    });
  }

  if (guestsDoneBtn) {
    guestsDoneBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      guestsPopup.setAttribute("aria-hidden", "true");
      guestBtn.setAttribute("aria-expanded", "false");
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // Validate tuổi hành khách trước khi tìm kiếm
      const ageErrors = validateRoomsData(roomsData);
      if (ageErrors.length > 0) {
        if (typeof notify !== "undefined" && notify.error) {
          notify.error(ageErrors.join("\n"));
        } else {
          alert(ageErrors.join("\n"));
        }
        return;
      }

      const formData = new FormData(form);
      const params = new URLSearchParams();

      const checkInDate = formData.get("checkInDate");
      const checkOutDate = formData.get("checkOutDate");
      if (checkInDate) params.set("checkInDate", checkInDate);
      if (checkOutDate) params.set("checkOutDate", checkOutDate);

      const roomsDataStr = roomsDataInput?.value;
      if (roomsDataStr) params.set("roomsData", roomsDataStr);

      params.set("rooms", roomsInput?.value || "1");
      params.set("adults", adultsInput?.value || "1");
      params.set("children", childrenInput?.value || "0");
      params.set("babies", babiesInput?.value || "0");

      try {
        sessionStorage.setItem(
          "hotelDetailScrollY",
          String(window.scrollY || window.pageYOffset || 0)
        );
      } catch (err) {
        /* ignore */
      }

      const newUrl =
        window.location.pathname +
        (params.toString() ? "?" + params.toString() : "");
      window.location.href = newUrl;
    });
  }

  (function restoreScrollPosition() {
    try {
      const savedY = sessionStorage.getItem("hotelDetailScrollY");
      if (savedY === null) return;
      sessionStorage.removeItem("hotelDetailScrollY");
      const targetY = parseInt(savedY, 10);
      if (!targetY) return;

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          window.scrollTo({ top: targetY, behavior: "instant" });
        });
      } else {
        requestAnimationFrame(function () {
          window.scrollTo({ top: targetY, behavior: "instant" });
        });
      }
    } catch (err) {
      /* ignore */
    }
  })();

  parseRoomsDataFromURL();
})();
