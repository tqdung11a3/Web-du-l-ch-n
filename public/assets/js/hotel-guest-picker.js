/**
 * Popup chọn số khách / phòng — /hotel/search, company-hotel-list, ...
 * Cấu trúc phòng: { adults: [{age}], children: [{age}], babies: [{age}] }
 */
(function () {
  "use strict";

  const AGE = {
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

  function _asAgeList(val, defaultAge) {
    if (typeof val === "number" && val > 0) {
      return Array.from({ length: val }, () => ({ age: defaultAge }));
    }
    if (Array.isArray(val)) {
      return val.map((item) => ({
        age:
          item && typeof item === "object" && item.age !== undefined
            ? Number(item.age)
            : Number(item) || defaultAge,
      }));
    }
    return [];
  }

  function normalizeRoom(raw) {
    if (!raw || typeof raw !== "object") {
      return { adults: [{ age: AGE.ADULT_DEFAULT }], children: [], babies: [] };
    }

    let adults = _asAgeList(raw.adults, AGE.ADULT_DEFAULT);
    let children = _asAgeList(raw.children, AGE.CHILD_DEFAULT);
    let babies = _asAgeList(raw.babies, AGE.BABY_DEFAULT);

    if (!raw.babies && Array.isArray(raw.children) && raw.children.length > 0) {
      children = [];
      babies = [];
      raw.children.forEach((c) => {
        const age = Number(c?.age ?? c);
        if (age <= AGE.BABY_MAX) babies.push({ age });
        else if (age <= AGE.CHILD_MAX) children.push({ age });
        else adults.push({ age });
      });
    }

    if (adults.length === 0 && children.length === 0 && babies.length === 0) {
      adults = [{ age: AGE.ADULT_DEFAULT }];
    }

    return { adults, children, babies };
  }

  function allGuests(room) {
    return [...room.adults, ...room.children, ...room.babies];
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

  function validateRoomsData(roomsData) {
    const errors = [];
    roomsData.forEach((room, roomIndex) => {
      const label = `Phòng ${roomIndex + 1}`;
      if (allGuests(room).length === 0) {
        errors.push(`${label}: phải có ít nhất 1 khách.`);
        return;
      }
      GUEST_TYPES.forEach(({ key, label: typeLabel, minAge, maxAge }) => {
        (room[key] || []).forEach((g, i) => {
          if (!validateGuestAge(key, g.age)) {
            errors.push(
              `${label} — ${typeLabel} ${i + 1}: tuổi phải từ ${minAge}` +
                (key === "adults" ? " trở lên." : ` đến ${maxAge}.`)
            );
          }
        });
      });
      if (!roomHasGuardian18(room)) {
        errors.push(
          `${label}: phải có ít nhất 1 khách từ ${AGE.GUARDIAN_MIN} tuổi trở lên.`
        );
      }
    });
    return errors;
  }

  function parseRoomsFromQuery() {
    try {
      const url = new URL(window.location.href);
      const roomsData = url.searchParams.get("roomsData");
      if (roomsData) {
        const parsed = JSON.parse(decodeURIComponent(roomsData));
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(normalizeRoom);
        }
      }
    } catch (e) {
      console.warn("Failed to parse roomsData from URL", e);
    }

    const url = new URL(window.location.href);
    const rooms = parseInt(url.searchParams.get("rooms") || "1", 10);
    const adults = parseInt(url.searchParams.get("adults") || "1", 10);
    const children = parseInt(url.searchParams.get("children") || "0", 10);

    const room = normalizeRoom({
      adults,
      children: Array.from({ length: children }, () => ({ age: AGE.CHILD_DEFAULT })),
      babies: [],
    });

    const result = [room];
    for (let i = 1; i < rooms; i++) {
      result.push({ adults: [{ age: AGE.ADULT_DEFAULT }], children: [], babies: [] });
    }
    return result;
  }

  function initGuestPicker() {
    const popup = document.getElementById("guestsPopup");
    const btn = document.getElementById("guestBtn");
    const text = document.getElementById("guestText");
    const roomsContainer = document.getElementById("roomsContainer");
    const addRoomBtn = document.getElementById("addRoomBtn");
    const doneBtn = document.getElementById("guestsDoneBtn");
    const roomsDataInput = document.getElementById("roomsDataInput");
    const roomsInput = document.getElementById("roomsInput");
    const adultsInput = document.getElementById("adultsInput");
    const childrenInput = document.getElementById("childrenInput");
    const babiesInput = document.getElementById("babiesInput");
    const searchForm = document.querySelector(".hotel-search-top__form");

    if (!popup || !btn || !text || !roomsContainer) return;

    let roomsData = parseRoomsFromQuery();

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
      roomsContainer.innerHTML = roomsData
        .map((room, index) => renderRoom(index, room))
        .join("");
      updateSummary();
      updateHiddenInputs();
    }

    function updateSummary() {
      const totalRooms = roomsData.length;
      let totalAdults = 0;
      let totalChildren = 0;
      let totalBabies = 0;
      roomsData.forEach((r) => {
        totalAdults += (r.adults || []).length;
        totalChildren += (r.children || []).length;
        totalBabies += (r.babies || []).length;
      });

      let summary = `${totalRooms} phòng - ${totalAdults} người lớn`;
      if (totalChildren > 0) summary += ` - ${totalChildren} trẻ em`;
      if (totalBabies > 0) summary += ` - ${totalBabies} em bé`;
      text.textContent = summary;
    }

    function updateHiddenInputs() {
      const counts = roomsData.reduce(
        (acc, r) => {
          acc.adults += (r.adults || []).length;
          acc.children += (r.children || []).length;
          acc.babies += (r.babies || []).length;
          return acc;
        },
        { adults: 0, children: 0, babies: 0 }
      );

      if (roomsInput) roomsInput.value = String(roomsData.length);
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

      if (delta > 0) {
        list.push({ age: cfg.defaultAge });
      } else if (list.length > cfg.minCount) {
        list.pop();
      }

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
      // Chỉ cập nhật cảnh báo phòng, không re-render toàn bộ để giữ focus input
      const warnEl = popup.querySelector(`[data-room-warn="${roomIndex}"]`);
      const roomEl = popup.querySelector(`[data-room-index="${roomIndex}"]`);
      const ok = roomHasGuardian18(room);
      if (warnEl) {
        warnEl.style.display = ok ? "none" : "";
      } else if (!ok && roomEl) {
        renderRooms();
      } else if (ok && warnEl) {
        warnEl.remove();
      }
      updateSummary();
      updateHiddenInputs();
    }

    function addRoom() {
      roomsData.push({
        adults: [{ age: AGE.ADULT_DEFAULT }],
        children: [],
        babies: [],
      });
      renderRooms();
    }

    function removeRoom(roomIndex) {
      if (roomIndex === 0 || roomsData.length <= 1) return;
      roomsData.splice(roomIndex, 1);
      renderRooms();
    }

    popup.addEventListener("click", (e) => {
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
        removeRoom(parseInt(removeRoomBtn.dataset.room, 10));
        return;
      }

      const removeGuestBtn = e.target.closest("button.guests-popup__btn--remove-guest");
      if (removeGuestBtn) {
        removeGuest(
          parseInt(removeGuestBtn.dataset.room, 10),
          removeGuestBtn.dataset.type,
          parseInt(removeGuestBtn.dataset.index, 10)
        );
        return;
      }
    });

    popup.addEventListener("input", (e) => {
      const input = e.target.closest(".guests-popup__age-input");
      if (!input) return;
      changeGuestAge(
        parseInt(input.dataset.room, 10),
        input.dataset.type,
        parseInt(input.dataset.index, 10),
        parseInt(input.value, 10)
      );
    });

    popup.addEventListener("change", (e) => {
      const input = e.target.closest(".guests-popup__age-input");
      if (!input) return;
      const typeKey = input.dataset.type;
      const cfg = getTypeConfig(typeKey);
      let age = parseInt(input.value, 10);
      if (!Number.isFinite(age)) age = cfg.defaultAge;
      age = Math.min(cfg.maxAge, Math.max(cfg.minAge, age));
      input.value = age;
      input.classList.toggle("is-invalid", !validateGuestAge(typeKey, age));
      changeGuestAge(
        parseInt(input.dataset.room, 10),
        typeKey,
        parseInt(input.dataset.index, 10),
        age
      );
    });

    if (addRoomBtn) {
      addRoomBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        addRoom();
      });
    }

    function openPopup() {
      btn.setAttribute("aria-expanded", "true");
      popup.setAttribute("aria-hidden", "false");
      popup.classList.add("is-open");
      document.body.classList.add("guests-modal-open");
    }

    function closePopup() {
      btn.setAttribute("aria-expanded", "false");
      popup.setAttribute("aria-hidden", "true");
      popup.classList.remove("is-open");
      document.body.classList.remove("guests-modal-open");
    }

    function tryCloseWithValidation() {
      const errors = validateRoomsData(roomsData);
      if (errors.length > 0) {
        if (typeof notify !== "undefined" && notify.error) {
          notify.error(errors.join("\n"));
        } else {
          alert(errors.join("\n"));
        }
        return false;
      }
      closePopup();
      return true;
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPopup();
    });

    popup.querySelectorAll("[data-guests-close]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        closePopup();
      });
    });

    if (doneBtn) {
      doneBtn.addEventListener("click", (e) => {
        e.preventDefault();
        tryCloseWithValidation();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && popup.classList.contains("is-open")) {
        closePopup();
      }
    });

    if (searchForm) {
      searchForm.addEventListener("submit", (e) => {
        const errors = validateRoomsData(roomsData);
        if (errors.length > 0) {
          e.preventDefault();
          openPopup();
          if (typeof notify !== "undefined" && notify.error) {
            notify.error(errors.join("\n"));
          } else {
            alert(errors.join("\n"));
          }
        }
      });
    }

    renderRooms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGuestPicker);
  } else {
    initGuestPicker();
  }
})();
