/**
 * Utils phía client — mirror helpers/hotel-guest-rooms.helper.js
 */
(function (global) {
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

  function normalizeRoomsData(roomsData) {
    if (!Array.isArray(roomsData) || roomsData.length === 0) {
      return [{ adults: [{ age: AGE.ADULT_DEFAULT }], children: [], babies: [] }];
    }
    return roomsData.map(normalizeRoom);
  }

  function countGuests(roomsData) {
    const rooms = normalizeRoomsData(roomsData);
    return rooms.reduce(
      (acc, room) => {
        acc.rooms += 1;
        acc.adults += room.adults.length;
        acc.children += room.children.length;
        acc.babies += room.babies.length;
        return acc;
      },
      { rooms: 0, adults: 0, children: 0, babies: 0 }
    );
  }

  function countAdultsInRoom(room) {
    return normalizeRoom(room).adults.length;
  }

  function calculateEffectiveOccupancy(room, ageBands) {
    const r = normalizeRoom(room);
    let total = r.adults.length;

    [...r.children, ...r.babies].forEach((person) => {
      const age = Number(person.age);
      const band = (ageBands || []).find((b) => {
        const minAge = b.minAge || 0;
        const maxAge = b.maxAge;
        if (maxAge === null || maxAge === undefined) return age >= minAge;
        return age >= minAge && age <= maxAge;
      });
      if (band && band.countInOccupancy) {
        total += band.occupancyWeight || 1;
      }
    });

    return total;
  }

  global.HotelGuestRoomsUtils = {
    AGE,
    normalizeRoom,
    normalizeRoomsData,
    countGuests,
    countAdultsInRoom,
    calculateEffectiveOccupancy,
  };
})(typeof window !== "undefined" ? window : global);
