// ===============================
// Menu Mobile
// ===============================
const buttonMenuMobile = document.querySelector(".header .inner-menu-mobile");
if (buttonMenuMobile) {
  const menu = document.querySelector(".header .inner-menu");
  const overlay = document.querySelector(".header .inner-overlay");

  // Click vào button mở menu
  buttonMenuMobile.addEventListener("click", () => {
    menu.classList.add("active");
  });

  // Click vào overlay đóng menu
  overlay.addEventListener("click", () => {
    menu.classList.remove("active");
  });

  // Click vào icon down mở sub menu
  const listButtonSubMenu = menu.querySelectorAll("ul > li > i");
  listButtonSubMenu.forEach((button) => {
    button.addEventListener("click", () => {
      const li = button.closest("li");
      li.classList.toggle("active");
    });
  });
}
// End Menu Mobile

// ===============================
// Company Detail Tabs
// ===============================
// Chỉ chạy trên trang company-detail (có data-tab attribute)
// Không chạy trên trang company-tour-list, company-hotel-list, company-flight-list (dùng href để navigate)
const companyTabs = document.querySelectorAll(".company-tabs .tab-item[data-tab]");
if (companyTabs.length > 0) {
  companyTabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const tabName = tab.getAttribute("data-tab");
      
      // Remove active class from all tabs
      companyTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      
      // Hide all tab contents
      const allTabContents = document.querySelectorAll(".tab-content");
      allTabContents.forEach((content) => {
        content.style.display = "none";
      });
      
      // Show selected tab content
      const selectedContent = document.querySelector(
        `.tab-content[data-tab-content="${tabName}"]`
      );
      if (selectedContent) {
        selectedContent.style.display = "block";
      }
    });
  });
}
// End Company Detail Tabs

// ===============================
// Tour Detail Tabs (Tổng quan / Lịch trình / Bao gồm / Đánh giá)
// ===============================
(() => {
  const tabsRoot = document.querySelector(".tour-tabs");
  if (!tabsRoot) return;

  const tabButtons = tabsRoot.querySelectorAll(".tour-tab-btn");
  const tabPanels = tabsRoot.querySelectorAll(".tour-tab-panel");

  function activateTab(name) {
    tabButtons.forEach((btn) => {
      const tab = btn.getAttribute("data-tab");
      btn.classList.toggle("is-active", tab === name);
    });
    tabPanels.forEach((panel) => {
      const tab = panel.getAttribute("data-tab");
      panel.classList.toggle("is-active", tab === name);
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-tab");
      if (!name) return;
      activateTab(name);
    });
  });
})();

// ===============================
// Box Address Section 1
// ===============================
const boxAddressSection1 = document.querySelector(
  ".section-1 .inner-form .inner-address"
);
if (boxAddressSection1) {
  // Ẩn/Hiện box suggest
  const input = boxAddressSection1.querySelector(".inner-input");

  input.addEventListener("focus", () => {
    boxAddressSection1.classList.add("active");
  });

  input.addEventListener("blur", () => {
    boxAddressSection1.classList.remove("active");
  });

  // Sự kiện click vào từng item
  const listItem = boxAddressSection1.querySelectorAll(
    ".inner-suggest-list .inner-item"
  );
  listItem.forEach((item) => {
    item.addEventListener("mousedown", () => {
      const title = item.querySelector(".inner-item-title").innerHTML.trim();
      if (title) {
        input.value = title;
      }
    });
  });
}
// End Box Address Section 1

// ===============================
// Box User Section 1 – Tổng số thành viên (minSeats)
// ===============================
(() => {
  const boxUser = document.querySelector(".section-1 .inner-form .inner-user");
  if (!boxUser) return;

  // Chỉ dùng một input số (cho phép gõ trực tiếp)
  const qtyInput = boxUser.querySelector('input[name="minSeats"]');
  const summaryInput = qtyInput;

  if (!qtyInput) return;

  // Mở/đóng bảng chọn số lượng
  summaryInput.addEventListener("focus", () => {
    boxUser.classList.add("active");
  });
  document.addEventListener("click", (e) => {
    if (!boxUser.contains(e.target)) {
      boxUser.classList.remove("active");
    }
  });

  // Helpers
  const clamp = (n) => Math.max(1, Math.min(999, Number.isFinite(n) ? n : 1));

  // Helper chuẩn hoá giá trị về [1, 999]
  const syncSummary = () => {
    if (qtyInput.value === "") return;
    const val = clamp(parseInt(qtyInput.value, 10));
    qtyInput.value = String(val);
  };

  // Cho phép gõ tự do; chỉ chuẩn hoá khi blur hoặc khi dùng nút +/- 
  qtyInput.addEventListener("input", () => {
    // chỉ giữ lại số; cho phép để trống khi đang gõ
    const digits = qtyInput.value.replace(/\\D+/g, "");
    if (digits !== qtyInput.value) qtyInput.value = digits;
  });

  qtyInput.addEventListener("blur", syncSummary);

  // Bắt sự kiện +/− bằng uỷ quyền (delegation)
  boxUser.addEventListener("click", (e) => {
    const t = e.target;
    if (t.matches('[data-role="plus"]')) {
      qtyInput.value = String(clamp((parseInt(qtyInput.value, 10) || 1) + 1));
      syncSummary();
    }
    if (t.matches('[data-role="minus"]')) {
      qtyInput.value = String(clamp((parseInt(qtyInput.value, 10) || 1) - 1));
      syncSummary();
    }
  });

  // Prefill từ URL (khi người dùng back lại trang vẫn giữ giá trị)
  try {
    const url = new URL(window.location.href.split("#")[0]);
    const v = url.searchParams.get("minSeats");
    if (v !== null) {
      qtyInput.value = v;
    }
  } catch (_) {}
  // Đồng bộ hiển thị ban đầu
  syncSummary();
})();

// ===============================
// Clock Expire
// ===============================
const clockExpire = document.querySelector("[clock-expire]");
if (clockExpire) {
  const expireDateTimeString = clockExpire.getAttribute("clock-expire");
  const expireDateTime = new Date(expireDateTimeString);

  const updateClock = () => {
    const now = new Date();
    const remainingTime = expireDateTime - now;
    if (remainingTime > 0) {
      const days = Math.floor(remainingTime / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remainingTime / (60 * 60 * 1000)) % 24);
      const minutes = Math.floor((remainingTime / (60 * 1000)) % 60);
      const seconds = Math.floor((remainingTime / 1000) % 60);

      const listInnerNumber = clockExpire.querySelectorAll(".inner-number");
      listInnerNumber[0].innerHTML = days > 9 ? days : `0${days}`;
      listInnerNumber[1].innerHTML = hours > 9 ? hours : `0${hours}`;
      listInnerNumber[2].innerHTML = minutes > 9 ? minutes : `0${minutes}`;
      listInnerNumber[3].innerHTML = seconds > 9 ? seconds : `0${seconds}`;
    } else {
      clearInterval(intervalClock);
    }
  };

  const intervalClock = setInterval(updateClock, 1000);
}
// End Clock Expire

// ===============================
// Box Filter (Section 9)
// ===============================
const buttonFilterMobile = document.querySelector(
  ".section-9 .inner-filter-mobile"
);
if (buttonFilterMobile) {
  const boxLeft = document.querySelector(".section-9 .inner-left");
  const overlay = document.querySelector(
    ".section-9 .inner-left .inner-overlay"
  );

  buttonFilterMobile.addEventListener("click", () => {
    boxLeft.classList.add("active");
  });

  overlay.addEventListener("click", () => {
    boxLeft.classList.remove("active");
  });
}
// End Box Filter

// ===============================
// Form Search (trang chủ)
// ===============================
const formSearch = document.querySelector("[form-search]");
if (formSearch) {
  const FIELDS = ["q", "departureDate", "price", "minSeats"];
  const NUM_FIELDS = new Set(["minSeats"]);

  const priceBox = formSearch.querySelector(".inner-price");
  if (priceBox) {
    const priceTrigger = priceBox.querySelector("[inner-price-trigger]");
    const priceInput = priceBox.querySelector('[name="price"]');
    const priceLabel = priceBox.querySelector(".inner-price-label");
    const priceOptions = priceBox.querySelectorAll(".inner-price-option");

    const setPriceValue = (value, label) => {
      priceInput.value = value;
      priceLabel.textContent = label;
      priceBox.classList.toggle("has-value", Boolean(value));
      priceOptions.forEach((opt) => {
        opt.classList.toggle("selected", opt.dataset.value === value);
      });
    };

    const closePriceDropdown = () => {
      priceBox.classList.remove("active");
      if (priceTrigger) priceTrigger.setAttribute("aria-expanded", "false");
    };

    const openPriceDropdown = () => {
      priceBox.classList.add("active");
      if (priceTrigger) priceTrigger.setAttribute("aria-expanded", "true");
    };

    if (priceTrigger) {
      priceTrigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (priceBox.classList.contains("active")) {
          closePriceDropdown();
        } else {
          openPriceDropdown();
        }
      });

      priceTrigger.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          priceTrigger.click();
        } else if (event.key === "Escape") {
          closePriceDropdown();
        }
      });
    }

    priceOptions.forEach((option) => {
      option.addEventListener("click", (event) => {
        event.preventDefault();
        setPriceValue(option.dataset.value || "", option.textContent.trim());
        closePriceDropdown();
      });
    });

    document.addEventListener("click", (event) => {
      if (!priceBox.contains(event.target)) {
        closePriceDropdown();
      }
    });

    setPriceValue("", "-- Chọn khoảng giá --");
  }

  formSearch.addEventListener("submit", (event) => {
    event.preventDefault(); // không reload ngay

    // Tạo URL mới mỗi lần submit
    const url = new URL(`${window.location.origin}/search`);

    FIELDS.forEach((name) => {
      const el = formSearch.querySelector(`[name="${name}"]`);
      let val = (el && el.value != null ? String(el.value) : "").trim();

      // Nếu là field số mà <= 0 thì bỏ
      if (!val || (NUM_FIELDS.has(name) && Number(val) <= 0)) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, val);
      }
    });

    window.location.href = url.href;
  });
}
// End Form Search

// ===============================
// Box Tour Info – chỉ còn zoom ảnh, bỏ nút Xem tất cả / Ẩn bớt
// ===============================
const boxTourInfo = document.querySelector(".box-tour-info");
if (boxTourInfo) {
  const boxContent = boxTourInfo.querySelector(".inner-content");
  if (boxContent) {
    new Viewer(boxContent);
  }
}
// End Box Tour Info

// Khởi tạo AOS
AOS.init();

// ==================== UPDATE CART COUNT IN HEADER ====================
/* Tạm tắt cùng mini-cart header — bỏ comment khối này khi hiện lại icon giỏ trên header
async function updateCartCount() {
  try {
    const response = await fetch('/hotel-cart/count');
    const data = await response.json();
    
    if (data.code === 'success') {
      const badge = document.querySelector('.cart-badge');
      if (badge) {
        badge.textContent = data.count;
        if (data.count > 0) {
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  } catch (error) {
    console.error('Error updating cart count:', error);
  }
}

// Update cart count on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateCartCount);
} else {
  updateCartCount();
}
*/

// Stub khi mini-cart header đang ẩn (tránh lỗi nếu sau này có gọi từ code khác)
async function updateCartCount() {}

// ==================== HOTEL SEARCH - NO DEFAULT DATES ====================
// Không set default dates - để người dùng tự chọn

// ==================== EXISTING CODE ====================
AOS.init();
// Hết Khởi tạo AOS

// ===============================
// Swiper Section 2
// ===============================
const swiperSection2 = document.querySelector(".swiper-section-2");
if (swiperSection2) {
  new Swiper(".swiper-section-2", {
    slidesPerView: 1,
    spaceBetween: 20,
    autoplay: {
      delay: 4000,
      disableOnInteraction: false,
    },
    loop: true,
    breakpoints: {
      992: {
        slidesPerView: 2,
      },
      1200: {
        slidesPerView: 3,
      },
    },
  });
}
// End Swiper Section 2

// ===============================
// Swiper Section 3
// ===============================
const swiperSection3 = document.querySelector(".swiper-section-3");
if (swiperSection3) {
  new Swiper(".swiper-section-3", {
    slidesPerView: 1,
    spaceBetween: 20,
    autoplay: {
      delay: 4000,
      disableOnInteraction: false,
    },
    loop: true,
    breakpoints: {
      576: {
        slidesPerView: 2,
      },
      992: {
        slidesPerView: 3,
      },
    },
    pagination: {
      el: ".swiper-pagination",
      clickable: true,
    },
  });
}
// End Swiper Section 3

// ===============================
// Box Images + Zoom
// ===============================
const boxImages = document.querySelector(".box-images");
if (boxImages) {
  const swiperBoxImagesThumb = new Swiper(".swiper-box-images-thumb", {
    spaceBetween: 5,
    slidesPerView: 4,
    breakpoints: {
      576: {
        spaceBetween: 10,
      },
    },
  });
  const swiperBoxImagesMain = new Swiper(".swiper-box-images-main", {
    spaceBetween: 0,
    thumbs: {
      swiper: swiperBoxImagesThumb,
    },
  });
}
// End Box Images

const boxImageMain = document.querySelector(".box-images .inner-images-main");
if (boxImageMain) {
  new Viewer(boxImageMain);
}
// End Zoom Box Image Main

// ===============================
// Zoom Box Tour Schedule
// ===============================
const boxTourSchedule = document.querySelector(".box-tour-schedule");
if (boxTourSchedule) {
  const listBoxContent = boxTourSchedule.querySelectorAll(".inner-content");
  listBoxContent.forEach((boxContent) => {
    new Viewer(boxContent);
  });
}
// End Zoom Box Tour Schedule

// ===============================
// Email Form
// ===============================
const emailForm = document.querySelector("#email-form");
if (emailForm) {
  const validator = new JustValidate("#email-form");

  validator
    .addField("#email-input", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập email!",
      },
      {
        rule: "email",
        errorMessage: "Email không đúng định dạng!",
      },
    ])
    .onSuccess((event) => {
      const email = event.target.email.value;

      const dataFinal = {
        email: email,
      };

      fetch(`/contact/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            notify.success(data.message);
            emailForm.email.value = "";
          }
        });
    });
}
// End Email Form

// ===============================
// Coupon Form
// ===============================
const couponForm = document.querySelector("#coupon-form");
if (couponForm) {
  const validator = new JustValidate("#coupon-form");

  validator
    .addField("#coupon-input", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mã giảm giá!",
      },
    ])
    .onSuccess((event) => {
      const coupon = event.target.coupon.value;
      console.log(coupon);
    });
}
// End Coupon Form

// ===================================================================
// ====== CART STORAGE LAYER (Thêm mới để hỗ trợ chế độ ĐẶT NGAY) =====
// ===================================================================

// Giỏ dài hạn mặc định (localStorage)
const initialCart = localStorage.getItem("cart");
if (!initialCart) {
  localStorage.setItem("cart", JSON.stringify([]));
}

// Helpers cho session/local
function getSessionCart() {
  try {
    return JSON.parse(sessionStorage.getItem("cart_once") || "[]");
  } catch {
    return [];
  }
}
function setSessionCart(arr) {
  sessionStorage.setItem("cart_once", JSON.stringify(arr || []));
}
function clearSessionCart() {
  sessionStorage.removeItem("cart_once");
  sessionStorage.removeItem("cart_once_mode");
}
function getLocalCart() {
  try {
    return JSON.parse(localStorage.getItem("cart") || "[]");
  } catch {
    return [];
  }
}
function setLocalCart(arr) {
  localStorage.setItem("cart", JSON.stringify(arr || []));
}
function isQuickOrderMode() {
  return !!sessionStorage.getItem("cart_once");
}
function getCart() {
  return isQuickOrderMode() ? getSessionCart() : getLocalCart();
}
function setCart(arr) {
  return isQuickOrderMode() ? setSessionCart(arr) : setLocalCart(arr);
}

// ===============================
// Mini Cart
// ===============================
const drawMiniCart = () => {
  const miniCart = document.querySelector("[mini-cart]");
  if (miniCart) {
    const cart = getCart();
    miniCart.innerHTML = cart.length;
  }
};
drawMiniCart();
// End Mini Cart

// ===============================
// Box Tour Detail (tính giá Em bé theo bậc + ràng buộc ghế)
// ===============================
const boxTourDetail = document.querySelector(".box-tour-detail");
if (boxTourDetail) {
  // --- DOM & data ---
  const listInputQuantity = boxTourDetail.querySelectorAll("[input-quantity]");
  const elementTotalPrice = boxTourDetail.querySelector("[total-price]");
  // seatBabyCheckbox đã bị loại bỏ (thay bằng per-baby radio trong passenger rows)
  const seatBabyCheckbox = null;
  const seatBabyWrap = null;

  const inputAdult = boxTourDetail.querySelector(
    '[input-quantity="stockAdult"]'
  );
  const inputChild = boxTourDetail.querySelector(
    '[input-quantity="stockChildren"]'
  );
  const inputBaby = boxTourDetail.querySelector('[input-quantity="stockBaby"]');
  const babyUnitSpan = boxTourDetail.querySelector("[data-baby-unit]");

  const globalMaxSeats =
    parseInt(boxTourDetail.getAttribute("data-seats-remaining")) || 0;
  let maxSeats = globalMaxSeats;
  const priceAdultBase = parseInt(boxTourDetail.dataset.priceAdult) || 0;
  const priceChildBase = parseInt(boxTourDetail.dataset.priceChildren) || 0;
  const priceBabyFixed = parseInt(boxTourDetail.dataset.priceBaby) || 0; // dùng khi mode=fixed
  const babyMode = (boxTourDetail.dataset.babyMode || "fixed").trim();

  // --- Age band config từ data attributes ---
  const dtBabyMaxAge       = parseInt(boxTourDetail.dataset.babyMaxAge, 10);
  const dtChildrenMinAge   = parseInt(boxTourDetail.dataset.childrenMinAge, 10);
  const dtChildrenMaxAge   = parseInt(boxTourDetail.dataset.childrenMaxAge, 10);
  const agebabyMax         = isNaN(dtBabyMaxAge)     ? 3  : dtBabyMaxAge;
  const ageChildMin        = isNaN(dtChildrenMinAge) ? 4  : dtChildrenMinAge;
  const ageChildMax        = isNaN(dtChildrenMaxAge) ? 11 : dtChildrenMaxAge;
  /** Tuổi tối thiểu của người lớn được tính là "đại diện phòng" khi ở riêng */
  const privateRoomAdultMinAge = 18;
  /** Số em bé tối đa ngồi cùng 1 người lớn (0 = không giới hạn) */
  const maxBabiesPerAdult = Math.max(0, parseInt(boxTourDetail.dataset.maxBabiesPerAdult, 10) || 0);
  /** Phí ghế ngồi riêng cho mỗi em bé (0 = ghế riêng miễn phí) */
  const babySeatFee = Math.max(0, parseInt(boxTourDetail.dataset.babySeatFee, 10) || 0);
  /** Chờ người dùng nhập xong tuổi NL rồi mới hiện dropdown người đi cùng */
  const GUARDIAN_SELECT_DEBOUNCE_MS = 350;
  const guardianSelectDebounceTimers = new Map();

  function _parsePassengerAge(p) {
    if (p.age === "" || p.age === null || p.age === undefined) return NaN;
    return parseInt(p.age, 10);
  }

  /** NL từ 18 tuổi — có thể làm người đi cùng / anchor atom khi ở ghép. */
  function _isAnchorAdult18(p) {
    if (p.type !== "adult") return false;
    const ageNum = _parsePassengerAge(p);
    return !isNaN(ageNum) && ageNum >= privateRoomAdultMinAge;
  }

  /** TE, EB, hoặc NL tính giá NL nhưng chưa đủ 18 tuổi — cần chọn người đi cùng. */
  function _passengerNeedsGuardian(p) {
    if (p.type === "baby") {
      // Khi maxBabiesPerAdult === 0: tất cả em bé tự động chiếm ghế, không cần chọn NL đi cùng
      if (maxBabiesPerAdult === 0) return false;
      // Em bé cần chọn guardian khi chọn "Ngồi cùng người lớn" (dù ở chế độ nào)
      return p.babySeatType === "shared";
    }
    if (getAccommodationMode() !== "shared") return false;
    if (p.type === "child") return true;
    if (p.type === "adult") {
      const ageNum = _parsePassengerAge(p);
      return !isNaN(ageNum) && ageNum < privateRoomAdultMinAge;
    }
    return false;
  }

  function _countAdults18PlusInState() {
    return passengerState.filter((p) => {
      if (p.type !== "adult") return false;
      const ageNum =
        p.age === "" || p.age === null || p.age === undefined
          ? NaN
          : parseInt(p.age, 10);
      return !isNaN(ageNum) && ageNum >= privateRoomAdultMinAge;
    }).length;
  }

  function _formatPrivateMinAdultsRequiredMessage(minRooms, adults18Count) {
    const n = Math.max(0, parseInt(minRooms, 10) || 0);
    const c = Math.max(0, parseInt(adults18Count, 10) || 0);
    return (
      `Khung thời gian có nhiều phòng nhất yêu cầu ${n} phòng. ` +
      `Mỗi phòng cần ít nhất 1 người từ ${privateRoomAdultMinAge} tuổi trở lên. ` +
      `Hiện tại, đoàn có ${c} người từ ${privateRoomAdultMinAge} tuổi trở lên. ` +
      `Vui lòng bổ sung người từ ${privateRoomAdultMinAge} tuổi trở lên hoặc điều chỉnh số lượng phòng/khách.`
    );
  }

  let babyRules = [];
  try {
    const raw = boxTourDetail.dataset.babyRules || "[]";
    babyRules = JSON.parse(raw);
    if (!Array.isArray(babyRules)) babyRules = [];
  } catch {
    babyRules = [];
  }

  /**
   * State của passenger list — khai báo sớm vì drawBoxDetail() đọc khi tính ghế em bé.
   */
  let passengerState = [];

  /**
   * State phân bổ phòng cho mode "Ở riêng".
   * Key: `${fromDate}|${toDate}|${hotelId}|${roomTypeId}|${roomIndex}` (1 phòng vật lý).
   * Value: Set<number> — các idx hành khách đã gán vào phòng này.
   */
  const privateAssignmentState = new Map();

  // ======== GIÁ EM BÉ THEO TỪNG VỊ TRÍ (1-based) ========
  function babyUnitAt(idx) {
    if (babyMode !== "tiered" || !babyRules.length) return priceBabyFixed; // dùng khi mode=fixed, hoặc không có rules

    const rule = babyRules.find((r) => {
      const from = Number(r.from);
      const to = r.to === "inf" ? Infinity : Number(r.to);
      return Number.isFinite(from) && idx >= from && idx <= to;
    });
    if (!rule) return 0;

    const base = rule.ref === "adult" ? priceAdultBase : priceChildBase; // dùng khi ref=adult hoặc ref=children
    const pct = Number(rule.percent) || 0; // dùng khi %=0, không có % thì giá em bé = 0
    return Math.round((base * pct) / 100);
  }

  // Chi phí phòng cộng thêm (được cập nhật bởi updateRoomValidation)
  let currentExtraRoomCost = 0;

  // ======== VẼ LẠI HỘP CHI TIẾT ========
  function drawBoxDetail(changedInput = null) {
    let adult = parseInt(inputAdult?.value) || 0;
    let child = parseInt(inputChild?.value) || 0;
    let baby = parseInt(inputBaby?.value) || 0;

    adult = Math.max(0, adult);
    child = Math.max(0, child);
    baby = Math.max(0, baby);

    // Em bé chiếm ghế tour:
    // - maxBabiesPerAdult === 0 (auto mode): TẤT CẢ em bé chiếm ghế
    // - maxBabiesPerAdult > 0 (picker mode): chỉ em bé chọn "Ghế ngồi riêng"
    const privateSeatBabyCount = maxBabiesPerAdult === 0
      ? baby
      : passengerState.filter((p) => p.type === "baby" && p.babySeatType === "private").length;

    // ----- RÀNG BUỘC GHẾ -----
    if (maxSeats > 0) {
      let usedSeats = adult + child + privateSeatBabyCount;

      if (usedSeats > maxSeats) {
        notify?.error?.(
          `Tổng số ghế sử dụng không được vượt quá ${maxSeats} chỗ còn lại!`
        );

        if (changedInput === inputAdult) {
          const other = child + privateSeatBabyCount;
          adult = Math.max(1, maxSeats - other);
          inputAdult.value = adult;
        } else if (changedInput === inputChild) {
          const other = adult + privateSeatBabyCount;
          child = Math.max(0, maxSeats - other);
          inputChild.value = child;
        } else if (changedInput === inputBaby) {
          const other = adult + child;
          baby = Math.max(0, maxSeats - other);
          inputBaby.value = baby;
        } else {
          let overflow = usedSeats - maxSeats;
          if (child > 0 && overflow > 0) {
            const dec = Math.min(child, overflow);
            child -= dec;
            overflow -= dec;
            inputChild.value = child;
          }
          if (adult > 1 && overflow > 0) {
            const dec = Math.min(adult - 1, overflow);
            adult -= dec;
            overflow -= dec;
            inputAdult.value = adult;
          }
        }
      }
    }

    // ----- CẬP NHẬT LABEL -----
    [
      { field: "stockAdult", qty: adult, input: inputAdult },
      { field: "stockChildren", qty: child, input: inputChild },
      { field: "stockBaby", qty: baby, input: inputBaby },
    ].forEach(({ field, qty, input }) => {
      if (!input) return;
      input.value = qty;
      const label = boxTourDetail.querySelector(`[label-quantity="${field}"]`);
      if (label) label.textContent = qty;
    });

    // ----- TÍNH GIÁ EM BÉ -----
    let babyTotal = 0;
    for (let i = 1; i <= baby; i++) {
      babyTotal += babyUnitAt(i); // tính giá em bé thứ i
    }

    const unitForUi = babyUnitAt(Math.max(1, baby || 1)); // Nếu baby === 0 → baby || 1 = 1 → lấy babyUnitAt(1) (giá “bé thứ 1” làm tham chiếu khi chưa chọn số lượng). Nếu baby >= 1 → dùng babyUnitAt(baby) — tức hiển thị mức giá áp cho em bé thứ baby (thường là bé “cuối” trong dãy), không phải trung bình.

    if (inputBaby) inputBaby.setAttribute("data-price", String(unitForUi));
    if (babyUnitSpan)
      babyUnitSpan.textContent = unitForUi.toLocaleString("vi-VN");

    const babySeatFeeTotal = privateSeatBabyCount * babySeatFee;
    const tourBasePrice = adult * priceAdultBase + child * priceChildBase + babyTotal;
    const totalPrice = tourBasePrice + (currentExtraRoomCost || 0) + babySeatFeeTotal;
    if (elementTotalPrice) {
      elementTotalPrice.textContent = (totalPrice || 0).toLocaleString("vi-VN");
    }
  }

  // Vẽ lần đầu
  drawBoxDetail();

  // Lắng nghe input
  listInputQuantity.forEach((input) => {
    input.addEventListener("input", () => {
      drawBoxDetail(input);
      updateAgeInputs();
    });
    if (input.name === "quantityAdult") {
      input.addEventListener("blur", () => {
        const v = parseInt(input.value || "0", 10) || 0;
        if (v < 1) {
          input.value = "1";
          drawBoxDetail(input);
          updateAgeInputs();
        }
      });
    }
  });
  // Event listener seatBabyCheckbox đã được loại bỏ (per-baby radio tự trigger drawBoxDetail)

  // === NHẬP TUỔI TỪNG TRẺ EM / EM BÉ ===
  const ageWrapper       = boxTourDetail.querySelector(".age-inputs-wrapper");
  const childrenGroup    = boxTourDetail.querySelector("#children-ages-group");
  const childrenAgesList = boxTourDetail.querySelector("#children-ages-list");
  const babiesGroup      = boxTourDetail.querySelector("#babies-ages-group");
  const babiesAgesList   = boxTourDetail.querySelector("#babies-ages-list");

  function _clampAgeInput(inp, min, max) {
    const raw = inp.value;
    if (raw === "") return; // cho phép trống tạm thời khi đang gõ
    const n = parseInt(raw, 10);
    if (isNaN(n)) {
      inp.value = String(min);
      return;
    }
    if (n < min) inp.value = String(min);
    else if (n > max) inp.value = String(max);
    else inp.value = String(n);
  }

  function renderAgeRows(container, count, min, max, labelPrefix, existingAges) {
    if (!container) return;
    // Giữ lại các giá trị hiện tại trước khi render lại
    const current = [];
    container.querySelectorAll(".age-input-row input").forEach(inp => {
      const v = parseInt(inp.value, 10);
      current.push(isNaN(v) ? min : Math.min(max, Math.max(min, v)));
    });
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      let raw = (existingAges && existingAges[i] !== undefined)
        ? existingAges[i]
        : (current[i] !== undefined ? current[i] : min);
      const num = parseInt(raw, 10);
      const val = isNaN(num) ? min : Math.min(max, Math.max(min, num));
      const row = document.createElement("div");
      row.className = "age-input-row";
      row.innerHTML = `
        <label class="age-input-label">${labelPrefix} thứ ${i + 1}:</label>
        <input class="age-input-field" type="number" min="${min}" max="${max}" value="${val}" required>
        <span class="age-input-hint">${min}–${max} tuổi</span>
      `;
      const inp = row.querySelector("input");
      inp.addEventListener("input", () => {
        if (inp.value === "") return;
        const n = parseInt(inp.value, 10);
        if (!isNaN(n) && n > max) inp.value = String(max);
      });
      inp.addEventListener("blur", () => _clampAgeInput(inp, min, max));
      container.appendChild(row);
    }
  }

  function updateAgeInputs(existingChildrenAges, existingBabyAges) {
    const qc = parseInt(inputChild?.value || "0", 10) || 0;
    const qb = parseInt(inputBaby?.value || "0", 10) || 0;

    if (ageWrapper) ageWrapper.style.display = (qc > 0 || qb > 0) ? "" : "none";
    if (childrenGroup) childrenGroup.style.display = qc > 0 ? "" : "none";
    if (babiesGroup)   babiesGroup.style.display   = qb > 0 ? "" : "none";

    renderAgeRows(childrenAgesList, qc, ageChildMin, ageChildMax, "Trẻ em", existingChildrenAges);
    renderAgeRows(babiesAgesList,   qb, 0, agebabyMax, "Em bé",  existingBabyAges);
  }

  function collectAges(container) {
    const ages = [];
    if (!container) return ages;
    container.querySelectorAll(".age-input-field").forEach(inp => {
      ages.push(parseInt(inp.value, 10) || 0);
    });
    return ages;
  }

  // Vẽ lần đầu
  updateAgeInputs();

  // === ROOM SELECTION: validation, occupancy, extra cost (segment-level) ===
  const roomSelectionWrap = boxTourDetail.querySelector(".inner-room-selection");
  const requiredWarning = boxTourDetail.querySelector(".room-selection-required-warning");
  const privateMinAdultsWarning = boxTourDetail.querySelector(
    ".private-min-adults-warning"
  );
  const isRoomRequired = roomSelectionWrap && roomSelectionWrap.getAttribute("data-required") === "1";

  // ── ACCOMMODATION MODE (Ở riêng / Ở ghép) ──────────────────────────────────
  const modePicker = boxTourDetail.querySelector(".accommodation-mode-picker");
  const sharedSelectionWrap = boxTourDetail.querySelector(
    ".inner-shared-room-selection"
  );
  const sharedRequiredWarning = boxTourDetail.querySelector(
    ".shared-room-required-warning"
  );
  const sharedFeasibilityWarning = boxTourDetail.querySelector(
    ".shared-feasibility-warning"
  );
  const passengerListWrap = boxTourDetail.querySelector(
    ".shared-passenger-list"
  );
  const passengerRowsWrap = boxTourDetail.querySelector(
    ".shared-passenger-list__rows"
  );
  const passengerWarning = boxTourDetail.querySelector(
    ".shared-passenger-list__warning"
  );
  const privateAssignmentWrap = boxTourDetail.querySelector(
    ".private-room-assignment"
  );
  const privateAssignmentSegmentsEl = boxTourDetail.querySelector(
    ".private-room-assignment__segments"
  );
  const privateAssignmentWarning = boxTourDetail.querySelector(
    ".private-room-assignment__warning"
  );

  /**
   * State của passenger list — lưu cục bộ (không gắn DOM) để tránh mất data
   * khi re-render. Mỗi entry: { idx, name, age, type, gender, guardianIdx }.
   * Index bám theo thứ tự render (NL trước, TE giữa, EB cuối) → khi user đổi
   * số lượng ở quantity inputs, ta re-render và cố gắng giữ data theo idx.
   */
  // passengerState khai báo ở trên (trước drawBoxDetail).

  /**
   * State phân bổ phòng cho mode "Ở riêng" — khai báo ở trên cùng passengerState.
   */
  function _privateAssignKey(fromDate, toDate, hotelId, roomTypeId, roomIndex) {
    return [fromDate, toDate, hotelId, roomTypeId, roomIndex].join("|");
  }
  function _getAssignSet(key) {
    if (!privateAssignmentState.has(key)) {
      privateAssignmentState.set(key, new Set());
    }
    return privateAssignmentState.get(key);
  }

  /** Trả về mode hiện tại: "private" | "shared". Mặc định "private". */
  // đọc mode đang chọn
  function getAccommodationMode() {
    if (!modePicker) return "private";
    const checked = modePicker.querySelector(
      'input[name="accommodationMode"]:checked'
    );
    return checked ? checked.value : "private";
  }

  let segmentsData = [];
  if (roomSelectionWrap) {
    try { segmentsData = JSON.parse(roomSelectionWrap.getAttribute("data-room-segments") || "[]"); } catch (_) {}
  }

  function getOccupancyWeight(age, ageBands) {
    if (!ageBands || ageBands.length === 0) return 1;
    for (const band of ageBands) {
      const min = band.minAge ?? 0;
      const max = band.maxAge;
      if (max === null || max === undefined) {
        if (age >= min) return band.occupancyWeight ?? 1;
      } else {
        if (age >= min && age <= max) return band.occupancyWeight ?? 1;
      }
    }
    return 1;
  }

  function fmtOccNum(n) {
    return (Math.round(Number(n) * 10) / 10).toFixed(1).replace(".", ",");
  }

  /** Lấy ageBands bảo thủ nhất (occupancyWeight cao nhất cho mỗi khoảng tuổi) từ tất cả hotels trong segment */
  function getMergedAgeBandsForSegment(segObj) {
    const allBands = [];
    (segObj.hotels || []).forEach((h) => { (h.ageBands || []).forEach((b) => allBands.push(b)); });
    if (allBands.length === 0) return [];
    const map = {};
    allBands.forEach((b) => {
      const key = (b.minAge ?? 0) + "|" + (b.maxAge === null || b.maxAge === undefined ? "null" : b.maxAge);
      if (!map[key] || (b.occupancyWeight ?? 1) > (map[key].occupancyWeight ?? 1)) {
        map[key] = b;
      }
    });
    return Object.values(map);
  }

  function getSegmentDataByKey(fromDate, toDate) {
    return segmentsData.find((s) => s.fromDate === fromDate && s.toDate === toDate) || null;
  }

  function calcOccupancyBreakdown(ageBands) {
    const adults = parseInt(boxTourDetail.querySelector(`[name="quantityAdult"]`)?.value || "0", 10) || 0;
    const cAges = collectAges(childrenAgesList);
    const bAges = collectAges(babiesAgesList);
    let total = 0;
    const parts = [];

    if (adults > 0) {
      const w = getOccupancyWeight(99, ageBands);
      const sub = adults * w;
      total += sub;
      parts.push(adults + " người lớn × " + fmtOccNum(w) + " = " + fmtOccNum(sub));
    }
    if (cAges.length > 0) {
      const per = cAges.map((a) => a + " tuổi: " + fmtOccNum(getOccupancyWeight(a, ageBands)));
      const sub = cAges.reduce((s, a) => s + getOccupancyWeight(a, ageBands), 0);
      total += sub;
      parts.push(cAges.length + " trẻ em (" + per.join(" · ") + ") → " + fmtOccNum(sub));
    }
    if (bAges.length > 0) {
      const per = bAges.map((a) => a + " tuổi: " + fmtOccNum(getOccupancyWeight(a, ageBands)));
      const sub = bAges.reduce((s, a) => s + getOccupancyWeight(a, ageBands), 0);
      total += sub;
      parts.push(bAges.length + " em bé (" + per.join(" · ") + ") → " + fmtOccNum(sub));
    }

    if (parts.length === 0) return { total: 0, detail: "Chưa có hành khách." };
    return { total, detail: parts.join("  |  ") };
  }

  /** Đọc sức chứa quy đổi đoàn + tổng sức chứa phòng đã chọn trong một khung thời gian */
  function getSegmentOccupancyAndSelections(segEl) {
    const fromDate = segEl.getAttribute("data-from-date");
    const toDate = segEl.getAttribute("data-to-date");
    const segObj = getSegmentDataByKey(fromDate, toDate);
    const mergedBands = segObj ? getMergedAgeBandsForSegment(segObj) : [];
    const { total: totalOcc, detail } = calcOccupancyBreakdown(mergedBands);
    let segTotalCap = 0;
    const selectedItems = [];
    segEl.querySelectorAll(".room-type-row").forEach((row) => {
      const qty = Math.max(0, parseInt(row.querySelector(".room-qty-input")?.value || "0", 10));
      if (qty <= 0) return;
      const baseOcc = parseInt(row.getAttribute("data-base-occupancy") || "2", 10);
      const pricePerNight = parseFloat(row.getAttribute("data-price-per-night") || "0");
      const roomTypeName = row.querySelector(".room-type-row__name")?.textContent?.trim() || "";
      const hotelBlock = row.closest(".room-hotel-block");
      const hotelName = hotelBlock?.querySelector(".room-hotel-block__name")?.textContent?.trim() || "";
      segTotalCap += qty * baseOcc;
      selectedItems.push({ qty, baseOcc, pricePerNight, roomTypeName, hotelName });
    });
    return { fromDate, toDate, totalOcc, detail, segTotalCap, selectedItems };
  }

  function hasRoomSegmentCapacityShortfall() {
    if (!roomSelectionWrap) return false;
    let bad = false;
    roomSelectionWrap.querySelectorAll(".room-time-segment").forEach((segEl) => {
      const m = getSegmentOccupancyAndSelections(segEl);
      if (m.totalOcc > m.segTotalCap) bad = true;
    });
    return bad;
  }

  /**
   * Số NL tối thiểu (ở riêng): max số phòng trong một khung thời gian,
   * không cộng các khung (khách không ở đồng thời mọi khung).
   */
  function getPrivateMinAdultsRequired() {
    if (!roomSelectionWrap) return 0;
    let maxRooms = 0;
    roomSelectionWrap.querySelectorAll(".room-time-segment").forEach((segEl) => {
      let segRooms = 0;
      segEl.querySelectorAll(".room-qty-input").forEach((inp) => {
        segRooms += Math.max(0, parseInt(inp.value || "0", 10) || 0);
      });
      if (segRooms > maxRooms) maxRooms = segRooms;
    });
    return maxRooms;
  }

  function hasAnyPrivateRoomsSelected() {
    return getPrivateMinAdultsRequired() > 0;
  }

  function collectRoomSelections() {
    const selections = [];
    if (!roomSelectionWrap) return selections;
    roomSelectionWrap.querySelectorAll(".room-time-segment").forEach((segEl) => {
      const fromDate = segEl.getAttribute("data-from-date");
      const toDate = segEl.getAttribute("data-to-date");
      segEl.querySelectorAll(".room-hotel-block").forEach((hBlock) => {
        const hotelId = hBlock.getAttribute("data-hotel-id");
        const hotelName = hBlock.querySelector(".room-hotel-block__name")?.textContent?.trim() || "";
        const tourSegmentId = hBlock.getAttribute("data-tour-segment-id");
        hBlock.querySelectorAll(".room-type-row").forEach((row) => {
          const qty = Math.max(0, parseInt(row.querySelector(".room-qty-input")?.value || "0", 10));
          if (qty <= 0) return;
          selections.push({
            hotelId,
            hotelName,
            roomTypeId: row.getAttribute("data-room-type-id"),
            roomTypeName: row.querySelector(".room-type-row__name")?.textContent?.trim() || "",
            baseOccupancy: parseInt(row.getAttribute("data-base-occupancy") || "2", 10),
            pricePerNight: parseFloat(row.getAttribute("data-price-per-night") || "0"),
            selectedRooms: qty,
            fromDate,
            toDate,
            tourSegmentId,
          });
        });
      });
    });
    return selections;
  }

  // ── Passenger list (chi tiết hành khách cho mode "Ở ghép") ──────────────
  //
  // Render row động dựa trên quantityAdult/Children/Baby. Index trong list:
  //   [0..A-1] = adult, [A..A+C-1] = child, [A+C..A+C+B-1] = baby.
  // State được preserve qua re-render bằng cách map theo idx + type.

  function _readQuantityCounts() {
    const adults = parseInt(
      boxTourDetail.querySelector(`[name="quantityAdult"]`)?.value || "0",
      10
    ) || 0;
    const children = parseInt(
      boxTourDetail.querySelector(`[name="quantityChildren"]`)?.value || "0",
      10
    ) || 0;
    const babies = parseInt(
      boxTourDetail.querySelector(`[name="quantityBaby"]`)?.value || "0",
      10
    ) || 0;
    return { adults, children, babies };
  }

  function _readChildAndBabyAgesFromMiniBlock() {
    return {
      childAges: collectAges(childrenAgesList),
      babyAges: collectAges(babiesAgesList),
    };
  }

  function _ensurePassengerSlots() {
    const { adults, children, babies } = _readQuantityCounts();
    const { childAges, babyAges } = _readChildAndBabyAgesFromMiniBlock();
    const totalCount = adults + children + babies;
    const newState = [];
    for (let i = 0; i < adults; i++) {
      const prev = passengerState.find((p) => p.idx === i && p.type === "adult");
      const prevGuardian =
        prev && typeof prev.guardianIdx === "number" ? prev.guardianIdx : null;
      const prevAge = prev ? _parsePassengerAge(prev) : NaN;
      const needsGuardian =
        !isNaN(prevAge) && prevAge < privateRoomAdultMinAge;
      newState.push({
        idx: i,
        type: "adult",
        name: prev ? prev.name : "",
        age: prev ? prev.age : "",
        gender: prev ? prev.gender : "",
        guardianIdx:
          needsGuardian &&
          prevGuardian !== null &&
          prevGuardian < adults
            ? prevGuardian
            : null,
      });
    }
    for (let i = 0; i < children; i++) {
      const idx = adults + i;
      const prev = passengerState.find((p) => p.idx === idx && p.type === "child");
      const prevGuardian = prev && typeof prev.guardianIdx === "number" ? prev.guardianIdx : null;
      const ageFromMini = Number.isFinite(Number(childAges[i]))
        ? Math.max(0, parseInt(childAges[i], 10) || 0)
        : "";
      newState.push({
        idx,
        type: "child",
        name: prev ? prev.name : "",
        // Tuổi TE luôn đồng bộ từ khối "Tuổi hành khách nhỏ".
        age: ageFromMini,
        gender: "",
        guardianIdx: prevGuardian !== null && prevGuardian < adults ? prevGuardian : null,
      });
    }
    for (let i = 0; i < babies; i++) {
      const idx = adults + children + i;
      const prev = passengerState.find((p) => p.idx === idx && p.type === "baby");
      const prevGuardian = prev && typeof prev.guardianIdx === "number" ? prev.guardianIdx : null;
      const prevRoomGuardian =
        prev && typeof prev.roomGuardianIdx === "number" ? prev.roomGuardianIdx : null;
      const ageFromMini = Number.isFinite(Number(babyAges[i]))
        ? Math.max(0, parseInt(babyAges[i], 10) || 0)
        : "";
      const prevBabySeatType = prev ? prev.babySeatType : null;
      newState.push({
        idx,
        type: "baby",
        name: prev ? prev.name : "",
        // Tuổi em bé luôn đồng bộ từ khối "Tuổi hành khách nhỏ".
        age: ageFromMini,
        gender: "",
        // guardianIdx = người lớn ngồi cùng trên TOUR (xe/máy bay)
        guardianIdx: prevGuardian !== null && prevGuardian < adults ? prevGuardian : null,
        // roomGuardianIdx = người lớn ở cùng PHÒNG khách sạn (dùng để xếp atom)
        roomGuardianIdx:
          prevRoomGuardian !== null && prevRoomGuardian < adults
            ? prevRoomGuardian
            : null,
        // Loại chỗ ngồi: 'shared' = ngồi cùng NL, 'private' = ghế riêng, null = chưa chọn
        babySeatType: prevBabySeatType,
      });
    }
    passengerState = newState;
    return totalCount;
  }

  function _clearGuardianSelectDebounce(idx) {
    const timerId = guardianSelectDebounceTimers.get(idx);
    if (timerId) {
      clearTimeout(timerId);
      guardianSelectDebounceTimers.delete(idx);
    }
  }

  function _clearAllGuardianSelectDebounces() {
    guardianSelectDebounceTimers.forEach((timerId) => clearTimeout(timerId));
    guardianSelectDebounceTimers.clear();
  }

  /** Sau khi người dùng ngừng gõ tuổi một lúc, mới hiện/ẩn khối chọn người đi cùng. */
  function _scheduleGuardianSelectSync(row, p) {
    _clearGuardianSelectDebounce(p.idx);
    const timerId = setTimeout(() => {
      guardianSelectDebounceTimers.delete(p.idx);
      if (!row.isConnected) return;
      _syncGuardianSelectOnRow(row, p);
      _refreshGuardianOptions();
      updateRoomValidation();
    }, GUARDIAN_SELECT_DEBOUNCE_MS);
    guardianSelectDebounceTimers.set(p.idx, timerId);
  }

  function _appendGuardianSelect(row, p) {
    const guardianSelect = document.createElement("select");
    guardianSelect.className = "passenger-guardian";
    guardianSelect.setAttribute("data-idx", String(p.idx));
    if (p.type === "baby") {
      guardianSelect.title = "Người lớn ngồi cùng em bé trên tour";
    }
    guardianSelect.addEventListener("change", () => {
      p.guardianIdx =
        guardianSelect.value === "" ? null : parseInt(guardianSelect.value, 10);
      updateRoomValidation();
    });
    row.appendChild(guardianSelect);
    return guardianSelect;
  }

  /** Select "Em bé ở cùng ai trong phòng khách sạn" — chỉ render khi ở ghép + baby. */
  function _appendRoomGuardianSelect(row, p) {
    const wrap = document.createElement("div");
    wrap.className = "baby-room-guardian passenger-guardian-wrap";
    wrap.setAttribute("data-idx", String(p.idx));
    wrap.style.cssText =
      "display:flex;align-items:center;gap:6px;flex:1 1 100%;margin-top:6px;font-size:13px;color:#444";

    const label = document.createElement("span");
    label.className = "baby-room-guardian__label";
    label.style.cssText = "white-space:nowrap;color:#5c7cfa;font-weight:500";
    label.innerHTML =
      '<i class="fa-solid fa-bed" style="margin-right:4px"></i>Ở phòng cùng:';
    wrap.appendChild(label);

    const sel = document.createElement("select");
    sel.className = "passenger-room-guardian";
    sel.setAttribute("data-idx", String(p.idx));
    sel.title = "Người lớn em bé sẽ ở cùng phòng khách sạn";
    sel.addEventListener("change", () => {
      p.roomGuardianIdx =
        sel.value === "" ? null : parseInt(sel.value, 10);
      updateRoomValidation();
    });
    wrap.appendChild(sel);
    row.appendChild(wrap);
    return sel;
  }

  function _babyNeedsRoomGuardian(p) {
    return (
      p &&
      p.type === "baby" &&
      getAccommodationMode() === "shared"
    );
  }

  function _syncGuardianSelectOnRow(row, p) {
    const needs = _passengerNeedsGuardian(p);
    let sel = row.querySelector(".passenger-guardian");
    if (needs && !sel) {
      _appendGuardianSelect(row, p);
      _refreshGuardianOptions();
    } else if (!needs && sel) {
      p.guardianIdx = null;
      sel.remove();
    }

    // Quản lý select "Ở phòng cùng" cho em bé khi ở ghép
    const needsRoom = _babyNeedsRoomGuardian(p);
    let roomWrap = row.querySelector(".baby-room-guardian");
    if (needsRoom && !roomWrap) {
      _appendRoomGuardianSelect(row, p);
      _refreshGuardianOptions();
    } else if (!needsRoom && roomWrap) {
      p.roomGuardianIdx = null;
      roomWrap.remove();
    }
  }

  function _renderPassengerRow(p) {
    const row = document.createElement("div");
    row.className = "passenger-row";
    row.setAttribute("data-idx", String(p.idx));
    row.setAttribute("data-type", p.type);

    const indexEl = document.createElement("span");
    indexEl.className = "passenger-row__index";
    indexEl.textContent = String(p.idx + 1);
    row.appendChild(indexEl);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "passenger-name";
    nameInput.placeholder = "Họ tên";
    nameInput.value = p.name || "";
    nameInput.addEventListener("input", () => {
      p.name = nameInput.value;
      _refreshGuardianOptions();
      updateRoomValidation();
    });
    row.appendChild(nameInput);

    const ageInput = document.createElement("input");
    ageInput.type = "number";
    ageInput.className = "passenger-age";
    if (p.type === "adult") {
      const adultMin = ageChildMax + 1;
      ageInput.min = String(adultMin);
      ageInput.max = "120";
      ageInput.placeholder = `Tuổi (≥ ${adultMin})`;
      ageInput.title = `Người lớn từ ${adultMin} tuổi trở lên`;
    } else {
      ageInput.min = "0";
      ageInput.max = "120";
      ageInput.placeholder = "Tuổi";
    }
    ageInput.value = p.age === "" ? "" : String(p.age);
    if (p.type !== "adult") {
      // Trẻ em/em bé lấy tuổi từ khối "Tuổi hành khách nhỏ", không sửa tại đây.
      ageInput.readOnly = true;
      ageInput.title = "Tuổi được đồng bộ từ khối Tuổi hành khách nhỏ.";
    }
    ageInput.addEventListener("input", () => {
      p.age = ageInput.value === "" ? "" : Math.max(0, parseInt(ageInput.value, 10) || 0);
      if (p.type === "adult") {
        // Cập nhật nhãn tuổi trong mọi dropdown "người lớn đi cùng" (em bé / TE / NL trẻ).
        _refreshGuardianOptions();
        if (getAccommodationMode() === "shared") {
          // Ẩn dropdown trên dòng đang sửa trong lúc gõ; sau debounce mới quyết định hiện lại.
          const sel = row.querySelector(".passenger-guardian");
          if (sel) {
            p.guardianIdx = null;
            sel.remove();
          }
          _scheduleGuardianSelectSync(row, p);
        }
      }
      updateRoomValidation();
    });
    row.appendChild(ageInput);

    const badge = document.createElement("span");
    badge.className =
      "passenger-type-badge is-" + (p.type === "adult" ? "adult" : p.type === "child" ? "child" : "baby");
    badge.textContent =
      p.type === "adult" ? "Người lớn" : p.type === "child" ? "Trẻ em" : "Em bé";
    row.appendChild(badge);

    if (p.type === "adult") {
      const genderWrap = document.createElement("div");
      genderWrap.className = "passenger-gender";
      ["male", "female"].forEach((g) => {
        const lbl = document.createElement("label");
        const inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "passenger_gender_" + p.idx;
        inp.value = g;
        if (p.gender === g) inp.checked = true;
        inp.addEventListener("change", () => {
          if (inp.checked) {
            p.gender = g;
            updateRoomValidation();
          }
        });
        lbl.appendChild(inp);
        lbl.appendChild(document.createTextNode(g === "male" ? " Nam" : " Nữ"));
        genderWrap.appendChild(lbl);
      });
      row.appendChild(genderWrap);
    }

    // EM BÉ: hiển thị chỗ ngồi
    if (p.type === "baby") {
      if (maxBabiesPerAdult === 0) {
        // Auto mode: tất cả em bé tự động chiếm ghế, chỉ hiện badge thông báo
        const autoBadge = document.createElement("div");
        autoBadge.className = "baby-seat-auto-badge";
        autoBadge.innerHTML =
          '<i class="fa-solid fa-chair" style="margin-right:4px"></i>' +
          "Tự động chiếm 1 vị trí tour";
        row.appendChild(autoBadge);
        // Đặt babySeatType = 'private' tự động (không cần chọn)
        p.babySeatType = "private";
      } else {
        // Picker mode: cho khách chọn
        const seatPickerWrap = document.createElement("div");
        seatPickerWrap.className = "baby-seat-picker";

        const seatLabel = document.createElement("span");
        seatLabel.className = "baby-seat-picker__label";
        seatLabel.textContent = "Chỗ ngồi:";
        seatPickerWrap.appendChild(seatLabel);

        const options = [
          { value: "shared", label: "Ngồi cùng người lớn" },
          {
            value: "private",
            label:
              babySeatFee > 0
                ? "Ghế ngồi riêng (+" + babySeatFee.toLocaleString("vi-VN") + "đ)"
                : "Ghế ngồi riêng (miễn phí)",
          },
        ];

        options.forEach(({ value, label }) => {
          const lbl = document.createElement("label");
          lbl.className = "baby-seat-option";
          const inp = document.createElement("input");
          inp.type = "radio";
          inp.name = "baby_seat_type_" + p.idx;
          inp.value = value;
          if (p.babySeatType === value) inp.checked = true;
          inp.addEventListener("change", () => {
            if (inp.checked) {
              p.babySeatType = value;
              if (value === "private") {
                p.guardianIdx = null;
              }
              renderPassengerRows();
              updateRoomValidation();
            }
          });
          lbl.appendChild(inp);
          lbl.appendChild(document.createTextNode(" " + label));
          seatPickerWrap.appendChild(lbl);
        });

        row.appendChild(seatPickerWrap);
      }
    }

    // EB với "Ngồi cùng người lớn" hoặc TE/NL trẻ ở ghép phải chọn người đi cùng.
    if (_passengerNeedsGuardian(p)) {
      _appendGuardianSelect(row, p);
    }

    // Em bé ở ghép: thêm select riêng "Ở phòng cùng" (anchor adult 18+)
    if (_babyNeedsRoomGuardian(p)) {
      _appendRoomGuardianSelect(row, p);
    }

    return row;
  }

  /** NL có thể làm người đi cùng em bé (mọi tuổi tính giá NL). */
  function _isBabyGuardianCandidate(p) {
    return p && p.type === "adult";
  }

  /** NL ≥18 tuổi, hoặc chưa khai tuổi — dùng cho TE / NL trẻ (ở ghép). */
  function _getGuardianCandidateAdults(forPassenger) {
    if (forPassenger && forPassenger.type === "baby") {
      return passengerState.filter((p) => _isBabyGuardianCandidate(p));
    }
    return passengerState.filter((p) => {
      if (p.type !== "adult") return false;
      const ageNum = _parsePassengerAge(p);
      return isNaN(ageNum) || ageNum >= privateRoomAdultMinAge;
    });
  }

  function _isValidBabyGuardian(guardian) {
    return _isBabyGuardianCandidate(guardian);
  }

  function _refreshGuardianOptions() {
    if (!passengerRowsWrap) return;

    // Select 1: passenger-guardian (NL đi cùng — chỗ ngồi tour hoặc atom)
    const guardianSelects = passengerRowsWrap.querySelectorAll(".passenger-guardian");
    guardianSelects.forEach((sel) => {
      const idx = parseInt(sel.getAttribute("data-idx") || "-1", 10);
      const ps = passengerState.find((p) => p.idx === idx);
      if (!ps) return;
      const candidates = _getGuardianCandidateAdults(ps);
      const prevValue = ps.guardianIdx === null ? "" : String(ps.guardianIdx);
      sel.innerHTML = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent =
        ps.type === "baby"
          ? "-- Người lớn ngồi cùng trên tour --"
          : "-- Chọn người lớn ở cùng --";
      sel.appendChild(empty);
      candidates.forEach((a) => {
        const opt = document.createElement("option");
        opt.value = String(a.idx);
        const ageNum = _parsePassengerAge(a);
        const display = a.name && a.name.trim() ? a.name.trim() : "Người lớn #" + (a.idx + 1);
        opt.textContent = isNaN(ageNum)
          ? `${display} (chưa khai tuổi)`
          : `${display} (${ageNum} tuổi)`;
        if (prevValue === String(a.idx)) opt.selected = true;
        sel.appendChild(opt);
      });
      if (sel.value === "") ps.guardianIdx = null;
    });

    // Select 2: passenger-room-guardian (chỉ em bé ở ghép) — ứng viên = anchor adult 18+
    const roomSelects = passengerRowsWrap.querySelectorAll(".passenger-room-guardian");
    roomSelects.forEach((sel) => {
      const idx = parseInt(sel.getAttribute("data-idx") || "-1", 10);
      const ps = passengerState.find((p) => p.idx === idx);
      if (!ps) return;
      // Phải là anchor adult (18+, hoặc chưa khai tuổi)
      const candidates = passengerState.filter((p) => {
        if (p.type !== "adult") return false;
        const ageNum = _parsePassengerAge(p);
        return isNaN(ageNum) || ageNum >= privateRoomAdultMinAge;
      });
      const prevValue =
        ps.roomGuardianIdx === null || ps.roomGuardianIdx === undefined
          ? ""
          : String(ps.roomGuardianIdx);
      sel.innerHTML = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "-- Người lớn ở cùng phòng --";
      sel.appendChild(empty);
      candidates.forEach((a) => {
        const opt = document.createElement("option");
        opt.value = String(a.idx);
        const ageNum = _parsePassengerAge(a);
        const display = a.name && a.name.trim() ? a.name.trim() : "Người lớn #" + (a.idx + 1);
        opt.textContent = isNaN(ageNum)
          ? `${display} (chưa khai tuổi)`
          : `${display} (${ageNum} tuổi)`;
        if (prevValue === String(a.idx)) opt.selected = true;
        sel.appendChild(opt);
      });
      if (sel.value === "") ps.roomGuardianIdx = null;
    });
  }

  function renderPassengerRows() {
    if (!passengerRowsWrap) return;
    _clearAllGuardianSelectDebounces();
    _ensurePassengerSlots();
    passengerRowsWrap.innerHTML = "";
    passengerState.forEach((p) => {
      passengerRowsWrap.appendChild(_renderPassengerRow(p));
    });
    _refreshGuardianOptions();
  }

  /**
   * Validate passenger list. Trả về { ok, message?, derivedMales, derivedFemales }.
   * - Tên non-empty cho mọi người.
   * - Tuổi phải khai (>=0).
   * - Adult phải chọn gender.
   * - Child/baby phải chọn guardian (ở ghép).
   * - Ở ghép: đoàn phải có ≥ 1 người lớn từ 18 tuổi trở lên.
   */
  function validatePassengers() {
    const errors = [];
    if (!passengerRowsWrap) return { ok: true, derivedMales: 0, derivedFemales: 0 };
    let derivedMales = 0;
    let derivedFemales = 0;
    passengerState.forEach((p) => {
      const rowEl = passengerRowsWrap.querySelector(
        `.passenger-row[data-idx="${p.idx}"][data-type="${p.type}"]`
      );
      if (rowEl) rowEl.classList.remove("is-invalid");
      const label = "#" + (p.idx + 1);

      // Validate họ tên và tuổi
      if (!p.name || !p.name.trim()) {
        errors.push(label + ": chưa khai họ tên.");
        rowEl?.classList.add("is-invalid");
      }
      if (p.age === "" || p.age === null || p.age === undefined) {
        errors.push(label + ": chưa khai tuổi.");
        rowEl?.classList.add("is-invalid");
      }
      if (p.type === "adult") {

        // Validate tuổi người lớn
        const adultMin = ageChildMax + 1;
        const ageNum = p.age === "" || p.age === null || p.age === undefined
          ? NaN : parseInt(p.age, 10);
        if (!isNaN(ageNum) && ageNum < adultMin) {
          errors.push(label + `: tuổi người lớn phải từ ${adultMin} trở lên (đang nhập ${ageNum}).`);
          rowEl?.classList.add("is-invalid");
        }

        // Chỉ người lớn mới bắt buộc chọn giới tính
        if (p.gender === "male") derivedMales++;
        else if (p.gender === "female") derivedFemales++;
        else {
          errors.push(label + ": chưa chọn giới tính.");
          rowEl?.classList.add("is-invalid");
        }

        // Validate người đi cùng
        if (_passengerNeedsGuardian(p)) {
          if (p.guardianIdx === null || p.guardianIdx === undefined) {
            errors.push(
              label +
                ": chưa chọn người lớn đi cùng từ " +
                privateRoomAdultMinAge +
                " tuổi trở lên."
            );
            rowEl?.classList.add("is-invalid");
          } else {
            const guardian = passengerState.find((g) => g.idx === p.guardianIdx);
            if (!guardian || !_isAnchorAdult18(guardian)) {
              errors.push(
                label +
                  ": người đi cùng phải từ " +
                  privateRoomAdultMinAge +
                  " tuổi trở lên."
              );
              rowEl?.classList.add("is-invalid");
            }
          }
        } else if (
          getAccommodationMode() === "shared" &&
          _isAnchorAdult18(p) &&
          p.guardianIdx !== null &&
          p.guardianIdx !== undefined
        ) {
          errors.push(
            label +
              ": người lớn từ " +
              privateRoomAdultMinAge +
              " tuổi trở lên không cần chọn người đi cùng."
          );
          rowEl?.classList.add("is-invalid");
        }
      } else if (_passengerNeedsGuardian(p)) {
        if (p.guardianIdx === null || p.guardianIdx === undefined) {
          errors.push(
            label +
              ": chưa chọn người lớn đi cùng từ " +
              privateRoomAdultMinAge +
              " tuổi trở lên."
          );
          rowEl?.classList.add("is-invalid");
        } else {
          const guardian = passengerState.find((g) => g.idx === p.guardianIdx);
          if (!guardian || !_isAnchorAdult18(guardian)) {
            errors.push(
              label +
                ": người đi cùng phải từ " +
                privateRoomAdultMinAge +
                " tuổi trở lên."
            );
            rowEl?.classList.add("is-invalid");
          }
        }
      }
    });

    // Ở ghép: đoàn phải có ít nhất 1 người lớn từ 18 tuổi trở lên
    if (getAccommodationMode() === "shared" && passengerState.length > 0) {
      const hasAdult18Plus = passengerState.some((p) => {
        if (p.type !== "adult") return false;
        const ageNum =
          p.age === "" || p.age === null || p.age === undefined
            ? NaN
            : parseInt(p.age, 10);
        return !isNaN(ageNum) && ageNum >= privateRoomAdultMinAge;
      });
      if (!hasAdult18Plus) {
        errors.push(
          "Đoàn phải có ít nhất 1 người lớn từ " +
            privateRoomAdultMinAge +
            " tuổi trở lên."
        );
      }
    }

    // === Validate chỗ ngồi em bé ===
    const babies = passengerState.filter((p) => p.type === "baby");
    if (babies.length > 0) {
      // Dù em bé ở chế độ nào, đoàn vẫn phải có ít nhất 1 người lớn từ 18 tuổi trở lên
      const hasAdult18PlusInGroup = passengerState.some((p) => _isAnchorAdult18(p));
      if (!hasAdult18PlusInGroup) {
        errors.push(
          "Đoàn có em bé phải có ít nhất 1 người lớn từ " +
            privateRoomAdultMinAge +
            " tuổi trở lên đi cùng."
        );
      }

      // === Em bé khi ở ghép PHẢI chọn "Ở phòng cùng" (cả picker & auto mode) ===
      if (getAccommodationMode() === "shared") {
        babies.forEach((p) => {
          const rowEl = passengerRowsWrap
            ? passengerRowsWrap.querySelector(
                `.passenger-row[data-idx="${p.idx}"][data-type="baby"]`
              )
            : null;
          const label = "#" + (p.idx + 1);
          if (p.roomGuardianIdx === null || p.roomGuardianIdx === undefined) {
            errors.push(
              label + " (Em bé): chưa chọn người lớn ở cùng phòng khách sạn."
            );
            rowEl?.classList.add("is-invalid");
          } else {
            const roomG = passengerState.find(
              (g) => g.idx === p.roomGuardianIdx
            );
            if (!roomG || !_isAnchorAdult18(roomG)) {
              errors.push(
                label +
                  " (Em bé): người ở cùng phòng phải là người lớn từ " +
                  privateRoomAdultMinAge +
                  " tuổi trở lên trong đoàn."
              );
              rowEl?.classList.add("is-invalid");
            }
          }
        });
      }

      if (maxBabiesPerAdult === 0) {
        // Auto mode: không cần validate chỗ ngồi vì tất cả tự động chiếm ghế
      } else {
        // Picker mode: validate từng em bé đã chọn loại ghế và guardian hợp lệ
        const babiesPerGuardian = {};

        babies.forEach((p) => {
          const rowEl = passengerRowsWrap
            ? passengerRowsWrap.querySelector(`.passenger-row[data-idx="${p.idx}"][data-type="baby"]`)
            : null;
          const label = "#" + (p.idx + 1);

          // Phải chọn loại chỗ ngồi
          if (!p.babySeatType) {
            errors.push(label + " (Em bé): chưa chọn loại chỗ ngồi (Ngồi cùng người lớn / Ghế ngồi riêng).");
            rowEl?.classList.add("is-invalid");
            return;
          }

          if (p.babySeatType === "shared") {
            // Phải chọn người lớn đi cùng (mọi tuổi tính giá NL)
            if (p.guardianIdx === null || p.guardianIdx === undefined) {
              errors.push(label + " (Em bé): chưa chọn người lớn đi cùng.");
              rowEl?.classList.add("is-invalid");
            } else {
              const guardian = passengerState.find((g) => g.idx === p.guardianIdx);
              if (!guardian || !_isValidBabyGuardian(guardian)) {
                errors.push(label + " (Em bé): người đi cùng phải là người lớn trong đoàn.");
                rowEl?.classList.add("is-invalid");
              } else {
                const gid = p.guardianIdx;
                babiesPerGuardian[gid] = (babiesPerGuardian[gid] || 0) + 1;
              }
            }
          }
          // Nếu babySeatType === 'private': không cần guardian select
        });

        // Kiểm tra số em bé tối đa / người lớn
        Object.entries(babiesPerGuardian).forEach(([adultIdx, count]) => {
          if (count > maxBabiesPerAdult) {
            const guardian = passengerState.find((g) => g.idx === parseInt(adultIdx, 10));
            const guardianLabel = guardian && guardian.name
              ? guardian.name
              : "Người lớn #" + (parseInt(adultIdx, 10) + 1);
            errors.push(
              guardianLabel +
                " đang đi cùng " +
                count +
                " em bé, vượt quá giới hạn tối đa " +
                maxBabiesPerAdult +
                " em bé/người lớn."
            );
          }
        });
      }
    }

    // Ở riêng: NL tối thiểu = max số phòng trong một khung (không cộng các khung)
    if (getAccommodationMode() === "private") {
      const minAdultsRequired = getPrivateMinAdultsRequired();
      if (minAdultsRequired > 0) {
        const qa =
          parseInt(
            boxTourDetail.querySelector(`[name="quantityAdult"]`)?.value || "0",
            10
          ) || 0;
        const adults18 =
          passengerState.length > 0 ? _countAdults18PlusInState() : 0;
        if (qa < minAdultsRequired || adults18 < minAdultsRequired) {
          errors.push(
            _formatPrivateMinAdultsRequiredMessage(
              minAdultsRequired,
              adults18
            )
          );
        }
      }
    }

    return {
      ok: errors.length === 0,
      message: errors.join("\n"),
      derivedMales,
      derivedFemales,
    };
  }

  /** Đọc cấu hình lưu trú "Ở ghép": 1 entry / (segment + khung) — server tự
   *  resolve danh sách candidateHotels từ TourSegment để chạy multi-hotel
   *  pooling. Client chỉ cần gửi tourSegmentId + fromDate + toDate; males /
   *  females được derive từ danh sách hành khách. */
  function collectSharedRoomRequest() {
    const items = [];
    if (!sharedSelectionWrap) return items;
    const v = validatePassengers();
    const males = v.derivedMales;
    const females = v.derivedFemales;
    sharedSelectionWrap
      .querySelectorAll(".shared-room-segment")
      .forEach((segEl) => {
        const fromDate = segEl.getAttribute("data-from-date");
        const toDate = segEl.getAttribute("data-to-date");
        const tourSegmentId = segEl.getAttribute("data-tour-segment-id");
        if (!tourSegmentId || !fromDate || !toDate) return;
        // Gửi luôn danh sách hotel ứng viên (theo thứ tự render) để admin/log
        // có ngữ cảnh; server sẽ resolve lại từ DB.
        const candidateHotels = Array.from(
          segEl.querySelectorAll(".shared-room-hotel-block__candidate")
        ).map((el) => ({
          hotelId: el.getAttribute("data-hotel-id") || "",
          hotelName: el.getAttribute("data-hotel-name") || "",
        }));
        items.push({
          tourSegmentId,
          fromDate,
          toDate,
          males,
          females,
          candidateHotels,
        });
      });
    return items;
  }

  function collectPassengers() {
    return passengerState.map((p) => ({
      idx: p.idx,
      name: (p.name || "").trim(),
      age: p.age === "" ? 0 : Math.max(0, parseInt(p.age, 10) || 0),
      type: p.type,
      gender: p.type === "adult" ? p.gender || null : null,
      guardianIdx: _passengerNeedsGuardian(p) ? p.guardianIdx : null,
      // roomGuardianIdx: chỉ áp dụng cho em bé khi ở ghép — xác định phòng KS
      roomGuardianIdx: _babyNeedsRoomGuardian(p)
        ? p.roomGuardianIdx
        : undefined,
      babySeatType: p.type === "baby" ? (p.babySeatType || null) : undefined,
    }));
  }

  // ── Ở ghép: kiểm tra NL đủ phân bổ TE/EB theo baseOccupancy ─────────────
  const SHARED_INSUFFICIENT_ADULTS_MSG =
    "Số lượng trẻ em đi cùng vượt quá khả năng phân bổ phòng ở ghép. " +
    "Với loại phòng hiện tại, mỗi phòng cần có ít nhất 1 người lớn đi kèm trẻ em. " +
    "Vui lòng bổ sung người lớn đi cùng hoặc liên hệ công ty du lịch để được hỗ trợ.";

  let sharedFeasibilityOk = true;
  let sharedFeasibilityMessage = "";
  let sharedFeasibilityTimer = null;
  let sharedFeasibilityRequestId = 0;

  const _companySlugMatch = window.location.pathname.match(
    /^\/company\/([^/]+)\/tour\//
  );
  const sharedFeasibilityCheckUrl = _companySlugMatch
    ? `/company/${_companySlugMatch[1]}/tour/check-shared-feasibility`
    : "/tour/check-shared-feasibility";

  function parseTourRoomSegmentsFromDom() {
    if (!sharedSelectionWrap) return [];
    try {
      const raw = sharedSelectionWrap.getAttribute("data-room-segments");
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function _clientWeightForAge(age, type, ageBands) {
    if (Array.isArray(ageBands) && ageBands.length > 0) {
      const band = ageBands.find((b) => {
        if (!b || b.countInOccupancy === false) return false;
        const min = Number(b.minAge) || 0;
        const max =
          b.maxAge === null || b.maxAge === undefined
            ? Infinity
            : Number(b.maxAge);
        return age >= min && age <= max;
      });
      if (band) {
        const w = Number(band.occupancyWeight);
        if (!isNaN(w)) return w;
      }
    }
    if (type === "baby") return 0;
    if (type === "child") return 0.5;
    return 1;
  }

  function _buildAtomsClient(passengers, ageBands) {
    const list = (passengers || []).map((p, i) => ({
      idx: typeof p.idx === "number" ? p.idx : i,
      name: String(p.name || "").trim(),
      age: Math.max(0, parseInt(p.age, 10) || 0),
      type: p.type === "child" || p.type === "baby" ? p.type : "adult",
      gender: p.gender === "male" || p.gender === "female" ? p.gender : null,
      guardianIdx:
        p.guardianIdx === null || p.guardianIdx === undefined
          ? null
          : parseInt(p.guardianIdx, 10),
      // Em bé: roomGuardianIdx quyết định phòng KS; fallback guardianIdx
      roomGuardianIdx:
        p.roomGuardianIdx === null || p.roomGuardianIdx === undefined
          ? null
          : parseInt(p.roomGuardianIdx, 10),
      babySeatType:
        p.babySeatType === "private" || p.babySeatType === "shared"
          ? p.babySeatType
          : undefined,
    }));
    const anchorAdults = list.filter((p) => p.type === "adult" && _isAnchorAdult18(p));
    const anchorByIdx = new Set(anchorAdults.map((a) => a.idx));
    // Cho em bé: ưu tiên roomGuardianIdx, fallback guardianIdx
    const _babyAtomAnchor = (b) =>
      b.roomGuardianIdx !== null ? b.roomGuardianIdx : b.guardianIdx;
    const atoms = anchorAdults.map((a) => {
      const members = [
        a,
        ...list.filter((p) => {
          if (p.idx === a.idx) return false;
          if (p.type === "baby") {
            // baby ghép vào atom theo roomGuardianIdx (mới) hoặc guardianIdx (cũ)
            return _babyAtomAnchor(p) === a.idx;
          }
          return p.guardianIdx === a.idx;
        }),
      ];
      const effectiveSize = members.reduce(
        (sum, m) => sum + _clientWeightForAge(m.age, m.type, ageBands),
        0
      );
      return { members, effectiveSize, adultCount: 1, anchorIdx: a.idx };
    });
    list.forEach((baby) => {
      if (baby.type !== "baby") return;
      const babyAnchor = _babyAtomAnchor(baby);
      if (babyAnchor === null || anchorByIdx.has(babyAnchor)) return;
      const atom = atoms.find((at) =>
        (at.members || []).some((m) => m.idx === babyAnchor)
      );
      if (atom && !atom.members.some((m) => m.idx === baby.idx)) {
        atom.members.push(baby);
        atom.effectiveSize = atom.members.reduce(
          (sum, m) => sum + _clientWeightForAge(m.age, m.type, ageBands),
          0
        );
      }
    });
    return atoms;
  }

  // _validateAtomsOfflineForHotel(atoms, hotels) trả lời:

  // Với mỗi atom (1 NL ≥18 + TE/EB gắn qua guardianIdx), có ít nhất một khách sạn trong danh sách mà atom đó nhét vừa một phòng theo baseOccupancy và quy tắc trọng số tuổi (ageBands) không?
  // atoms: từ _buildAtomsClient() — mỗi phần tử có members (danh sách hành khách trong nhóm).
  // hotels: khách sạn ứng viên trong một khung thời gian tour.
  // Trả về { ok: true } hoặc { ok: false, message: "..." }.
  function _validateAtomsOfflineForHotel(atoms, hotels) {
    if (!hotels || hotels.length === 0) return { ok: true };
    for (const atom of atoms) {
      const dependents = (atom.members || []).filter(
        (m) => m.type === "child" || m.type === "baby"
      );
      if (dependents.length === 0) continue;
      let fits = false;
      for (const hotel of hotels) {
        // lấy baseOccupancy của từng phòng
        // sau đó lấy max của các baseOccupancy
        const caps = (hotel.roomTypes || [])
          .map((rt) => Math.max(1, parseInt(rt.baseOccupancy, 10) || 2))
          .filter((c) => c > 0);
        if (!caps.length) continue;
        const maxCap = Math.max(...caps);
        const ageBands = hotel.ageBands || [];
        // tính tổng trọng số tuổi của các thành viên trong atom
        const size = (atom.members || []).reduce(
          (sum, m) => sum + _clientWeightForAge(m.age, m.type, ageBands),
          0
        );
        const remaining = Math.max(0, maxCap - 1); // số slot occupancy tối đa cho TE/EB trong 1 phòng (sau khi trừ 1 NL) theo baseOccupancy và ageBands
        let minChildW = 0.5;  // mặc định nếu KS chưa cấu hình ageBands
        const weights = (ageBands || [])
          .filter((b) => b && b.countInOccupancy !== false)
          .map((b) => Number(b.occupancyWeight))
          .filter((w) => !isNaN(w) && w > 0);
        if (weights.length) minChildW = Math.min(...weights);
        const maxDepSlots = Math.floor(remaining / minChildW);

        // size <= maxCap: tổng trọng số tuổi của các thành viên trong atom không vượt quá sức chứa phòng
        // dependents.length <= maxDepSlots: số lượng TE/EB trong atom không vượt quá số slot occupancy tối đa cho TE/EB trong 1 phòng

        // “Cả nhóm (NL + mọi TE/EB) chiếm bao nhiêu chỗ quy đổi — có vượt sức chứa phòng không?”
        //“Số TE/EB (đếm người) có vượt quá số slot còn lại sau khi trừ 1 NL không?”
        if (size <= maxCap && dependents.length <= maxDepSlots) {
          fits = true;
          break;
        }
      }
      if (!fits) {
        return { ok: false, message: SHARED_INSUFFICIENT_ADULTS_MSG };
      }
    }
    return { ok: true };
  }

  function collectSharedFeasibilityFrames() {
    const frames = [];
    if (!sharedSelectionWrap) return frames;
    sharedSelectionWrap
      .querySelectorAll(".shared-room-segment")
      .forEach((segEl) => {
        const tourSegmentId = segEl.getAttribute("data-tour-segment-id");
        const fromDate = segEl.getAttribute("data-from-date");
        const toDate = segEl.getAttribute("data-to-date");
        if (!tourSegmentId || !fromDate || !toDate) return;
        const candidateHotels = Array.from(
          segEl.querySelectorAll(".shared-room-hotel-block__candidate")
        ).map((el) => ({
          hotelId: el.getAttribute("data-hotel-id") || "",
          hotelName: el.getAttribute("data-hotel-name") || "",
        }));
        frames.push({
          tourSegmentId,
          fromDate,
          toDate,
          candidateHotels,
        });
      });
    return frames;
  }

  function applySharedFeasibilityUI() {
    if (!sharedFeasibilityWarning) return;
    const mode = getAccommodationMode();
    if (mode !== "shared" || sharedFeasibilityOk || !sharedFeasibilityMessage) {
      sharedFeasibilityWarning.style.display = "none";
      sharedFeasibilityWarning.textContent = "";
      return;
    }
    sharedFeasibilityWarning.textContent = sharedFeasibilityMessage;
    sharedFeasibilityWarning.style.display = "";
  }

  // Kiểm tra xem đoàn hiện tại có xếp được vào phòng ghép không
  // Dựa trên danh sách hành khách, cách gom atom, sức chứa phòng
  function offlineCheckSharedFeasibility() {
    const segments = parseTourRoomSegmentsFromDom();
    if (!segments.length) {
      sharedFeasibilityOk = true;
      sharedFeasibilityMessage = "";
      return;
    }
    const passengers = collectPassengers();
    const adults = passengers.filter((p) => p.type === "adult");
    if (adults.length === 0) {
      sharedFeasibilityOk = true;
      sharedFeasibilityMessage = "";
      return;
    }
    for (const seg of segments) {
      const hotels = seg.hotels || [];
      if (!hotels.length) continue;
      const atoms = _buildAtomsClient(passengers, hotels[0].ageBands || []);
      const check = _validateAtomsOfflineForHotel(atoms, hotels);
      if (!check.ok) {
        sharedFeasibilityOk = false;
        sharedFeasibilityMessage = check.message;
        return;
      }
    }
    sharedFeasibilityOk = true;
    sharedFeasibilityMessage = "";
  }

  async function remoteCheckSharedFeasibility() {
    const reqId = ++sharedFeasibilityRequestId;
    const frames = collectSharedFeasibilityFrames();
    const passengers = collectPassengers();
    if (!frames.length || !passengers.length) {
      if (reqId === sharedFeasibilityRequestId) {
        sharedFeasibilityOk = true;
        sharedFeasibilityMessage = "";
        applySharedFeasibilityUI();
      }
      return;
    }
    const v = validatePassengers();
    if (!v.ok) return;

    try {
      const res = await fetch(sharedFeasibilityCheckUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passengers, frames }),
      });
      const data = await res.json().catch(() => ({}));
      if (reqId !== sharedFeasibilityRequestId) return;
      if (data.ok === true || data.code === "success") {
        sharedFeasibilityOk = true;
        sharedFeasibilityMessage = "";
      } else {
        sharedFeasibilityOk = false;
        sharedFeasibilityMessage =
          data.message || SHARED_INSUFFICIENT_ADULTS_MSG;
      }
    } catch (e) {
      if (reqId !== sharedFeasibilityRequestId) return;
      // Giữ kết quả offline nếu API lỗi
    }
    applySharedFeasibilityUI();
  }

  function scheduleSharedFeasibilityCheck() {
    if (getAccommodationMode() !== "shared") {
      sharedFeasibilityOk = true;
      sharedFeasibilityMessage = "";
      applySharedFeasibilityUI();
      return;
    }
    offlineCheckSharedFeasibility();
    applySharedFeasibilityUI();
    if (sharedFeasibilityTimer) clearTimeout(sharedFeasibilityTimer);
    sharedFeasibilityTimer = setTimeout(() => {
      remoteCheckSharedFeasibility();
    }, 400);
  }

  // ── Private room assignment ─────────────────────────────────────────────
  // Render UI gán hành khách vào từng phòng vật lý (mode = "Ở riêng").

  function _passengerLabel(p) {
    const typeShort = p.type === "adult" ? "NL" : p.type === "child" ? "TE" : "EB";
    const baseName =
      p.name && p.name.trim() ? p.name.trim() : "Hành khách #" + (p.idx + 1);
    const ageTxt = p.age === "" || p.age === null || p.age === undefined
      ? "—"
      : String(p.age) + "t";
    const genderTxt = p.type === "adult"
      ? p.gender === "male" ? " · Nam" : p.gender === "female" ? " · Nữ" : ""
      : "";
    return baseName + " (" + typeShort + " · " + ageTxt + genderTxt + ")";
  }

  function _findHotelInSegment(segObj, hotelId) {
    if (!segObj) return null;
    return (segObj.hotels || []).find((h) => String(h.hotelId) === String(hotelId)) || null;
  }

  /**
   * Tính sức chứa quy đổi của 1 phòng (theo ageBands của hotel sở hữu phòng).
   * Em bé thường occupancyWeight=0 → không tính.
   */
  function _computeRoomUsedCapacity(passengerIdxs, ageBands) {
    let total = 0;
    passengerIdxs.forEach((idx) => {
      const p = passengerState.find((x) => x.idx === idx);
      if (!p) return;
      const ageNum = p.age === "" ? 0 : parseInt(p.age, 10) || 0;
      total += getOccupancyWeight(ageNum, ageBands);
    });
    return total;
  }

  /**
   * Đọc tất cả selections (phòng đã chọn) trong DOM, gom theo segment.
   * Trả về: [{ segKey, fromDate, toDate, segObj, hotels: [
   *   { hotelId, hotelName, tourSegmentId, ageBands, roomTypes: [
   *     { roomTypeId, roomTypeName, baseOccupancy, selectedRooms, pricePerNight }
   *   ] }
   * ] }]
   */
  function _readPrivateSelectionsBySegment() {
    const result = [];
    if (!roomSelectionWrap) return result;
    roomSelectionWrap.querySelectorAll(".room-time-segment").forEach((segEl) => {
      const fromDate = segEl.getAttribute("data-from-date");
      const toDate = segEl.getAttribute("data-to-date");
      const segObj = getSegmentDataByKey(fromDate, toDate);
      const segLabel =
        segEl.querySelector(".room-time-segment__label")?.textContent?.trim() ||
        fromDate + " → " + toDate;
      const hotels = [];
      segEl.querySelectorAll(".room-hotel-block").forEach((hBlock) => {
        const hotelId = hBlock.getAttribute("data-hotel-id");
        const hotelName =
          hBlock.querySelector(".room-hotel-block__name")?.textContent?.trim() || "";
        const tourSegmentId = hBlock.getAttribute("data-tour-segment-id");
        const hotelMeta = _findHotelInSegment(segObj, hotelId);
        const ageBands = hotelMeta ? hotelMeta.ageBands || [] : [];
        const roomTypes = [];
        hBlock.querySelectorAll(".room-type-row").forEach((row) => {
          const qty = Math.max(
            0,
            parseInt(row.querySelector(".room-qty-input")?.value || "0", 10)
          );
          if (qty <= 0) return;
          roomTypes.push({
            roomTypeId: row.getAttribute("data-room-type-id"),
            roomTypeName:
              row.querySelector(".room-type-row__name")?.textContent?.trim() || "",
            baseOccupancy: parseInt(
              row.getAttribute("data-base-occupancy") || "2",
              10
            ),
            pricePerNight: parseFloat(
              row.getAttribute("data-price-per-night") || "0"
            ),
            selectedRooms: qty,
          });
        });
        if (roomTypes.length > 0) {
          hotels.push({
            hotelId,
            hotelName,
            tourSegmentId,
            ageBands,
            roomTypes,
          });
        }
      });
      result.push({
        segKey: fromDate + "|" + toDate,
        fromDate,
        toDate,
        segLabel,
        segObj,
        hotels,
      });
    });
    return result;
  }

  /**
   * Dọn state: bỏ những entry không còn ứng với phòng nào, và những idx
   * hành khách đã không còn trong passengerState.
   */
  function _gcPrivateAssignmentState(segments) {
    const validKeys = new Set();
    const validIdxs = new Set(passengerState.map((p) => p.idx));
    segments.forEach((seg) => {
      seg.hotels.forEach((h) => {
        h.roomTypes.forEach((rt) => {
          for (let i = 0; i < rt.selectedRooms; i++) {
            validKeys.add(
              _privateAssignKey(seg.fromDate, seg.toDate, h.hotelId, rt.roomTypeId, i)
            );
          }
        });
      });
    });
    Array.from(privateAssignmentState.keys()).forEach((k) => {
      if (!validKeys.has(k)) {
        privateAssignmentState.delete(k);
        return;
      }
      const set = privateAssignmentState.get(k);
      Array.from(set).forEach((idx) => {
        if (!validIdxs.has(idx)) set.delete(idx);
      });
    });
  }

  function _renderPrivateAssignRoom({
    fromDate,
    toDate,
    hotel,
    rt,
    roomIndex,
    roomNumberDisplay,
    assignedSetForSegment,
  }) {
    const key = _privateAssignKey(fromDate, toDate, hotel.hotelId, rt.roomTypeId, roomIndex);
    const set = _getAssignSet(key);

    const wrap = document.createElement("div");
    wrap.className = "private-assign-room";
    wrap.setAttribute("data-room-key", key);
    wrap.setAttribute("data-base-occupancy", String(rt.baseOccupancy));

    const header = document.createElement("div");
    header.className = "private-assign-room__header";
    const title = document.createElement("span");
    title.className = "private-assign-room__title";
    title.innerHTML =
      '<i class="fa-solid fa-bed" style="margin-right:6px;color:#0071c2"></i>' +
      "Phòng " + rt.roomTypeName + " #" + roomNumberDisplay +
      " · sức chứa " + rt.baseOccupancy;
    header.appendChild(title);

    const hotelTag = document.createElement("span");
    hotelTag.className = "private-assign-room__hotel";
    hotelTag.textContent = "(" + hotel.hotelName + ")";
    header.appendChild(hotelTag);

    const usage = document.createElement("span");
    usage.className = "private-assign-room__usage";
    usage.setAttribute("data-room-key", key);
    header.appendChild(usage);

    wrap.appendChild(header);

    const list = document.createElement("div");
    list.className = "private-assign-room__passengers";
    passengerState.forEach((p) => {
      const lbl = document.createElement("label");
      lbl.className = "private-assign-passenger";
      lbl.setAttribute("data-passenger-idx", String(p.idx));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = String(p.idx);
      cb.checked = set.has(p.idx);
      // Disable nếu hành khách đã được gán vào phòng khác trong cùng segment.
      const inOther =
        assignedSetForSegment.has(p.idx) && !set.has(p.idx);
      if (inOther) {
        cb.disabled = true;
        lbl.classList.add("is-disabled");
        lbl.title = "Đã gán cho phòng khác trong khung này.";
      }
      
      cb.addEventListener("change", () => {
        if (cb.checked) set.add(p.idx);
        else set.delete(p.idx);
        // Cần re-render lại toàn bộ private-assign vì checkbox của các phòng
        // khác trong cùng segment cũng phải cập nhật disabled state.
        renderPrivateAssignments();
        updateRoomValidation();
      });
      lbl.appendChild(cb);
      const txt = document.createElement("span");
      txt.textContent = " " + _passengerLabel(p);
      lbl.appendChild(txt);
      if (cb.checked) lbl.classList.add("is-checked");
      list.appendChild(lbl);
    });
    wrap.appendChild(list);

    return { roomEl: wrap, key, set };
  }

  function renderPrivateAssignments() {
    if (!privateAssignmentSegmentsEl) return;
    const segments = _readPrivateSelectionsBySegment();
    _gcPrivateAssignmentState(segments);

    privateAssignmentSegmentsEl.innerHTML = "";

    if (passengerState.length === 0 || segments.every((s) => s.hotels.length === 0)) {
      // Không có hành khách hoặc chưa chọn phòng → ẩn block.
      if (privateAssignmentWrap) privateAssignmentWrap.style.display = "none";
      return;
    }
    if (privateAssignmentWrap) privateAssignmentWrap.style.display = "";

    segments.forEach((seg) => {
      if (seg.hotels.length === 0) return;
      const segWrap = document.createElement("div");
      segWrap.className = "private-assign-segment";
      segWrap.setAttribute("data-from-date", seg.fromDate);
      segWrap.setAttribute("data-to-date", seg.toDate);

      const segHeader = document.createElement("div");
      segHeader.className = "private-assign-segment__header";
      segHeader.innerHTML =
        '<i class="fa-solid fa-calendar-days" style="color:#6366f1"></i><span>' +
        seg.segLabel +
        "</span>";
      segWrap.appendChild(segHeader);

      const roomsWrap = document.createElement("div");
      roomsWrap.className = "private-assign-segment__rooms";

      // Pre-compute: tập idx hành khách đã được gán đâu đó trong cùng segment.
      const assignedSetForSegment = new Set();
      seg.hotels.forEach((h) => {
        h.roomTypes.forEach((rt) => {
          for (let i = 0; i < rt.selectedRooms; i++) {
            const k = _privateAssignKey(seg.fromDate, seg.toDate, h.hotelId, rt.roomTypeId, i);
            const s = privateAssignmentState.get(k);
            if (!s) continue;
            s.forEach((idx) => assignedSetForSegment.add(idx));
          }
        });
      });

      // Đánh số phòng liên tục trong cùng segment để dễ đọc.
      let roomNumber = 0;
      seg.hotels.forEach((hotel) => {
        hotel.roomTypes.forEach((rt) => {
          for (let i = 0; i < rt.selectedRooms; i++) {
            roomNumber++;
            const { roomEl } = _renderPrivateAssignRoom({
              fromDate: seg.fromDate,
              toDate: seg.toDate,
              hotel,
              rt,
              roomIndex: i,
              roomNumberDisplay: roomNumber,
              assignedSetForSegment,
            });
            roomsWrap.appendChild(roomEl);
          }
        });
      });

      segWrap.appendChild(roomsWrap);
      privateAssignmentSegmentsEl.appendChild(segWrap);
    });
  }

  /**
   * Validate phân bổ phòng "Ở riêng" cho từng segment:
   * - Không trùng idx giữa các phòng trong cùng segment.
   * - Σ adult+child gán = quantityAdult + quantityChildren.
   * - Σ occupancyWeight ≤ baseOccupancy mỗi phòng (theo ageBands của hotel).
   * - Mỗi phòng có khách phải có ≥ 1 người lớn từ 18 tuổi trở lên.
   * Trả về { ok, message?, perRoom: Map<key, {used, base, overflow}> }.
   */
  function validatePrivateAssignments() {
    const errors = [];
    const perRoom = new Map();
    if (!privateAssignmentWrap || privateAssignmentWrap.style.display === "none") {
      return { ok: true, message: "", perRoom };
    }

    const reqAdults = parseInt(
      boxTourDetail.querySelector(`[name="quantityAdult"]`)?.value || "0",
      10
    ) || 0;
    const reqChildren = parseInt(
      boxTourDetail.querySelector(`[name="quantityChildren"]`)?.value || "0",
      10
    ) || 0;
    const reqBabies = parseInt(
      boxTourDetail.querySelector(`[name="quantityBaby"]`)?.value || "0",
      10
    ) || 0;

    const segments = _readPrivateSelectionsBySegment();
    segments.forEach((seg) => {
      if (seg.hotels.length === 0) return;
      const segLabel = seg.segLabel;
      const idxToRoomKey = new Map();
      const assignedAdults   = new Set();
      const assignedChildren = new Set();
      const assignedBabies   = new Set();

      seg.hotels.forEach((hotel) => {
        hotel.roomTypes.forEach((rt) => {
          for (let i = 0; i < rt.selectedRooms; i++) {
            const key = _privateAssignKey(seg.fromDate, seg.toDate, hotel.hotelId, rt.roomTypeId, i);
            const set = privateAssignmentState.get(key) || new Set();
            const idxs = Array.from(set);
            const used = _computeRoomUsedCapacity(idxs, hotel.ageBands);
            const overflow = used > rt.baseOccupancy + 1e-9;
            perRoom.set(key, { used, base: rt.baseOccupancy, overflow });
            if (overflow) {
              errors.push(
                segLabel + " · Phòng " + rt.roomTypeName +
                  " (" + hotel.hotelName + "): vượt sức chứa (" +
                  fmtOccNum(used) + " / " + rt.baseOccupancy + ")."
              );
            }
            // Mỗi phòng phải có ít nhất 1 người lớn từ 18 tuổi trở lên
            if (idxs.length > 0) {
              const roomNum = i + 1;
              const roomLabel =
                segLabel + " · Phòng " + rt.roomTypeName + " #" + roomNum +
                " (" + hotel.hotelName + ")";
              const adultsInRoom = idxs
                .map((idx) => passengerState.find((x) => x.idx === idx))
                .filter((p) => p && p.type === "adult");
              const hasAdult18Plus = adultsInRoom.some((p) => {
                const ageNum =
                  p.age === "" || p.age === null || p.age === undefined
                    ? NaN
                    : parseInt(p.age, 10);
                return !isNaN(ageNum) && ageNum >= privateRoomAdultMinAge;
              });
              if (!hasAdult18Plus) {
                errors.push(
                  roomLabel +
                    ": phòng phải có ít nhất 1 người lớn từ " +
                    privateRoomAdultMinAge +
                    " tuổi trở lên."
                );
              }
            }
            idxs.forEach((idx) => {
              const p = passengerState.find((x) => x.idx === idx);
              if (!p) return;
              if (idxToRoomKey.has(idx)) {
                errors.push(
                  segLabel + " · " + _passengerLabel(p) +
                    " bị gán vào nhiều phòng cùng khung."
                );
              } else {
                idxToRoomKey.set(idx, key);
              }
              if (p.type === "adult")       assignedAdults.add(idx);
              else if (p.type === "child")  assignedChildren.add(idx);
              else if (p.type === "baby")   assignedBabies.add(idx);
            });
          }
        });
      });

      // Kiểm tra đủ từng loại hành khách
      const missingParts = [];
      if (assignedAdults.size < reqAdults)
        missingParts.push(
          "người lớn: " + assignedAdults.size + "/" + reqAdults
        );
      if (assignedChildren.size < reqChildren)
        missingParts.push(
          "trẻ em: " + assignedChildren.size + "/" + reqChildren
        );
      if (assignedBabies.size < reqBabies)
        missingParts.push(
          "em bé: " + assignedBabies.size + "/" + reqBabies
        );
      if (missingParts.length > 0) {
        errors.push(
          segLabel + ": chưa gán đủ hành khách (" + missingParts.join(", ") + ")."
        );
      }

      // Ở riêng (private) không có guardian — bỏ qua kiểm tra này.
    });

    return {
      ok: errors.length === 0,
      message: errors.join("\n"),
      perRoom,
    };
  }

  /**
   * Gắn roomAssignments vào từng phần tử roomSelections (private mode).
   * Sắp xếp roomAssignments theo roomIndex để ổn định.
   */
  function decorateRoomSelectionsWithAssignments(selections) {
    return selections.map((s) => {
      const roomAssignments = [];
      for (let i = 0; i < s.selectedRooms; i++) {
        const key = _privateAssignKey(
          s.fromDate,
          s.toDate,
          s.hotelId,
          s.roomTypeId,
          i
        );
        const set = privateAssignmentState.get(key) || new Set();
        const idxs = Array.from(set).sort((a, b) => a - b);
        const segObj = getSegmentDataByKey(s.fromDate, s.toDate);
        const hotelMeta = _findHotelInSegment(segObj, s.hotelId);
        const ageBands = hotelMeta ? hotelMeta.ageBands || [] : [];
        const usedCapacity = _computeRoomUsedCapacity(idxs, ageBands);
        roomAssignments.push({
          roomIndex: i,
          passengerIdxs: idxs,
          usedCapacity: Math.round(usedCapacity * 100) / 100,
        });
      }

      return { ...s, roomAssignments };// gộp khách hàng và phòng
    });
  }

  /**
   * Trả về cấu hình lưu trú đầy đủ để gửi lên server. Tuỳ mode mà fill
   * roomSelections hoặc sharedRoomRequest + passengers; field còn lại để rỗng.
   */
  function collectAccommodationConfig() {
    const accommodationMode = getAccommodationMode();
    if (accommodationMode === "shared") {
      return {
        accommodationMode,
        roomSelections: [],
        sharedRoomRequest: collectSharedRoomRequest(),
        passengers: collectPassengers(),
      };
    }
    const baseSelections = collectRoomSelections();
    return {
      accommodationMode: "private",
      roomSelections: decorateRoomSelectionsWithAssignments(baseSelections), // Nối 2 bước khách và phòng vào nhau
      sharedRoomRequest: [],
      passengers: collectPassengers(),
    };
  }

  const globalExtraWarn = boxTourDetail.querySelector(".room-selection-global-extra-warning");

  /**
   * Mode "Ở riêng": tính FULL tiền phòng `pricePerNight × nights × selectedRooms`
   * cộng vào tour. Đồng thời gom theo (segment, hotel, roomType) cho phần
   * cảnh báo "Chi tiết phòng & phụ phí" để khách thấy rõ tổng.
   */
  function computePrivateRoomCost() {
    if (!roomSelectionWrap) return { total: 0, lines: [] };
    let total = 0;
    const lines = [];
    roomSelectionWrap
      .querySelectorAll(".room-time-segment")
      .forEach((segEl) => {
        const fromDate = segEl.getAttribute("data-from-date");
        const toDate = segEl.getAttribute("data-to-date");
        let nights = 1;
        if (fromDate && toDate) {
          nights = Math.max(
            1,
            Math.round((new Date(toDate) - new Date(fromDate)) / 86400000)
          );
        }
        const segLabel =
          segEl.querySelector(".room-time-segment__label")?.textContent?.trim() ||
          fromDate + " → " + toDate;
        const segLineDetails = [];
        let segCost = 0;
        segEl.querySelectorAll(".room-type-row").forEach((row) => {
          const qty = Math.max(
            0,
            parseInt(row.querySelector(".room-qty-input")?.value || "0", 10)
          );
          if (qty <= 0) return;
          const pricePerNight = parseFloat(
            row.getAttribute("data-price-per-night") || "0"
          );
          const cost = pricePerNight * nights * qty;
          if (cost > 0) {
            const roomTypeName =
              row.querySelector(".room-type-row__name")?.textContent?.trim() ||
              "";
            const hotelBlock = row.closest(".room-hotel-block");
            const hotelName =
              hotelBlock?.querySelector(".room-hotel-block__name")?.textContent?.trim() ||
              "";
            segLineDetails.push({
              hotelName,
              roomTypeName,
              pricePerNight,
              qty,
              nights,
              cost,
            });
            segCost += cost;
            total += cost;
          }
        });
        if (segLineDetails.length > 0) {
          lines.push({ segLabel, details: segLineDetails, segCost });
        }
      });
    return { total, lines };
  }

  function updateRoomValidation() {
    currentExtraRoomCost = 0;
    let anyRoomCapacityShortfall = false;
    const mode = getAccommodationMode();

    // Toggle hiển thị các vùng theo mode hiện tại.
    // Đoạn code hiển thị chọn mode ở riêng và ở ghép
    if (roomSelectionWrap) {
      roomSelectionWrap.style.display = mode === "private" ? "" : "none";
    }
    if (sharedSelectionWrap) {
      sharedSelectionWrap.style.display = mode === "shared" ? "" : "none";
    }
    // Passenger list dùng chung cho cả 2 mode — chỉ hiện khi có hành khách.
    if (passengerListWrap) {
      const totalPax = passengerState.length;
      passengerListWrap.style.display = totalPax > 0 ? "" : "none";
    }

    // Cập nhật class is-selected cho radio (UI feedback).
    if (modePicker) {
      modePicker.querySelectorAll(".accommodation-mode-option").forEach((el) => {
        const inp = el.querySelector('input[type="radio"]');
        if (inp && inp.checked) el.classList.add("is-selected");
        else el.classList.remove("is-selected");
      });
    }

    // ── Mode "Private": hiển thị occupancy + tổng tiền phòng (full) ──
    if (roomSelectionWrap) {
      roomSelectionWrap.querySelectorAll(".room-time-segment").forEach((segEl) => {
        const m = getSegmentOccupancyAndSelections(segEl);
        const { totalOcc, detail, segTotalCap } = m;
        if (mode === "private" && totalOcc > segTotalCap)
          anyRoomCapacityShortfall = true;

        const valEl = segEl.querySelector(".room-time-segment__occupancy-live-value");
        const detEl = segEl.querySelector(".room-time-segment__occupancy-live-detail");
        if (valEl) valEl.textContent = fmtOccNum(totalOcc);
        if (detEl) detEl.textContent = detail;

        const capWarn = segEl.querySelector(".room-segment-capacity-warning");
        if (capWarn) {
          if (mode === "private" && totalOcc > segTotalCap) {
            capWarn.textContent = "Khung này chưa đủ phòng cho đoàn.";
            capWarn.style.display = "";
          } else {
            capWarn.style.display = "none";
          }
        }
        const extraWarn = segEl.querySelector(".room-segment-extra-warning");
        if (extraWarn) extraWarn.style.display = "none";
      });
    }

    // Tính tổng tiền phòng theo mode.
    let privateLines = [];

    // Ở riêng - tính tiền phòng cộng vào tour
    if (mode === "private") {
      const cost = computePrivateRoomCost();
      currentExtraRoomCost = cost.total;
      privateLines = cost.lines;
    } else {
      currentExtraRoomCost = 0;
    }

    // Cảnh báo bắt buộc đủ phòng (chỉ áp cho mode "private").
    if (requiredWarning) {
      requiredWarning.style.display =
        mode === "private" && isRoomRequired && anyRoomCapacityShortfall ? "" : "none";
    }

    const minAdultsRequired =
      mode === "private" ? getPrivateMinAdultsRequired() : 0;
    const qaInput = boxTourDetail.querySelector(`[name="quantityAdult"]`);
    if (qaInput && mode === "private" && minAdultsRequired > 0) {
      qaInput.min = String(minAdultsRequired);
    } else if (qaInput) {
      qaInput.min = "0";
    }
    let privateMinAdultsWarnText = "";
    if (mode === "private" && minAdultsRequired > 0) {
      const qaNow = parseInt(qaInput?.value || "0", 10) || 0;
      const adults18 =
        passengerState.length > 0 ? _countAdults18PlusInState() : 0;
      if (qaNow < minAdultsRequired || adults18 < minAdultsRequired) {
        privateMinAdultsWarnText = _formatPrivateMinAdultsRequiredMessage(
          minAdultsRequired,
          adults18
        );
      }
    }
    if (privateMinAdultsWarning) {
      if (privateMinAdultsWarnText) {
        privateMinAdultsWarning.textContent = privateMinAdultsWarnText;
        privateMinAdultsWarning.style.display = "";
      } else {
        privateMinAdultsWarning.style.display = "none";
        privateMinAdultsWarning.textContent = "";
      }
    }

    // ── Validate passengers (dùng chung cho cả 2 mode) ─────────────────────
    let anySharedMismatch = false;
    let passengerWarnText = "";
    const adults =
      parseInt(
        boxTourDetail.querySelector(`[name="quantityAdult"]`)?.value || "0",
        10
      ) || 0;
    const passengerCheck =
      passengerState.length > 0 ? validatePassengers() : null;
    if (passengerCheck && !passengerCheck.ok) {
      passengerWarnText = passengerCheck.message;
    }

    // ── Mode "Shared": sync số nam/nữ vào tóm tắt ──
    if (sharedSelectionWrap) {
      const males = passengerCheck ? passengerCheck.derivedMales : 0;
      const females = passengerCheck ? passengerCheck.derivedFemales : 0;
      sharedSelectionWrap
        .querySelectorAll(".shared-room-hotel-block")
        .forEach((hBlock) => {
          const expected = hBlock.querySelector(
            ".shared-room-hotel-block__expected"
          );
          if (expected) expected.textContent = String(adults);
          const maleDisp = hBlock.querySelector(".shared-male-display");
          const femaleDisp = hBlock.querySelector(".shared-female-display");
          if (maleDisp) maleDisp.textContent = String(males);
          if (femaleDisp) femaleDisp.textContent = String(females);
          const maleHidden = hBlock.querySelector(".shared-male-input");
          const femaleHidden = hBlock.querySelector(".shared-female-input");
          if (maleHidden) maleHidden.value = String(males);
          if (femaleHidden) femaleHidden.value = String(females);
          const hint = hBlock.querySelector(".shared-room-hotel-block__hint");
          if (hint) {
            if (mode === "shared" && males + females !== adults) {
              hint.classList.add("is-mismatch");
              anySharedMismatch = true;
            } else {
              hint.classList.remove("is-mismatch");
            }
          }
        });
    }
    if (sharedRequiredWarning) {
      sharedRequiredWarning.style.display =
        mode === "shared" && isRoomRequired && anySharedMismatch ? "" : "none";
    }
    if (mode === "shared" && passengerState.length > 0) {
      scheduleSharedFeasibilityCheck();
    } else {
      sharedFeasibilityOk = true;
      sharedFeasibilityMessage = "";
      applySharedFeasibilityUI();
    }
    if (passengerWarning) {
      if (passengerWarnText) {
        passengerWarning.textContent = passengerWarnText;
        passengerWarning.style.display = "";
      } else {
        passengerWarning.style.display = "none";
        passengerWarning.textContent = "";
      }
    }

    // ── Mode "Private": render block phân bổ phòng + validate ──
    if (mode === "private") {
      renderPrivateAssignments();
      const v = validatePrivateAssignments();
      // Cập nhật usage indicator trên từng phòng vật lý.
      v.perRoom.forEach((info, key) => {
        const usageEl =
          privateAssignmentSegmentsEl?.querySelector(
            `.private-assign-room__usage[data-room-key="${CSS.escape(key)}"]`
          );
        if (!usageEl) return;
        usageEl.textContent =
          "Sức chứa quy đổi: " + fmtOccNum(info.used) + " / " + info.base;
        usageEl.classList.toggle("is-overflow", !!info.overflow);
      });
      // Cập nhật class is-checked cho các checkbox đã chọn (UI feedback).
      privateAssignmentSegmentsEl
        ?.querySelectorAll(".private-assign-passenger")
        .forEach((lbl) => {
          const cb = lbl.querySelector("input[type=checkbox]");
          lbl.classList.toggle("is-checked", !!cb && cb.checked);
        });
      if (privateAssignmentWarning) {
        if (
          !v.ok &&
          privateAssignmentWrap &&
          privateAssignmentWrap.style.display !== "none"
        ) {
          privateAssignmentWarning.textContent = v.message;
          privateAssignmentWarning.style.display = "";
        } else {
          privateAssignmentWarning.style.display = "none";
          privateAssignmentWarning.textContent = "";
        }
      }
    } else {
      if (privateAssignmentWrap) privateAssignmentWrap.style.display = "none";
      if (privateAssignmentWarning) {
        privateAssignmentWarning.style.display = "none";
        privateAssignmentWarning.textContent = "";
      }
    }

    // -- Hiển thị block "Chi phí phòng cộng vào tour" (private only) --
    if (globalExtraWarn) {
      if (mode === "private" && privateLines.length > 0 && currentExtraRoomCost > 0) {
        let html =
          '<div style="font-weight:600;color:#1e293b;margin-bottom:6px">' +
          '<i class="fa-solid fa-bed" style="color:#0071c2;margin-right:6px"></i>' +
          "Chi phí phòng (cộng vào tour, hình thức ở riêng)</div>";
        privateLines.forEach((seg) => {
          html +=
            '<div style="margin-bottom:6px"><span style="font-size:12px;color:#6b7280">' +
            seg.segLabel +
            "</span><br>";
          seg.details.forEach((d) => {
            html +=
              "• <strong>" +
              d.roomTypeName +
              "</strong> tại " +
              d.hotelName +
              ": " +
              d.qty +
              " phòng × " +
              d.pricePerNight.toLocaleString("vi-VN") +
              "đ/đêm × " +
              d.nights +
              " đêm = <strong>" +
              d.cost.toLocaleString("vi-VN") +
              "đ</strong><br>";
          });
          html +=
            "Chi phí phòng khung này: <strong>" +
            seg.segCost.toLocaleString("vi-VN") +
            "đ</strong></div>";
        });
        if (privateLines.length > 1) {
          html +=
            '<div style="border-top:1px solid #fde68a;margin-top:4px;padding-top:6px">Tổng chi phí phòng: <strong>' +
            currentExtraRoomCost.toLocaleString("vi-VN") +
            "đ</strong></div>";
        }
        globalExtraWarn.innerHTML = html;
        globalExtraWarn.style.display = "";
      } else {
        globalExtraWarn.style.display = "none";
        globalExtraWarn.innerHTML = "";
      }
    }

    drawBoxDetail();
  }

  if (roomSelectionWrap) {
    roomSelectionWrap.addEventListener("input", (e) => {
      const inp = e.target;
      if (inp.classList.contains("room-qty-input")) {
        const max = parseInt(inp.getAttribute("max") || "999", 10);
        let val = Math.max(0, parseInt(inp.value || "0", 10));
        if (isNaN(val)) val = 0;
        if (val > max) { val = max; inp.value = max; }
        else if (inp.value !== String(val)) inp.value = val;
      }
      updateRoomValidation();
    });
    boxTourDetail.querySelectorAll("[input-quantity]").forEach((inp) => {
      inp.addEventListener("input", updateRoomValidation);
    });
    if (childrenAgesList) {
      childrenAgesList.addEventListener("input", () => {
        renderPassengerRows();
        updateRoomValidation();
      });
    }
    if (babiesAgesList) {
      babiesAgesList.addEventListener("input", () => {
        renderPassengerRows();
        updateRoomValidation();
      });
    }
    updateRoomValidation();
  }

  if (modePicker) {
    modePicker.addEventListener("change", (e) => {
      if (
        e.target &&
        e.target.matches('input[name="accommodationMode"]')
      ) {
        // Khi chuyển sang "ở riêng", xóa guardianIdx khỏi state vì không dùng.
        if (e.target.value === "private") {
          passengerState.forEach((p) => {
            p.guardianIdx = null;
          });
        }
        renderPassengerRows();
        updateRoomValidation();
      }
    });
  }

  // Re-render passenger rows khi user thay đổi số người lớn / trẻ em / em bé.
  ["quantityAdult", "quantityChildren", "quantityBaby"].forEach((nm) => {
    const el = boxTourDetail.querySelector(`[name="${nm}"]`);
    if (!el) return;
    el.addEventListener("input", () => {
      renderPassengerRows();
      updateRoomValidation();
    });
  });

  // Render lần đầu (cả private + shared đều cần passenger list).
  renderPassengerRows();
  updateRoomValidation();

  // === ĐẶT NGAY (không còn locationFrom) ===
  const buttonAddToCart = boxTourDetail.querySelector(".inner-button-add-cart");
  if (buttonAddToCart) {
    const tourId = buttonAddToCart.getAttribute("tour-id");

    buttonAddToCart.addEventListener("click", () => {
      const departureSelect = boxTourDetail.querySelector(
        "#departureDateSelect"
      );

      const qaEl = boxTourDetail.querySelector(`[name="quantityAdult"]`);
      const qcEl = boxTourDetail.querySelector(`[name="quantityChildren"]`);
      const qbEl = boxTourDetail.querySelector(`[name="quantityBaby"]`);

      const quantityAdult = parseInt(qaEl?.value || "0", 10) || 0;
      const quantityChild = parseInt(qcEl?.value || "0", 10) || 0;
      const quantityBaby = parseInt(qbEl?.value || "0", 10) || 0;

      let departureDateDisplay = "";
      if (departureSelect) {
        const hasMultiple =
          departureSelect.getAttribute("data-has-multiple") === "1";
        departureDateDisplay = departureSelect.value || "";

        if (!departureDateDisplay) {
          if (
            hasMultiple &&
            departureSelect.querySelectorAll("option").length > 1
          ) {
            notify?.error?.("Vui lòng chọn ngày khởi hành");
            return;
          }
        }
      }

      if (quantityAdult < 1) {
        notify?.error?.("Tour phải có ít nhất 1 người lớn.");
        qaEl?.focus();
        return;
      }

      if (quantityAdult > 0 || quantityChild > 0 || quantityBaby > 0) {
        const childrenAges = collectAges(childrenAgesList);
        const babyAges     = collectAges(babiesAgesList);

        const accCfg = collectAccommodationConfig();

        // Validate theo mode hiện tại.
        if (accCfg.accommodationMode === "private") {
          // Mode "Ở riêng": mỗi khung phải đủ sức chứa phòng cho occupancy quy đổi.
          if (isRoomRequired && hasRoomSegmentCapacityShortfall()) {
            if (requiredWarning) requiredWarning.style.display = "";
            requiredWarning?.scrollIntoView({ behavior: "smooth", block: "center" });
            notify?.error?.("Vui lòng chọn đủ phòng ở từng khung thời gian.");
            return;
          }
          // Validate số NL tối thiểu theo số phòng + danh sách hành khách.
          if (isRoomRequired) {
            const v = validatePassengers();
            const needPaxCheck =
              passengerState.length > 0 || getPrivateMinAdultsRequired() > 0;
            if (!v.ok && needPaxCheck) {
              if (passengerWarning) {
                passengerWarning.textContent = v.message;
                passengerWarning.style.display = "";
              }
              const totalRoomsBook = getPrivateMinAdultsRequired();
              const scrollEl =
                totalRoomsBook > 0 &&
                quantityAdult < totalRoomsBook &&
                privateMinAdultsWarning
                  ? privateMinAdultsWarning
                  : passengerWarning;
              scrollEl?.scrollIntoView({ behavior: "smooth", block: "center" });
              notify?.error?.(
                v.message.split("\n")[0] ||
                  "Vui lòng kiểm tra lại số người lớn và phòng đã chọn."
              );
              return;
            }
          }
          // Validate phân bổ hành khách vào phòng.
          if (privateAssignmentWrap && privateAssignmentWrap.style.display !== "none") {
            const va = validatePrivateAssignments();
            if (!va.ok) {
              if (privateAssignmentWarning) {
                privateAssignmentWarning.textContent = va.message;
                privateAssignmentWarning.style.display = "";
              }
              privateAssignmentWarning?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
              notify?.error?.(
                "Vui lòng phân bổ hành khách vào phòng đầy đủ trước khi đặt tour."
              );
              return;
            }
          }
        } else {
          // Mode "Ở ghép": validate passenger list trước, sau đó nam+nữ=NL/khung.
          if (isRoomRequired) {
            const v = validatePassengers();
            if (!v.ok) {
              if (passengerWarning) {
                passengerWarning.textContent = v.message;
                passengerWarning.style.display = "";
              }
              passengerWarning?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
              notify?.error?.(
                "Vui lòng khai đầy đủ thông tin hành khách trước khi đặt tour."
              );
              return;
            }
            if (quantityAdult > 0) {
              const mismatch = (accCfg.sharedRoomRequest || []).find(
                (r) => (r.males || 0) + (r.females || 0) !== quantityAdult
              );
              if (mismatch) {
                if (sharedRequiredWarning)
                  sharedRequiredWarning.style.display = "";
                sharedRequiredWarning?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
                notify?.error?.(
                  "Tổng số nam và nữ phải bằng số người lớn của đoàn."
                );
                return;
              }
            }
            offlineCheckSharedFeasibility();
            if (!sharedFeasibilityOk) {
              applySharedFeasibilityUI();
              sharedFeasibilityWarning?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
              notify?.error?.(
                sharedFeasibilityMessage || SHARED_INSUFFICIENT_ADULTS_MSG
              );
              return;
            }
          }
        }

        // Build babySeats array từ passengerState
        let babySeats, privateSeatCount, babySeatFeeTotal;
        if (maxBabiesPerAdult === 0) {
          // Auto mode: tất cả em bé chiếm ghế, không cần lưu lựa chọn riêng
          babySeats = [];
          privateSeatCount = quantityBaby;
          babySeatFeeTotal = 0;
        } else {
          babySeats = passengerState
            .filter((p) => p.type === "baby")
            .map((p) => ({
              babyIdx: p.idx,
              seatType: p.babySeatType || "shared",
              guardianIdx: p.babySeatType === "shared" ? p.guardianIdx : null,
            }));
          privateSeatCount = babySeats.filter((b) => b.seatType === "private").length;
          babySeatFeeTotal = privateSeatCount * babySeatFee;
        }

        const item = {
          tourId: tourId,
          quantityAdult,
          quantityChildren: quantityChild,
          quantityBaby,
          checked: true,
          babySeat: privateSeatCount > 0, // backward compat flag
          babySeats,
          babySeatFeeTotal,
          maxBabiesPerAdult,
          departureDateDisplay,
          childrenAges,
          babyAges,
          ageBands: { babyMaxAge: agebabyMax, childrenMinAge: ageChildMin, childrenMaxAge: ageChildMax },
          accommodationMode: accCfg.accommodationMode,
          roomSelections: accCfg.roomSelections,
          sharedRoomRequest: accCfg.sharedRoomRequest,
          passengers: accCfg.passengers || [],
          extraRoomCost: currentExtraRoomCost || 0,
        };
        sessionStorage.setItem("cart_once_mode", "quick-order");
        setSessionCart([item]);

        notify?.success?.("Đã thêm tour. Chuyển tới trang đặt tour...");
        drawMiniCart && drawMiniCart();
        window.location.href = "/cart";
      } else {
        notify?.error?.("Số lượng phải > 0");
      }
    });

    // === Nạp lại từ localStorage (không còn locationFrom) ===
    // User thêm tour A vào giỏ (hoặc sửa số lượng ở chỗ khác), rồi quay lại trang chi tiết tour A — form sẽ hiển thị đúng những gì đang trong giỏ, không reset về mặc định.
    const cartData = getLocalCart();
    const existItem = cartData.find((item) => item.tourId == tourId);
    if (existItem) {
      const qaEl = boxTourDetail.querySelector(`[name="quantityAdult"]`);
      const qcEl = boxTourDetail.querySelector(`[name="quantityChildren"]`);
      const qbEl = boxTourDetail.querySelector(`[name="quantityBaby"]`);
      const departureSelect = boxTourDetail.querySelector(
        "#departureDateSelect"
      );
      if (qaEl) qaEl.value = Math.max(1, existItem.quantityAdult || 0);
      if (qcEl) qcEl.value = existItem.quantityChildren || 0;
      if (qbEl) qbEl.value = existItem.quantityBaby || 0;
      // babySeat/babySeats per-baby state sẽ được restore qua passengerState (guardianIdx, babySeatType)
      if (departureSelect && existItem.departureDateDisplay) {
        departureSelect.value = existItem.departureDateDisplay;
      }
      drawBoxDetail();
      updateAgeInputs(existItem.childrenAges || [], existItem.babyAges || []);
    }
  }

  // === HIỂN THỊ SỐ CHỖ CÒN LẠI KHI CHỌN NGÀY KHỞI HÀNH ===
  const departureSel = boxTourDetail.querySelector("#departureDateSelect");
  const seatInfoEl   = boxTourDetail.querySelector("#departureSeatInfo");
  if (departureSel && seatInfoEl) {
    let seatsByDate = {};
    try {
      seatsByDate = JSON.parse(departureSel.getAttribute("data-seats-by-date") || "{}");
    } catch (e) { seatsByDate = {}; }

    function renderDepartureSeatInfo(dateKey) {
      if (!dateKey || !seatsByDate[dateKey]) {
        seatInfoEl.style.display = "none";
        seatInfoEl.innerHTML = "";
        // Không có ngày cụ thể → dùng lại giá trị tổng
        maxSeats = globalMaxSeats;
        return;
      }
      const { seatsTotal, seatsRemaining } = seatsByDate[dateKey];

      // Cập nhật maxSeats theo ngày khởi hành được chọn
      maxSeats = seatsRemaining;

      const isFull = seatsRemaining <= 0;
      const isLow  = !isFull && seatsRemaining <= 5;
      const badgeClass = isFull ? "seats-badge--full" : (isLow ? "seats-badge--low" : "seats-badge--ok");
      const badgeText  = isFull ? "Hết chỗ" : `${seatsRemaining} chỗ còn`;
      seatInfoEl.innerHTML =
        `<span class="seats-badge ${badgeClass}">${badgeText}</span>` +
        (seatsTotal > 0 ? `<span class="seats-total-hint"> / ${seatsTotal} tổng</span>` : "");
      seatInfoEl.style.display = "flex";
    }

    departureSel.addEventListener("change", () => {
      renderDepartureSeatInfo(departureSel.value);
    });

    // Hiển thị ngay nếu đã có ngày được chọn sẵn
    if (departureSel.value) renderDepartureSeatInfo(departureSel.value);
  }
}

// ===============================
// Order Form (đặt tour từ trang Giỏ)
// ===============================
const orderForm = document.querySelector("#order-form");
if (orderForm) {
  const validator = new JustValidate("#order-form");

  validator
    .addField("#fullname-input", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập họ tên!",
      },
      {
        rule: "minLength",
        value: 5,
        errorMessage: "Họ tên phải có ít nhất 5 ký tự!",
      },
      {
        rule: "maxLength",
        value: 50,
        errorMessage: "Họ tên không được vượt quá 50 ký tự!",
      },
    ])
    .addField("#phone-input", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập số điện thoại!",
      },
      {
        rule: "customRegexp",
        value: /^(0?)(3[2-9]|5[6|8|9]|7[0|6-9]|8[0-6|8|9]|9[0-4|6-9])[0-9]{7}$/,
        errorMessage: "Số điện thoại không đúng định dạng!",
      },
    ])
    .onSuccess(async (event) => {
      const fullName = event.target.fullName.value;
      const phone = event.target.phone.value;
      const email = event.target.email ? event.target.email.value : "";
      const note = event.target.note.value;
      const paymentMethod = event.target.method.value;

      // Lấy giỏ hiện tại (ưu tiên session nếu đang ĐẶT NGAY)
      let cart = getCart();
      cart = cart.filter((item) => {
        return (
          item.checked == true &&
          (item.quantityAdult > 0 ||
            item.quantityChildren > 0 ||
            item.quantityBaby > 0)
        );
      });

      const cartMissingAdult = cart.some(
        (item) => Number(item.quantityAdult || 0) < 1
      );
      if (cartMissingAdult) {
        notify.error("Mỗi tour phải có ít nhất 1 người lớn.");
        return;
      }

      if (cart.length > 0) {
        const dataFinal = {
          fullName: fullName,
          phone: phone,
          email: email,
          note: note,
          paymentMethod: paymentMethod,
          items: cart,
        };

        fetch(`/order/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(dataFinal),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.code == "error" || data.code == "room_unavailable") {
              // Nếu message nhiều dòng (gộp nhiều xung đột phòng), tăng thời
              // gian hiển thị để khách kịp đọc hết.
              const msg = String(data.message || "");
              const lineCount = msg ? msg.split("\n").length : 1;
              if (lineCount > 1) {
                notify.open({
                  type: "error",
                  message: msg,
                  duration: Math.min(15000, 4000 + lineCount * 2000),
                });
              } else {
                notify.error(msg);
              }
              return;
            }

            if (data.code == "success") {
              // Xoá giỏ đúng nguồn
              if (isQuickOrderMode()) {
                clearSessionCart(); // giỏ tạm cho ĐẶT NGAY
              } else {
                let c = getLocalCart();
                c = c.filter((item) => item.checked == false);
                setLocalCart(c);
              }
              drawMiniCart && drawMiniCart();

              // Backend cũ: trả orderCode/phone
              // Backend mới (tách theo công ty): trả orders[]
              let orderCode = data.orderCode;
              let respPhone = data.phone;

              if (
                !orderCode &&
                Array.isArray(data.orders) &&
                data.orders.length
              ) {
                orderCode = data.orders[0].orderCode;
                respPhone = data.orders[0].phone;
              }

              window.__cartNavigateAway = true;
              switch (paymentMethod) {
                case "money":
                case "bank":
                  window.location.href = `/order/pending?orderCode=${orderCode}&phone=${respPhone}`;
                  break;
                case "zalopay":
                  window.location.href = `/order/payment-zalopay?orderCode=${orderCode}&phone=${respPhone}`;
                  break;
                case "vnpay":
                  // VNPay: hiển thị trang pending trước, khách bấm nút mới sang cổng thanh toán
                  window.location.href = `/order/pending?orderCode=${orderCode}&phone=${respPhone}`;
                  break;
              }
            }
          })
          .catch(() => notify.error("Không thể tạo đơn hàng!"));
      } else {
        notify.error("Vui lòng đặt ít nhất 1 tour!");
      }
    });

  // List Input Method
  const listInputMethod = orderForm.querySelectorAll(`input[name="method"]`);
  const innerInfoBank = orderForm.querySelector(".inner-info-bank");

  listInputMethod.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value == "bank") {
        innerInfoBank.classList.add("active");
      } else {
        innerInfoBank.classList.remove("active");
      }
    });
  });
  // End List Input Method
}
// End Order Form

// ===============================
// CCCD Upload Preview (tour)
// ===============================
(function() {
  function initCccdPreview(fileInputId, previewId) {
    var fileInput = document.getElementById(fileInputId);
    var preview = document.getElementById(previewId);
    if (!fileInput || !preview) return;

    fileInput.addEventListener("change", function() {
      preview.innerHTML = "";
      if (!fileInput.files) return;
      Array.from(fileInput.files).forEach(function(file, idx) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var thumb = document.createElement("div");
          thumb.className = "cccd-thumb";
          thumb.innerHTML = '<img src="' + e.target.result + '" alt="CCCD ' + (idx + 1) + '">'
            + '<button type="button" class="cccd-thumb-remove" data-idx="' + idx + '">&times;</button>';
          preview.appendChild(thumb);
        };
        reader.readAsDataURL(file);
      });
    });

    // Drag and drop
    var area = fileInput.closest(".cccd-upload-area");
    if (area) {
      area.addEventListener("dragover", function(e) { e.preventDefault(); area.classList.add("dragover"); });
      area.addEventListener("dragleave", function() { area.classList.remove("dragover"); });
      area.addEventListener("drop", function(e) {
        e.preventDefault();
        area.classList.remove("dragover");
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event("change"));
      });
    }
  }

  initCccdPreview("hotel-cccd-file-input", "hotel-cccd-preview");
})();

// ===============================
// Box Filter (client) dùng chung
// ===============================
(() => {
  const boxFilter = document.querySelector(".box-filter");
  if (!boxFilter) return;

  const form = document.querySelector("#filter-form");
  const applyBtn = boxFilter.querySelector(".inner-button");
  if (!applyBtn) return;

  const FIELDS = [
    "q",
    "locationFrom",
    "locationTo",
    "departureDate",
    "price",
    "minSeats",
  ];

  const NUM_FIELDS = new Set(["minSeats"]);

  // Prefill từ URL
  (function prefillFromURL() {
    const url = new URL(window.location.href.split("#")[0]);
    FIELDS.forEach((name) => {
      const el = boxFilter.querySelector(`[name="${name}"]`);
      if (!el) return;
      const v = url.searchParams.get(name);
      if (v !== null) el.value = v;
    });

    // Prefill cho tags (nhiều checkbox)
    const selectedTags = url.searchParams.getAll("tags");
    if (selectedTags && selectedTags.length) {
      const tagCheckboxes = boxFilter.querySelectorAll(
        'input[name="tags"][type="checkbox"]'
      );
      tagCheckboxes.forEach((cb) => {
        cb.checked = selectedTags.includes(cb.value);
      });
    }
  })();

  function applyFilter() {
    const url = new URL(window.location.href.split("#")[0]);

    // Xử lý riêng cho tags (nhiều giá trị)
    url.searchParams.delete("tags");
    const tagCheckboxes = boxFilter.querySelectorAll(
      'input[name="tags"][type="checkbox"]:checked'
    );
    tagCheckboxes.forEach((cb) => {
      const val = (cb.value || "").trim();
      if (val) {
        url.searchParams.append("tags", val);
      }
    });

    FIELDS.forEach((name) => {
      const el = boxFilter.querySelector(`[name="${name}"]`);
      let val = (el && el.value != null ? String(el.value) : "").trim();

      if (!val || (NUM_FIELDS.has(name) && Number(val) <= 0)) {
        url.searchParams.delete(name);
      } else {
        url.searchParams.set(name, val);
      }
    });

    window.location.assign(url.toString());
  }

  applyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    applyFilter();
  });

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      applyFilter();
    });
  }
})();

// ===============================
// Page Cart – render giỏ + thao tác (có tính giá Em bé theo bậc)
// ===============================
const pageCart = document.querySelector("[page-cart]");

// === TÍNH ĐƠN GIÁ CHO EM BÉ THỨ idx (1-based) THEO RULE "tiered"
function babyUnitAtForItem(item, idx) {
  const mode = (item.babyPricingMode || "fixed").trim();
  const rules = Array.isArray(item.babyPricingRules)
    ? item.babyPricingRules
    : [];

  const priceAdult = Number(item.priceNewAdult || 0);
  const priceChild = Number(item.priceNewChildren || 0);
  const priceBabyFixed = Number(item.priceNewBaby || 0);

  if (mode !== "tiered" || !rules.length) return priceBabyFixed;

  const rule = rules.find((r) => {
    const from = Number(r.from);
    const to = r.to === "inf" ? Infinity : Number(r.to);
    return Number.isFinite(from) && idx >= from && idx <= to;
  });
  if (!rule) return 0;

  const base = rule.ref === "adult" ? priceAdult : priceChild; // server đã chuẩn hoá ref
  const pct = Number(rule.percent) || 0;
  return Math.round((base * pct) / 100);
}

/** Map idx → NL từ passengers trong cart item. */
function _cartAdultByIdx(item) {
  const map = {};
  (Array.isArray(item.passengers) ? item.passengers : []).forEach((p) => {
    if (p.type === "adult") map[p.idx] = p;
  });
  return map;
}

/** HTML khối "Chỗ ngồi em bé" trên /cart. */
function buildCartBabySeatsInfoHtml(item, adultByIdx) {
  const qBaby = Number(item.quantityBaby || 0);
  if (qBaby <= 0) return "";

  const maxBabiesPerAdult = Number(item.maxBabiesPerAdult ?? 1);
  const babies = (Array.isArray(item.passengers) ? item.passengers : []).filter(
    (p) => p.type === "baby"
  );
  const bsArr = Array.isArray(item.babySeats) ? item.babySeats : [];
  const feeTotal = Number(item.babySeatFeeTotal || 0);
  const lines = [];

  const babyNameAt = (seat, i) => {
    const byIdx = babies.find((b) => b.idx === seat.babyIdx);
    if (byIdx && byIdx.name) return byIdx.name;
    if (babies[i] && babies[i].name) return babies[i].name;
    return `Em bé #${i + 1}`;
  };

  const guardianLabel = (guardianIdx) => {
    if (guardianIdx === null || guardianIdx === undefined) return null;
    const g = adultByIdx[guardianIdx];
    return g ? g.name || `Người lớn #${guardianIdx + 1}` : null;
  };

  if (maxBabiesPerAdult === 0) {
    lines.push({ kind: "auto", text: "Tất cả em bé tự động chiếm 1 vị trí tour" });
  } else if (bsArr.length > 0) {
    bsArr.forEach((seat, i) => {
      const name = babyNameAt(seat, i);
      if (seat.seatType === "private") {
        lines.push({ kind: "private", text: `${name}: ghế ngồi riêng` });
      } else {
        const gName = guardianLabel(seat.guardianIdx);
        lines.push({
          kind: "shared",
          text: gName
            ? `${name}: ngồi cùng ${gName}`
            : `${name}: ngồi cùng người lớn (chưa chọn)`,
        });
      }
    });
  } else if (item.babySeat) {
    lines.push({ kind: "private", text: "Đặt chỗ ngồi riêng cho em bé" });
  }

  if (lines.length === 0) return "";

  let html = `<div class="cart-baby-seats-info">`;
  html += `<div class="cart-baby-seats-info__title"><i class="fa-solid fa-baby-carriage"></i>Chỗ ngồi em bé</div>`;
  lines.forEach((line) => {
    const icon = line.kind === "shared" ? "fa-link" : "fa-chair";
    const iconClass =
      line.kind === "shared" ? "icon-shared" : line.kind === "auto" ? "icon-auto" : "icon-private";
    let inner = line.text;
    if (line.kind === "shared" && line.text.includes(": ngồi cùng ")) {
      const [babyPart, gPart] = line.text.split(": ngồi cùng ");
      inner = `${babyPart}: ngồi cùng <strong>${gPart}</strong>`;
    }
    html += `<div class="cart-baby-seats-info__row">
      <i class="fa-solid ${icon} ${iconClass}"></i>
      <span>${inner}</span>
    </div>`;
  });
  if (feeTotal > 0) {
    html += `<div class="cart-baby-seats-info__fee">Tổng phí ghế riêng: <strong>+${feeTotal.toLocaleString("vi-VN")}đ</strong></div>`;
  }
  html += `</div>`;
  return html;
}

/** Guardian / ghế em bé trên từng dòng hành khách trong cart. */
function buildCartPassengerExtraHtml(p, item, adultByIdx) {
  if (p.type === "baby") {
    const isSharedAcc = item.accommodationMode === "shared";
    const roomGid =
      p.roomGuardianIdx !== null && p.roomGuardianIdx !== undefined
        ? p.roomGuardianIdx
        : p.guardianIdx;

    const bs = (Array.isArray(item.babySeats) ? item.babySeats : []).find(
      (b) => b.babyIdx === p.idx
    );
    const seatType = bs ? bs.seatType : p.babySeatType;

    // Ở ghép: hiển thị người ở cùng phòng KS (roomGuardianIdx), không phải người ngồi cùng tour.
    if (
      isSharedAcc &&
      roomGid !== null &&
      roomGid !== undefined &&
      adultByIdx[roomGid]
    ) {
      const gName = adultByIdx[roomGid].name || `Người lớn #${roomGid + 1}`;
      let html = `<span class="cart-passenger-guardian">
        <i class="fa-solid fa-bed icon-muted"></i>
        Ở cùng: <strong>${gName}</strong>
      </span>`;
      if (seatType === "private") {
        html =
          `<span class="cart-passenger-guardian">
            <i class="fa-solid fa-chair icon-private"></i>
            Ghế ngồi riêng
          </span>` + html;
      }
      return html;
    }

    if (seatType === "private") {
      return `<span class="cart-passenger-guardian">
        <i class="fa-solid fa-chair icon-private"></i>
        Ghế ngồi riêng
      </span>`;
    }
    const gid =
      bs && bs.guardianIdx !== null && bs.guardianIdx !== undefined
        ? bs.guardianIdx
        : p.guardianIdx;
    if (gid !== null && gid !== undefined && adultByIdx[gid]) {
      const gName = adultByIdx[gid].name || `Người lớn #${gid + 1}`;
      return `<span class="cart-passenger-guardian">
        <i class="fa-solid fa-link icon-shared"></i>
        Ngồi cùng: <strong>${gName}</strong>
      </span>`;
    }
    if (Number(item.maxBabiesPerAdult ?? 1) === 0) {
      return `<span class="cart-passenger-guardian">
        <i class="fa-solid fa-chair icon-auto"></i>
        Tự động chiếm 1 vị trí tour
      </span>`;
    }
    return "";
  }
  if (
    p.guardianIdx !== null &&
    p.guardianIdx !== undefined &&
    adultByIdx[p.guardianIdx]
  ) {
    const guardian = adultByIdx[p.guardianIdx];
    const guardianName = guardian.name || `Người lớn #${p.guardianIdx + 1}`;
    return `<span class="cart-passenger-guardian">
      <i class="fa-solid fa-link icon-muted"></i>
      Ở cùng: <strong>${guardianName}</strong>
    </span>`;
  }
  return "";
}

const drawCart = () => {
  // Lấy giỏ hiện tại (ưu tiên session nếu đang đặt ngay)
  const cartJSON = JSON.stringify(getCart());

  fetch(`/cart/detail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: cartJSON,
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.code === "error") {
        notify.error(data.message);
        return;
      }

      if (data.code !== "success") return;

      let subTotal = 0;

      const htmlArray = data.cart.map((item) => {
        const seatsTotal = Number(item.seatsTotal || 0);
        const babySeat = !!item.babySeat;

        const qAdult = Number(item.quantityAdult || 0);
        const qChild = Number(item.quantityChildren || 0);
        const qBaby = Number(item.quantityBaby || 0);

        const unitAdult = Number(item.priceNewAdult || 0);
        const unitChild = Number(item.priceNewChildren || 0);

        // ---- CỘNG DỒN THEO BẬC CHO EM BÉ ----
        let babyTotal = 0;
        for (let i = 1; i <= qBaby; i++) {
          babyTotal += babyUnitAtForItem(item, i);
        }
        // Đơn giá để hiển thị "x ..." (lấy theo bậc của bé #1 nếu chưa có số lượng)
        const unitBabyForUi = babyUnitAtForItem(item, Math.max(1, qBaby || 1));

        const itemExtraRoomCost = Number(item.extraRoomCost || 0);
        const itemBabySeatFeeTotal = Number(item.babySeatFeeTotal || 0);

        // cộng tiền chỉ khi item được tick
        if (item.checked) {
          subTotal += qAdult * unitAdult + qChild * unitChild + babyTotal + itemExtraRoomCost + itemBabySeatFeeTotal;
        }

        // Build age info display for cart
        const childrenAgesArr = Array.isArray(item.childrenAges) ? item.childrenAges : [];
        const babyAgesArr     = Array.isArray(item.babyAges)     ? item.babyAges     : [];
        const childrenAgesHtml = childrenAgesArr.length
          ? `<div class="cart-ages-info">Tuổi trẻ em: ${childrenAgesArr.map((a, i) => `Bé ${i+1}: <b>${a} tuổi</b>`).join(" · ")}</div>`
          : "";
        const babyAgesHtml = babyAgesArr.length
          ? `<div class="cart-ages-info">Tuổi em bé: ${babyAgesArr.map((a, i) => `Bé ${i+1}: <b>${a} tuổi</b>`).join(" · ")}</div>`
          : "";
        const adultByIdxCart = _cartAdultByIdx(item);
        const babySeatsInfoHtml = buildCartBabySeatsInfoHtml(item, adultByIdxCart);
        const tourDetailUrlForBack = (item.company && item.company.slug)
          ? `/company/${item.company.slug}/tour/detail/${item.slug}`
          : `/tour/detail/${item.slug}`;

        return `
          <div class="inner-tour-item" data-tour-id="${item.tourId}">
            <div class="inner-actions">
              <button class="inner-delete" button-delete tour-id="${
                item.tourId
              }">
                <i class="fa-solid fa-xmark"></i>
              </button>
              <input class="inner-check" type="checkbox" ${
                item.checked ? "checked" : ""
              } input-check tour-id="${item.tourId}">
            </div>

            <div class="inner-product">
              <div class="inner-image">
                <a href="${tourDetailUrlForBack}">
                  <img alt="${item.name}" src="${item.avatar}">
                </a>
              </div>
              <div class="inner-content">
                <div class="inner-title">
                  <a href="${tourDetailUrlForBack}">${item.name}</a>
                </div>
                <div class="inner-meta">
                  <div>Ngày Khởi Hành: <b>${item.departureDate}</b></div>
                  <div>Khởi Hành Tại: <b>${(item.cityName || "").trim() || "Chưa thiết lập"}</b></div>
                  <div>Số ghế còn lại: <b>${seatsTotal}</b></div>
                  ${babySeatsInfoHtml}
                  ${childrenAgesHtml}
                  ${babyAgesHtml}
                </div>
              </div>
            </div>

            <div class="inner-quantity">
              <div class="inner-label">Số Lượng Hành Khách</div>
              <div class="inner-list">
                <div class="inner-item">
                  <div class="inner-item-label">Người lớn:</div>
                  <div class="inner-item-input">
                    <span class="cart-qty-fixed">${qAdult}</span>
                  </div>
                  <div class="inner-item-price">
                    <span>${qAdult}</span>
                    <span>x</span>
                    <span class="inner-hl">${unitAdult.toLocaleString("vi-VN")}</span>
                  </div>
                </div>

                <div class="inner-item">
                  <div class="inner-item-label">Trẻ em:</div>
                  <div class="inner-item-input">
                    <span class="cart-qty-fixed">${qChild}</span>
                  </div>
                  <div class="inner-item-price">
                    <span>${qChild}</span>
                    <span>x</span>
                    <span class="inner-hl">${unitChild.toLocaleString("vi-VN")}</span>
                  </div>
                </div>

                <div class="inner-item">
                  <div class="inner-item-label">Em bé:</div>
                  <div class="inner-item-input">
                    <span class="cart-qty-fixed">${qBaby}</span>
                  </div>
                  <div class="inner-item-price">
                    <span>${qBaby}</span>
                    <span>x</span>
                    <span class="inner-hl">${unitBabyForUi.toLocaleString("vi-VN")}</span>
                  </div>
                </div>
              </div>
            </div>

            ${(() => {
              const fmtDate = (d) => {
                if (!d) return "";
                const dt = new Date(d);
                if (isNaN(dt)) return d;
                const dd = String(dt.getDate()).padStart(2, "0");
                const mm = String(dt.getMonth() + 1).padStart(2, "0");
                const yyyy = dt.getFullYear();
                return dd + "/" + mm + "/" + yyyy;
              };

              if (item.accommodationMode === "shared") {
                const sharedReq = Array.isArray(item.sharedRoomRequest)
                  ? item.sharedRoomRequest
                  : [];
                const psList = Array.isArray(item.passengers) ? item.passengers : [];

                // Build adult lookup map để tra tên người trông
                const adultByIdx = _cartAdultByIdx(item);

                let html = `<div class="inner-room-selections">`;
                html += `<div class="inner-label" style="display:flex;align-items:center;gap:6px;">
                  <i class="fa-solid fa-people-group" style="color:#6366f1;font-size:13px"></i>
                  Ở ghép
                </div>`;

                // ── Khung thời gian + khách sạn ──
                if (sharedReq.length > 0) {
                  html += `<div class="inner-room-seg-list">`;
                  sharedReq.forEach((r) => {
                    const segLabel = fmtDate(r.fromDate) + " → " + fmtDate(r.toDate);
                    const candidates = Array.isArray(r.candidateHotels) && r.candidateHotels.length > 0
                      ? r.candidateHotels
                      : r.hotelName ? [{ hotelName: r.hotelName }] : [];
                    html += `<div class="inner-room-seg">
                      <div class="inner-room-seg__header">${segLabel}</div>`;
                    if (candidates.length > 0) {
                      html += `<div class="inner-room-hotel">`;
                      if (candidates.length > 1) {
                        html += `<div class="inner-room-hotel__name" style="font-size:12px;color:#64748b;">
                          <i class="fa-solid fa-hotel" style="margin-right:4px;color:#6366f1;"></i>
                          Hệ thống sẽ ưu tiên sắp xếp theo thứ tự: ${candidates.map((c, i) => `${i+1}. ${c.hotelName || c.hotelId || '?'}`).join(" · ")}
                        </div>`;
                      } else {
                        html += `<div class="inner-room-hotel__name">
                          <i class="fa-solid fa-hotel" style="margin-right:4px;color:#6366f1;"></i>
                          ${candidates[0].hotelName || ""}
                        </div>`;
                      }
                      html += `<div class="inner-room-row">
                        <span class="inner-room-row__type">Số người lớn ở ghép: ${Number(r.males)||0} nam, ${Number(r.females)||0} nữ</span>
                      </div>
                      <div class="inner-room-row" style="padding-top:0;">
                        <span class="inner-room-row__occ">Khách sạn thực tế sẽ được hệ thống sắp xếp theo khả năng ghép phòng.</span>
                      </div>`;
                      html += `</div>`;
                    }
                    html += `</div>`;
                  });
                  html += `</div>`;
                }

                // ── Danh sách hành khách chi tiết ──
                if (psList.length > 0) {
                  html += `<div class="cart-passenger-list">
                    <div class="cart-passenger-list__title">
                      <i class="fa-solid fa-id-card" style="margin-right:6px;color:#475569;font-size:12px"></i>
                      Danh sách hành khách (${psList.length} người)
                    </div>
                    <div class="cart-passenger-list__rows">`;

                  psList.forEach((p) => {
                    const typeLabel = p.type === "adult" ? "Người lớn" : p.type === "child" ? "Trẻ em" : "Em bé";
                    const typeClass = p.type === "adult" ? "adult" : p.type === "child" ? "child" : "baby";
                    const genderIcon = p.gender === "male"
                      ? `<i class="fa-solid fa-mars" style="color:#3b82f6;font-size:11px"></i>`
                      : p.gender === "female"
                      ? `<i class="fa-solid fa-venus" style="color:#ec4899;font-size:11px"></i>`
                      : "";
                    const genderText = p.gender === "male" ? "Nam" : p.gender === "female" ? "Nữ" : "";

                    let guardianHtml = buildCartPassengerExtraHtml(p, item, adultByIdx);

                    html += `<div class="cart-passenger-row cart-passenger-row--${typeClass}">
                      <span class="cart-passenger-badge cart-passenger-badge--${typeClass}">${typeLabel}</span>
                      <span class="cart-passenger-name">${p.name || "(chưa có tên)"}</span>
                      <span class="cart-passenger-age">${p.age !== undefined && p.age !== "" ? p.age + " tuổi" : ""}</span>
                      ${genderIcon ? `<span class="cart-passenger-gender">${genderIcon} ${genderText}</span>` : ""}
                      ${guardianHtml}
                    </div>`;
                  });

                  html += `</div></div>`;
                }

                html += `</div>`;
                return html;
              }

              const roomSels = Array.isArray(item.roomSelections) ? item.roomSelections : [];
              if (roomSels.length === 0) return "";

              const psListPrivate = Array.isArray(item.passengers) ? item.passengers : [];
              const adultByIdxPrivate = _cartAdultByIdx(item);
              // Build idx → passenger map.
              const paxByIdxPrivate = {};
              psListPrivate.forEach((p) => {
                paxByIdxPrivate[p.idx] = p;
              });
              const renderPaxRow = (p) => {
                const typeLabel = p.type === "adult" ? "Người lớn" : p.type === "child" ? "Trẻ em" : "Em bé";
                const typeClass = p.type === "adult" ? "adult" : p.type === "child" ? "child" : "baby";
                const genderIcon = p.gender === "male"
                  ? `<i class="fa-solid fa-mars" style="color:#3b82f6;font-size:11px"></i>`
                  : p.gender === "female"
                  ? `<i class="fa-solid fa-venus" style="color:#ec4899;font-size:11px"></i>`
                  : "";
                const genderText = p.gender === "male" ? "Nam" : p.gender === "female" ? "Nữ" : "";
                const extraHtml = buildCartPassengerExtraHtml(p, item, adultByIdxPrivate);
                return `<div class="cart-passenger-row cart-passenger-row--${typeClass}">
                  <span class="cart-passenger-badge cart-passenger-badge--${typeClass}">${typeLabel}</span>
                  <span class="cart-passenger-name">${p.name || "(chưa có tên)"}</span>
                  <span class="cart-passenger-age">${p.age !== undefined && p.age !== "" ? p.age + " tuổi" : ""}</span>
                  ${genderIcon ? `<span class="cart-passenger-gender">${genderIcon} ${genderText}</span>` : ""}
                  ${extraHtml}
                </div>`;
              };

              // Nhóm theo khung thời gian
              const segMap = {};
              roomSels.forEach((sel) => {
                const key = (sel.fromDate || "") + "__" + (sel.toDate || "");
                if (!segMap[key]) segMap[key] = { fromDate: sel.fromDate, toDate: sel.toDate, items: [] };
                segMap[key].items.push(sel);
              });

              let html = `<div class="inner-room-selections"><div class="inner-label">Phòng khách sạn đã chọn (ở riêng)</div><div class="inner-room-seg-list">`;

              Object.values(segMap).forEach((seg) => {
                const segLabel = fmtDate(seg.fromDate) + " → " + fmtDate(seg.toDate);
                html += `<div class="inner-room-seg">
                  <div class="inner-room-seg__header">${segLabel}</div>`;

                // Nhóm theo tên khách sạn
                const hotelMap = {};
                seg.items.forEach((sel) => {
                  if (!hotelMap[sel.hotelName]) hotelMap[sel.hotelName] = [];
                  hotelMap[sel.hotelName].push(sel);
                });

                Object.entries(hotelMap).forEach(([hotelName, sels]) => {
                  html += `<div class="inner-room-hotel">
                    <div class="inner-room-hotel__name">${hotelName}</div>`;
                  sels.forEach((sel) => {
                    html += `<div class="inner-room-row">
                      <span class="inner-room-row__type">${sel.roomTypeName}</span>
                      <span class="inner-room-row__qty">${sel.selectedRooms} phòng</span>
                      <span class="inner-room-row__occ">(${sel.baseOccupancy} người/phòng)</span>
                    </div>`;

                    // Hiển thị từng phòng vật lý + danh sách hành khách đã gán.
                    const assigns = Array.isArray(sel.roomAssignments) ? sel.roomAssignments : [];
                    if (assigns.length > 0 && psListPrivate.length > 0) {
                      html += `<div class="inner-room-assignments">`;
                      assigns.forEach((a, ridx) => {
                        const idxs = Array.isArray(a.passengerIdxs) ? a.passengerIdxs : [];
                        const namesHtml = idxs
                          .map((idx) => {
                            const p = paxByIdxPrivate[idx];
                            if (!p) return "";
                            const typeShort = p.type === "child" ? "TE" : p.type === "baby" ? "EB" : "NL";
                            return `<span class="inner-room-assign-pax inner-room-assign-pax--${p.type}">
                              <strong>${p.name || "Hành khách #" + (idx + 1)}</strong>
                              <span class="inner-room-assign-pax__meta">${typeShort}${p.age !== undefined && p.age !== "" ? " · " + p.age + "t" : ""}</span>
                            </span>`;
                          })
                          .join("");
                        const usedTxt =
                          a.usedCapacity !== undefined && a.usedCapacity !== null
                            ? ` · sức chứa quy đổi ${a.usedCapacity}/${sel.baseOccupancy}`
                            : "";
                        html += `<div class="inner-room-assign-row">
                          <div class="inner-room-assign-row__title">
                            <i class="fa-solid fa-bed" style="margin-right:4px;color:#0071c2"></i>
                            Phòng ${sel.roomTypeName} #${ridx + 1}${usedTxt}
                          </div>
                          <div class="inner-room-assign-row__pax">${namesHtml || '<span class="inner-room-assign-empty">— chưa gán hành khách —</span>'}</div>
                        </div>`;
                      });
                      html += `</div>`;
                    }
                  });
                  html += `</div>`;
                });

                html += `</div>`;
              });

              if (itemExtraRoomCost > 0) {
                html += `<div class="inner-room-extra-cost">Chi phí phòng (ở riêng): <strong>${itemExtraRoomCost.toLocaleString("vi-VN")}đ</strong></div>`;
              }

              // ── Danh sách hành khách chi tiết (private mode mới) ──
              if (psListPrivate.length > 0) {
                html += `<div class="cart-passenger-list">
                  <div class="cart-passenger-list__title">
                    <i class="fa-solid fa-id-card" style="margin-right:6px;color:#475569;font-size:12px"></i>
                    Danh sách hành khách (${psListPrivate.length} người)
                  </div>
                  <div class="cart-passenger-list__rows">`;
                psListPrivate.forEach((p) => {
                  html += renderPaxRow(p);
                });
                html += `</div></div>`;
              }

              html += `</div></div>`;
              return html;
            })()}
          </div>
        `;
      });

      const discount = 0;
      const total = subTotal - discount;

      const elementCartList = pageCart.querySelector("[cart-list]");
      if (htmlArray.length > 0) {
        elementCartList.innerHTML = htmlArray.join("");
      } else {
        elementCartList.innerHTML = `<div class="inner-no-data">Giỏ hàng rỗng.</div>`;
      }
      const elCartSubTotal = pageCart.querySelector("[cart-sub-total]");
      if (elCartSubTotal) {
        elCartSubTotal.innerHTML = subTotal.toLocaleString("vi-VN");
      }
      const elCartTotal = pageCart.querySelector("[cart-total]");
      if (elCartTotal) {
        elCartTotal.innerHTML = total.toLocaleString("vi-VN");
      }

      // --- CẬP NHẬT SỐ LƯỢNG + RÀNG BUỘC GHẾ ---
      const listInputQuantity = elementCartList.querySelectorAll(
        `.inner-tour-item .inner-quantity input`
      );

      listInputQuantity.forEach((input) => {
        input.addEventListener("input", () => {
          const tourId = input.getAttribute("tour-id");
          const fieldName = input.name;
          let quantity = parseInt(input.value) || 0;

          const min = parseInt(input.getAttribute("min"), 10) || 0;
          const max = parseInt(input.getAttribute("max"), 10) || 0;
          const seatsTotal =
            parseInt(input.getAttribute("data-seats-total"), 10) || 0;

          // cart hiện tại (ưu tiên session khi đặt ngay)
          const cartData = getCart();
          const idx = cartData.findIndex((it) => it.tourId == tourId);
          if (idx === -1) return;

          // chuẩn hoá min/max
          if (quantity < min) {
            notify.error(`Số lượng phải >= ${min}`);
            quantity = min;
          }
          if (quantity > max) {
            notify.error(`Số lượng phải <= ${max}`);
            quantity = max;
          }
          input.value = quantity;

          let qAdult = Number(cartData[idx].quantityAdult || 0);
          let qChild = Number(cartData[idx].quantityChildren || 0);
          let qBaby = Number(cartData[idx].quantityBaby || 0);

          if (fieldName === "quantityAdult") qAdult = quantity;
          if (fieldName === "quantityChildren") qChild = quantity;
          if (fieldName === "quantityBaby") qBaby = quantity;

          if (qAdult < 1) {
            qAdult = 1;
            if (fieldName === "quantityAdult") input.value = 1;
            notify.error("Tour phải có ít nhất 1 người lớn.");
          }

          // GHẾ = NL + TE + (EB nếu đã tick “đặt chỗ riêng” khi thêm vào giỏ)
          const babySeat = !!cartData[idx].babySeat;
          const babySeatsArr = Array.isArray(cartData[idx].babySeats) ? cartData[idx].babySeats : [];
          const privateSeatBabiesInCart = babySeatsArr.length > 0
            ? babySeatsArr.filter((b) => b.seatType === "private").length
            : (babySeat ? qBaby : 0);
          let usedSeats = qAdult + qChild + privateSeatBabiesInCart;

          if (seatsTotal > 0 && usedSeats > seatsTotal) {
            const overflow = usedSeats - seatsTotal;
            if (fieldName === "quantityBaby" && privateSeatBabiesInCart > 0 && qBaby > 0) {
              qBaby = Math.max(0, qBaby - overflow);
              input.value = qBaby;
              notify.error(`Tổng ghế vượt ${seatsTotal}. Đã giảm bớt em bé.`);
            } else if (fieldName === "quantityChildren" && qChild > 0) {
              qChild = Math.max(0, qChild - overflow);
              input.value = qChild;
              notify.error(`Tổng ghế vượt ${seatsTotal}. Đã giảm bớt trẻ em.`);
            } else if (fieldName === "quantityAdult" && qAdult > 0) {
              qAdult = Math.max(0, qAdult - overflow);
              input.value = qAdult;
              notify.error(
                `Tổng ghế vượt ${seatsTotal}. Đã giảm bớt người lớn.`
              );
            }
          }

          // lưu lại số lượng mới
          cartData[idx].quantityAdult = qAdult;
          cartData[idx].quantityChildren = qChild;
          cartData[idx].quantityBaby = qBaby;

          // Sync mảng tuổi theo số lượng mới (cắt bớt hoặc thêm giá trị mặc định)
          const ab = cartData[idx].ageBands || {};
          const defChildAge = ab.childrenMinAge || 4;
          const defBabyAge  = 0;
          let cAges = Array.isArray(cartData[idx].childrenAges) ? [...cartData[idx].childrenAges] : [];
          let bAges = Array.isArray(cartData[idx].babyAges)     ? [...cartData[idx].babyAges]     : [];
          while (cAges.length > qChild) cAges.pop();
          while (cAges.length < qChild) cAges.push(defChildAge);
          while (bAges.length > qBaby)  bAges.pop();
          while (bAges.length < qBaby)  bAges.push(defBabyAge);
          cartData[idx].childrenAges = cAges;
          cartData[idx].babyAges     = bAges;

          setCart(cartData);
          drawCart(); // re-render để đơn giá em bé cập nhật theo bậc mới
        });
      });

      // Xoá tour
      elementCartList.querySelectorAll(`[button-delete]`).forEach((btn) => {
        btn.addEventListener("click", () => {
          const tourId = btn.getAttribute("tour-id");
          let cart = getCart().filter((it) => it.tourId != tourId);
          setCart(cart);
          notify.success("Đã xóa tour khỏi giỏ hàng!");
          drawCart();
          drawMiniCart();
        });
      });

      // Check/uncheck tour
      elementCartList.querySelectorAll(`[input-check]`).forEach((chk) => {
        chk.addEventListener("change", () => {
          const tourId = chk.getAttribute("tour-id");
          const cart = getCart();
          const i = cart.findIndex((it) => it.tourId == tourId);
          if (i !== -1) {
            cart[i].checked = !!chk.checked;
            setCart(cart);
            drawCart();
          }
        });
      });
    })
    .catch(() => notify.error("Không thể tải giỏ hàng!"));
};

if (pageCart) {
  drawCart();
  // Khi điều hướng sang trang khác (không phải reload), xoá giỏ tạm ĐẶT NGAY.
  // Chỉ đánh dấu navigate-away khi user thật sự click sang URL khác hoặc khi
  // order tạo thành công. KHÔNG đánh dấu khi form submit thường (vì F5 sau khi
  // form trả lỗi cũng phát sinh `pagehide`, gây xoá giỏ ngoài ý muốn).
  window.__cartNavigateAway = false;
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (
      a &&
      !a.getAttribute("href").startsWith("#") &&
      !a.getAttribute("href").startsWith("javascript")
    ) {
      window.__cartNavigateAway = true;
    }
  });
  window.addEventListener("pagehide", () => {
    if (isQuickOrderMode() && window.__cartNavigateAway) clearSessionCart();
  });
}

// ===============================
// User dropdown (mobile friendly)
// ===============================
(() => {
  const menu = document.querySelector(".user-menu");
  if (!menu) return;

  const trigger = menu.querySelector(".user-trigger");
  const dropdown = menu.querySelector(".user-dropdown");

  // Toggle khi click (hữu ích cho mobile)
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
    const opened = menu.classList.contains("open");
    trigger.setAttribute("aria-expanded", opened ? "true" : "false");
    if (opened) {
      dropdown.style.opacity = "1";
      dropdown.style.visibility = "visible";
      dropdown.style.transform = "translateY(0)";
      trigger.querySelector(".user-trigger-chevron")?.style &&
        (trigger.querySelector(".user-trigger-chevron").style.transform = "rotate(180deg)");
    } else {
      dropdown.removeAttribute("style");
      trigger.querySelector(".user-trigger-chevron")?.style &&
        (trigger.querySelector(".user-trigger-chevron").style.transform = "");
    }
  });

  // Click ra ngoài để đóng
  document.addEventListener("click", () => {
    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      dropdown.removeAttribute("style");
      trigger.querySelector(".user-trigger-chevron")?.style &&
        (trigger.querySelector(".user-trigger-chevron").style.transform = "");
    }
  });
})();

// ===============================
// Logout
// ===============================
const buttonLogout = document.querySelector(".header .inner-logout");
if (buttonLogout) {
  buttonLogout.addEventListener("click", () => {
    fetch(`/account/logout`, {
      method: "POST",
    })
      .then((res) => res.json())
      .then((data) => {
        // Không xóa dữ liệu so sánh tour khi đăng xuất
        // Dữ liệu sẽ được lưu theo userId và sẽ được load lại khi đăng nhập lại
        drawNotify(data.code, data.message);
        window.location.href = `/`;
      });
  });
}
// End Logout

// ===============================
// Profile Inline Edit (update info in profile.pug)
// ===============================
const profileEditForm = document.querySelector("#profile-edit-form");

if (profileEditForm) {
  // Regex kiểm tra số điện thoại VN (tuỳ biến nếu cần)
  const VN_PHONE =
    /^(0?)(3[2-9]|5[6|8|9]|7[0|6-9]|8[0-6|8|9]|9[0-4|6-9])[0-9]{7}$/;

  const validator = new JustValidate("#profile-edit-form");

  validator
    // Họ tên (bắt buộc)
    .addField("#fullName", [
      { rule: "required", errorMessage: "Vui lòng nhập họ tên!" },
      { rule: "minLength", value: 2, errorMessage: "Họ tên quá ngắn!" },
      { rule: "maxLength", value: 80, errorMessage: "Họ tên quá dài!" },
    ])
    // Điện thoại (được để trống, nếu có phải hợp lệ)
    .addField("#phone", [
      {
        validator: (v) => {
          const s = String(v || "").trim();
          return s === "" || VN_PHONE.test(s);
        },
        errorMessage: "Số điện thoại không hợp lệ!",
      },
    ])
    // CMND/CCCD (được để trống, nếu có phải 9 hoặc 12 chữ số)
    .addField("#idNumber", [
      {
        validator: (v) => {
          const s = String(v || "").trim();
          return s === "" || /^(?:\d{9}|\d{12})$/.test(s);
        },
        errorMessage: "CMND/CCCD phải là 9 hoặc 12 chữ số!",
      },
    ])
    // Quốc tịch
    .addField("#nationality", [
      { rule: "maxLength", value: 60, errorMessage: "Quốc tịch quá dài!" },
    ])
    // Địa chỉ
    .addField("#address", [
      { rule: "maxLength", value: 200, errorMessage: "Địa chỉ quá dài!" },
    ])
    // Submit thành công
    .onSuccess(async (event) => {
      event.preventDefault(); // chặn reload mặc định

      const form = event.target;
      const btn = form.querySelector("#btn-save");
      if (btn) btn.disabled = true;

      // Lấy dữ liệu từ form
      const payload = {
        fullName: form.fullName.value?.trim() || "",
        gender: form.gender.value || "", // 'male' | 'female' | ''
        birthday: form.birthday.value || "", // 'YYYY-MM-DD' hoặc ''
        phone: form.phone.value?.trim() || "",
        idNumber: form.idNumber.value?.trim() || "",
        nationality: form.nationality.value?.trim() || "",
        address: form.address.value?.trim() || "",
      };

      try {
        const res = await fetch("/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });

        // Nếu hết phiên đăng nhập sẽ trả HTML -> tránh parse lỗi
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          notify.error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
          return;
        }

        const data = await res.json();

        if (data.code === "success") {
          notify.success(data.message || "Cập nhật thành công!");

          // Cập nhật nhanh tên ở header (nếu có)
          const nameEl =
            document.querySelector(".header .user-name") ||
            document.querySelector(".header .inner-name");
          if (nameEl && payload.fullName) nameEl.textContent = payload.fullName;

          // Muốn chắc ăn thì refresh:
          // setTimeout(() => window.location.reload(), 600);
        } else {
          notify.error(data.message || "Cập nhật thất bại!");
        }
      } catch (err) {
        notify.error("Không thể cập nhật, vui lòng thử lại!");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
}

// ===============================
// ĐÁNH GIÁ & BÌNH LUẬN (Trang chi tiết tour)
// ===============================
(() => {
  const box = document.getElementById("box-reviews");
  if (!box) return;

  const tourId = box.getAttribute("data-tour-id");
  const loggedIn = box.getAttribute("data-logged-in") === "1";

  // Elements
  const summaryAvgEl = box.querySelector(".avg-number");
  const summaryStarsEl = box.querySelector(".review-summary .stars");
  const summaryCountEl = box.querySelector(".review-summary .count");
  const distribRows = box.querySelectorAll(".distribution li");
  const listEl = box.querySelector(".review-list");

  // Pagination
  const btnPrev = box.querySelector(".review-pagination .btn-prev");
  const btnNext = box.querySelector(".review-pagination .btn-next");
  const pageInfo = box.querySelector(".review-pagination .page-info");

  let state = { page: 1, limit: 10, total: 0 };

  // Render sao (★) theo số 0..5
  function renderStars(container, rating) {
    container.innerHTML = "";
    const r = Math.round(rating * 2) / 2; // nếu muốn nửa sao có thể mở rộng
    for (let i = 1; i <= 5; i++) {
      const span = document.createElement("span");
      span.textContent = i <= r ? "★" : "☆";
      span.style.fontSize = "18px";
      container.appendChild(span);
    }
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function fetchReviews(page = 1) {
    const url = `/review/tour/${tourId}/reviews?page=${page}&limit=${state.limit}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "success")
      throw new Error(data.message || "Lỗi tải đánh giá");

    const { items, total, counts, ratingAvg, ratingCount, page: p } = data.data;
    state.page = p;
    state.total = total;

    // Summary
    summaryAvgEl.textContent = ratingAvg.toFixed(1);
    renderStars(summaryStarsEl, ratingAvg);
    summaryCountEl.textContent = `(${ratingCount} đánh giá)`;

    // Distribution (5→1)
    const sum = ratingCount || 1;
    const order = [5, 4, 3, 2, 1];
    distribRows.forEach((li, idx) => {
      const star = order[idx];
      const count = counts[star] || 0;
      li.querySelector(".bar-inner").style.width = `${Math.round(
        (count * 100) / sum
      )}%`;
      li.querySelector(".bar-count").textContent = count;
    });

    // List
    listEl.innerHTML =
      items.length === 0
        ? `<div class="review-empty">Chưa có đánh giá nào.</div>`
        : items
            .map((it) => {
              const date = new Date(it.createdAt);
              const dstr = date.toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              });
              const content = escapeHTML(it.content || "");
              const stars = "★".repeat(it.rating) + "☆".repeat(5 - it.rating);
              return `
                <div class="review-item">
                  <div class="review-head">
                    <div class="review-user">${escapeHTML(
                      it.userName || "Người dùng"
                    )}</div>
                    <div class="review-stars">${stars}</div>
                  </div>
                  <div class="review-date">${dstr}</div>
                  ${
                    content
                      ? `<div class="review-content">${content.replaceAll(
                          "\n",
                          "<br>"
                        )}</div>`
                      : `<div class="review-content muted">Không có nội dung.</div>`
                  }
                </div>
              `;
            })
            .join("");

    // Pagination
    const totalPages = Math.max(1, Math.ceil(total / state.limit));
    btnPrev.disabled = state.page <= 1;
    btnNext.disabled = state.page >= totalPages;
    pageInfo.textContent = `${state.page}/${totalPages}`;
  }

  // Nút phân trang
  btnPrev?.addEventListener("click", () =>
    fetchReviews(state.page - 1).catch(() => {})
  );
  btnNext?.addEventListener("click", () =>
    fetchReviews(state.page + 1).catch(() => {})
  );

  // Form gửi review
  if (loggedIn) {
    const form = box.querySelector("#review-form");
    const starUl = form.querySelector(".star-input");
    const ratingInput = form.querySelector('input[name="rating"]');
    let hoverVal = 0;

    function paintStars(val) {
      starUl.querySelectorAll("li").forEach((li) => {
        const v = Number(li.dataset.value);
        li.classList.toggle("active", v <= val);
      });
    }

    // Khởi tạo 5 sao chọn mặc định = 5
    paintStars(Number(ratingInput.value || 5));

    starUl.addEventListener("mousemove", (e) => {
      const li = e.target.closest("li[data-value]");
      if (!li) return;
      hoverVal = Number(li.dataset.value);
      paintStars(hoverVal);
    });
    starUl.addEventListener("mouseleave", () =>
      paintStars(Number(ratingInput.value || 5))
    );
    starUl.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-value]");
      if (!li) return;
      ratingInput.value = li.dataset.value;
      paintStars(Number(ratingInput.value));
    });

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const payload = {
        rating: fd.get("rating"),
        content: fd.get("content"),
      };
      try {
        const res = await fetch(`/review/tour/${tourId}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "same-origin",
        });
        const data = await res.json();
        if (data.code !== "success") {
          notify?.error?.(data.message || "Không thể gửi đánh giá!");
          return;
        }
        notify?.success?.("Đã gửi đánh giá!");
        form.reset();
        ratingInput.value = "5";
        paintStars(5);
        // reload trang 1
        fetchReviews(1).catch(() => {});
      } catch (_) {
        notify?.error?.("Không thể gửi đánh giá!");
      }
    });
  }

  // nạp lần đầu
  fetchReviews(1).catch(() => {});
})();

// Custom select picker (tránh native select tràn trên mobile)
window.initCustomSelectPicker = function initCustomSelectPicker(select) {
  if (!select || select.dataset.pickerReady === "true") return null;
  if (select.style.display === "none") return null;

  select.dataset.pickerReady = "true";

  const wrap = document.createElement("div");
  wrap.className = "custom-select-picker";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  select.classList.add("custom-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const labelSpan = document.createElement("span");
  labelSpan.className = "custom-select-label";

  const chevron = document.createElement("i");
  chevron.className = "fa-solid fa-angle-down";
  chevron.setAttribute("aria-hidden", "true");

  trigger.append(labelSpan, chevron);

  const optionsEl = document.createElement("div");
  optionsEl.className = "custom-select-options";
  optionsEl.setAttribute("role", "listbox");

  const MOBILE_BP = 768;

  const resetOptionsPosition = () => {
    optionsEl.classList.remove("is-fixed");
    optionsEl.style.position = "";
    optionsEl.style.top = "";
    optionsEl.style.left = "";
    optionsEl.style.width = "";
    optionsEl.style.right = "";
    optionsEl.style.bottom = "";
    optionsEl.style.maxHeight = "";
    optionsEl.style.zIndex = "";
  };

  const positionOptionsMenu = () => {
    if (window.innerWidth > MOBILE_BP) {
      resetOptionsPosition();
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;

    optionsEl.classList.add("is-fixed");
    optionsEl.style.position = "fixed";
    optionsEl.style.left = `${Math.max(8, rect.left)}px`;
    optionsEl.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    optionsEl.style.right = "auto";
    optionsEl.style.zIndex = "1000";

    if (openUp) {
      optionsEl.style.top = "auto";
      optionsEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      optionsEl.style.maxHeight = `${Math.min(280, spaceAbove)}px`;
    } else {
      optionsEl.style.bottom = "auto";
      optionsEl.style.top = `${rect.bottom + 4}px`;
      optionsEl.style.maxHeight = `${Math.min(280, spaceBelow)}px`;
    }
  };

  const closePicker = () => {
    wrap.classList.remove("active");
    trigger.setAttribute("aria-expanded", "false");
    resetOptionsPosition();
  };

  const onViewportChange = () => {
    if (wrap.classList.contains("active")) positionOptionsMenu();
  };

  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);

  const rebuildOptions = () => {
    optionsEl.innerHTML = "";
    Array.from(select.options).forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-select-option";
      btn.dataset.value = opt.value;
      btn.textContent = opt.textContent.trim();
      btn.setAttribute("role", "option");

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        select.value = opt.value;
        syncPicker();
        closePicker();
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      optionsEl.appendChild(btn);
    });
    syncPicker();
  };

  const syncPicker = () => {
    const selectedOpt = select.options[select.selectedIndex];
    labelSpan.textContent = selectedOpt
      ? selectedOpt.textContent.trim()
      : "";

    optionsEl.querySelectorAll(".custom-select-option").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.value === select.value);
    });
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = !wrap.classList.contains("active");
    if (willOpen) {
      wrap.classList.add("active");
      trigger.setAttribute("aria-expanded", "true");
      positionOptionsMenu();
    } else {
      closePicker();
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) closePicker();
  });

  wrap.append(trigger, optionsEl);
  rebuildOptions();

  return { syncPicker, rebuildOptions, wrap };
};

// Box Pagination (custom dropdown — tránh native select tràn trên mobile)
(() => {
  const initPaginationPicker = (select) => {
    if (select.dataset.pickerReady === "true") return null;
    select.dataset.pickerReady = "true";

    const wrap = document.createElement("div");
    wrap.className = "inner-pagination-picker";
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    select.classList.add("inner-pagination-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "inner-pagination-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const labelSpan = document.createElement("span");
    labelSpan.className = "inner-pagination-label";

    const chevron = document.createElement("i");
    chevron.className = "fa-solid fa-angle-down";
    chevron.setAttribute("aria-hidden", "true");

    trigger.append(labelSpan, chevron);

    const optionsEl = document.createElement("div");
    optionsEl.className = "inner-pagination-options";
    optionsEl.setAttribute("role", "listbox");

    const syncPicker = () => {
      const selectedOpt = select.options[select.selectedIndex];
      labelSpan.textContent = selectedOpt
        ? selectedOpt.textContent.trim()
        : "Trang 1";

      optionsEl.querySelectorAll(".inner-pagination-option").forEach((btn) => {
        btn.classList.toggle("selected", btn.dataset.value === select.value);
      });
    };

    Array.from(select.options).forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "inner-pagination-option";
      btn.dataset.value = opt.value;
      btn.textContent = opt.textContent.trim();
      btn.setAttribute("role", "option");

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        select.value = opt.value;
        syncPicker();
        wrap.classList.remove("active");
        trigger.setAttribute("aria-expanded", "false");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      optionsEl.appendChild(btn);
    });

    const closePicker = () => {
      wrap.classList.remove("active");
      trigger.setAttribute("aria-expanded", "false");
    };

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = !wrap.classList.contains("active");
      wrap.classList.toggle("active", willOpen);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    document.addEventListener("click", (event) => {
      if (!wrap.contains(event.target)) closePicker();
    });

    wrap.append(trigger, optionsEl);
    syncPicker();

    return { syncPicker };
  };

  document.querySelectorAll("[box-pagination]").forEach((select) => {
    const picker = initPaginationPicker(select);
    const url = new URL(window.location.href);

    select.addEventListener("change", () => {
      const value = select.value;
      if (value) {
        url.searchParams.set("page", value);
      } else {
        url.searchParams.delete("page");
      }
      window.location.href = url.href;
    });

    const valueCurrent = url.searchParams.get("page");
    if (valueCurrent) {
      select.value = valueCurrent;
    }
    picker?.syncPicker();
  });
})();
// End Box Pagination

// Guest picker: xem public/assets/js/hotel-guest-picker.js

// ===============================
// Hotel Search Top - Date Validation & Auto-Set Min Dates
// ===============================
(function() {
  const checkInInput = document.getElementById('checkInDateTop');
  const checkOutInput = document.getElementById('checkOutDateTop');
  
  if (!checkInInput || !checkOutInput) return;
  
  // Set min date for check-in to today
  const today = new Date().toISOString().split('T')[0];
  checkInInput.setAttribute('min', today);
  
  // If check-in is not set, set it to today
  if (!checkInInput.value) {
    checkInInput.value = today;
  }
  
  // Update check-out min date when check-in changes
  checkInInput.addEventListener('change', function() {
    const checkInDate = this.value;
    if (checkInDate) {
      // Set min check-out to day after check-in
      const checkInDateTime = new Date(checkInDate);
      checkInDateTime.setDate(checkInDateTime.getDate() + 1);
      const minCheckOut = checkInDateTime.toISOString().split('T')[0];
      checkOutInput.setAttribute('min', minCheckOut);
      
      // If check-out is before check-in, auto-set check-out
      if (!checkOutInput.value || checkOutInput.value <= checkInDate) {
        checkOutInput.value = minCheckOut;
      }
    }
  });
  
  // Trigger change event to set initial check-out min date
  if (checkInInput.value) {
    checkInInput.dispatchEvent(new Event('change'));
  } else {
    // If no check-in date, set check-out to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    checkOutInput.setAttribute('min', tomorrow.toISOString().split('T')[0]);
    if (!checkOutInput.value) {
      checkOutInput.value = tomorrow.toISOString().split('T')[0];
    }
  }
  
  // Validate check-out is after check-in on change
  checkOutInput.addEventListener('change', function() {
    const checkInDate = checkInInput.value;
    const checkOutDate = this.value;
    
    if (checkInDate && checkOutDate && checkOutDate <= checkInDate) {
      // Auto-correct: set check-out to day after check-in
      const checkInDateTime = new Date(checkInDate);
      checkInDateTime.setDate(checkInDateTime.getDate() + 1);
      this.value = checkInDateTime.toISOString().split('T')[0];
    }
  });
})();

document.addEventListener("DOMContentLoaded", function () {
  const boxes = document.querySelectorAll(".inner-countdown[data-expire]");
  if (!boxes.length) return;

  function updateAll() {
    const now = Date.now();

    boxes.forEach((box) => {
      const expireStr = box.getAttribute("data-expire");
      const expireMs = Date.parse(expireStr);
      if (!expireMs || isNaN(expireMs)) return;

      let diff = Math.floor((expireMs - now) / 1000);
      if (diff < 0) diff = 0;

      const days = Math.floor(diff / (24 * 3600));
      diff %= 24 * 3600;
      const hours = Math.floor(diff / 3600);
      diff %= 3600;
      const minutes = Math.floor(diff / 60);
      const seconds = diff % 60;

      const pad = (n) => String(n).padStart(2, "0");

      const elDays = box.querySelector('[data-role="days"]');
      const elHours = box.querySelector('[data-role="hours"]');
      const elMinutes = box.querySelector('[data-role="minutes"]');
      const elSeconds = box.querySelector('[data-role="seconds"]');

      if (elDays) elDays.textContent = pad(days);
      if (elHours) elHours.textContent = pad(hours);
      if (elMinutes) elMinutes.textContent = pad(minutes);
      if (elSeconds) elSeconds.textContent = pad(seconds);
    });
  }

  updateAll();
  setInterval(updateAll, 1000);
});

// ===============================
// Accordion địa điểm trong tour (cho phép mở nhiều thẻ)
// ===============================
(() => {
  const items = document.querySelectorAll(".dest-accordion-item");
  if (!items.length) return;

  items.forEach((item) => {
    const header = item.querySelector(".dest-accordion-header");
    if (!header) return;

    header.addEventListener("click", () => {
      // Chỉ toggle chính item này, không đụng đến item khác
      item.classList.toggle("is-open");
    });
  });
})();

// ===============================
// Tour Compare Feature
// ===============================
const COMPARE_STORAGE_KEY_BASE = "tour_compare_list";
const MAX_COMPARE_ITEMS = 4;

// Lấy key localStorage dựa trên userId
function getCompareStorageKey() {
  const userId = window.currentUserId;
  if (userId) {
    return `${COMPARE_STORAGE_KEY_BASE}_${userId}`;
  }
  // Nếu chưa đăng nhập, dùng key mặc định (sẽ migrate sau khi đăng nhập)
  return COMPARE_STORAGE_KEY_BASE;
}

// Lấy danh sách tour so sánh từ localStorage
function getCompareList() {
  try {
    const key = getCompareStorageKey();
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

// Lưu danh sách tour so sánh vào localStorage
function saveCompareList(list) {
  try {
    const key = getCompareStorageKey();
    localStorage.setItem(key, JSON.stringify(list));
    updateCompareBadge();
  } catch (e) {
    console.error("Error saving compare list:", e);
  }
}

// Migrate dữ liệu so sánh tour từ key cũ (không có userId) sang key mới (có userId)
// Chỉ migrate một lần khi đăng nhập
function migrateCompareListIfNeeded() {
  const userId = window.currentUserId;
  if (!userId) return; // Chưa đăng nhập thì không migrate
  
  const oldKey = COMPARE_STORAGE_KEY_BASE;
  const newKey = `${COMPARE_STORAGE_KEY_BASE}_${userId}`;
  
  try {
    // Kiểm tra xem đã migrate chưa (nếu key mới đã có dữ liệu thì không migrate)
    const newData = localStorage.getItem(newKey);
    if (newData) return; // Đã có dữ liệu mới, không cần migrate
    
    // Lấy dữ liệu từ key cũ
    const oldData = localStorage.getItem(oldKey);
    if (oldData) {
      // Migrate sang key mới
      localStorage.setItem(newKey, oldData);
      // Xóa key cũ
      localStorage.removeItem(oldKey);
      console.log("Đã migrate dữ liệu so sánh tour sang key mới cho user:", userId);
    }
  } catch (e) {
    console.error("Lỗi khi migrate dữ liệu so sánh tour:", e);
  }
}

// Thêm tour vào danh sách so sánh
function addToCompare(tourData) {
  const list = getCompareList();
  
  // Kiểm tra tour đã tồn tại chưa
  const exists = list.find((item) => item._id === tourData._id);
  if (exists) {
    notify && notify.warning("Tour này đã có trong danh sách so sánh!");
    return false;
  }

  // Kiểm tra số lượng tối đa
  if (list.length >= MAX_COMPARE_ITEMS) {
    notify && notify.warning(`Chỉ có thể so sánh tối đa ${MAX_COMPARE_ITEMS} tour!`);
    return false;
  }

  // Thêm tour mới
  list.push(tourData);
  saveCompareList(list);
  notify && notify.success("Đã thêm tour vào danh sách so sánh!");
  return true;
}

// Xóa tour khỏi danh sách so sánh
function removeFromCompare(tourId) {
  const list = getCompareList();
  const filtered = list.filter((item) => item._id !== tourId);
  saveCompareList(filtered);
  notify && notify.success("Đã xóa tour khỏi danh sách so sánh!");
  
  // Cập nhật trạng thái nút so sánh trên trang hiện tại
  const btn = document.querySelector(`.inner-compare-btn[data-tour-id="${tourId}"]`);
  if (btn) {
    updateCompareButtonState(btn, false);
  }
  
  // Nếu đang ở trang so sánh, cập nhật URL với danh sách mới (không tạo history entry mới)
  if (window.location.pathname === '/tour/compare') {
    if (filtered.length > 0) {
      const tourIds = filtered.map((tour) => tour._id).join(',');
      const newUrl = `/tour/compare?ids=${tourIds}`;
      // Sử dụng replaceState để không tạo history entry mới
      window.history.replaceState({}, '', newUrl);
      // Reload trang để cập nhật nội dung
      window.location.reload();
    } else {
      // Nếu không còn tour nào, chuyển về trang so sánh rỗng
      window.history.replaceState({}, '', '/tour/compare');
      window.location.reload();
    }
  }
  
  return filtered;
}

// Xóa tất cả tour khỏi danh sách so sánh
function clearCompareList() {
  saveCompareList([]);
  notify && notify.success("Đã xóa tất cả tour khỏi danh sách so sánh!");
}

// Xóa tất cả và redirect về trang so sánh rỗng
function clearCompareListAndRedirect() {
  clearCompareList();
  if (window.location.pathname === '/tour/compare') {
    // Sử dụng replaceState để không tạo history entry mới
    window.history.replaceState({}, '', '/tour/compare');
    window.location.reload();
  }
}

// Cập nhật badge số lượng tour so sánh (giữ lại để tương thích)
function updateCompareBadge() {
  updateCompareDropdown();
}

// Xử lý click nút so sánh trên product item
const compareButtons = document.querySelectorAll(".inner-compare-btn");
compareButtons.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const tourId = btn.getAttribute("data-tour-id");
    if (!tourId) {
      console.error("Tour ID not found");
      return;
    }

    const tourIdStr = String(tourId).trim();
    const compareList = getCompareList();
    const isAlreadyInList = compareList.some((item) => item._id === tourIdStr);

    // Nếu tour đã có trong danh sách, xóa khỏi danh sách
    if (isAlreadyInList) {
      removeFromCompare(tourIdStr);
      updateCompareButtonState(btn, false);
      return;
    }

    // Nếu chưa có, thêm vào danh sách
    const tourData = {
      _id: tourIdStr,
      name: btn.getAttribute("data-tour-name") || "",
      slug: btn.getAttribute("data-tour-slug") || "",
      avatar: btn.getAttribute("data-tour-avatar") || "",
      priceNewAdult: Number(btn.getAttribute("data-tour-price") || 0),
      priceAdult: Number(btn.getAttribute("data-tour-price-old") || 0),
      discount: Number(btn.getAttribute("data-tour-discount") || 0),
    };

    try {
      const companyData = btn.getAttribute("data-tour-company");
      if (companyData) {
        tourData.company = JSON.parse(companyData);
      }
    } catch (e) {
      console.error("Error parsing company data:", e);
    }

    if (addToCompare(tourData)) {
      // Cập nhật trạng thái nút thành "Đang so sánh"
      updateCompareButtonState(btn, true);
    }
  });
});

// Cập nhật badge và dropdown khi trang load
updateCompareDropdown();

// Cập nhật trạng thái các nút so sánh khi trang load
function updateAllCompareButtons() {
  const compareButtons = document.querySelectorAll(".inner-compare-btn");
  const compareList = getCompareList();
  const compareIds = new Set(compareList.map((tour) => tour._id));

  compareButtons.forEach((btn) => {
    const tourId = btn.getAttribute("data-tour-id");
    if (tourId && compareIds.has(String(tourId).trim())) {
      updateCompareButtonState(btn, true);
    } else {
      updateCompareButtonState(btn, false);
    }
  });
}

// Cập nhật trạng thái của một nút so sánh
function updateCompareButtonState(btn, isInCompare) {
  if (!btn) return;

  const icon = btn.querySelector("i");
  const textSpan = btn.querySelector("span.compare-btn-text");

  if (isInCompare) {
    btn.classList.add("is-comparing");
    btn.setAttribute("title", "Đã thêm vào danh sách so sánh");
    if (icon) {
      icon.className = "fa-solid fa-check";
    }
    if (textSpan) {
      textSpan.textContent = " Đang so sánh";
    }
    btn.style.backgroundColor = "var(--color-primary)";
    btn.style.color = "white";
  } else {
    btn.classList.remove("is-comparing");
    btn.setAttribute("title", "So sánh tour");
    if (icon) {
      icon.className = "fa-solid fa-code-compare";
    }
    if (textSpan) {
      textSpan.textContent = " So sánh";
    }
    btn.style.backgroundColor = "";
    btn.style.color = "";
  }
}

// Cập nhật tất cả nút so sánh khi trang load
updateAllCompareButtons();

// ====== HOTEL COMPARE FUNCTIONS ======
// Lấy danh sách hotel so sánh từ localStorage
function getHotelCompareList() {
  try {
    const stored = localStorage.getItem("hotel_compare_list");
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

// Lưu danh sách hotel compare vào localStorage
function saveHotelCompareList(list) {
  try {
    localStorage.setItem("hotel_compare_list", JSON.stringify(list));
    return true;
  } catch (e) {
    console.error("Error saving hotel compare list:", e);
    return false;
  }
}

// Thêm hotel vào danh sách so sánh
function addToHotelCompare(hotelData) {
  try {
    let compareList = getHotelCompareList();
    
    // Kiểm tra nếu đã có trong danh sách
    const existingIndex = compareList.findIndex((h) => h._id === hotelData._id);
    if (existingIndex !== -1) {
      if (typeof notify !== "undefined" && notify) {
        notify.warning("Khách sạn này đã có trong danh sách so sánh!");
      }
      return false;
    }
    
    // Giới hạn tối đa 4 hotels
    if (compareList.length >= 4) {
      if (typeof notify !== "undefined" && notify) {
        notify.warning("Chỉ có thể so sánh tối đa 4 khách sạn!");
      }
      return false;
    }
    
    compareList.push(hotelData);
    saveHotelCompareList(compareList);
    updateCompareDropdown();
    
    if (typeof notify !== "undefined" && notify) {
      notify.success(`Đã thêm "${hotelData.name}" vào danh sách so sánh`);
    }
    
    return true;
  } catch (e) {
    console.error("Error adding to hotel compare:", e);
    return false;
  }
}

// Xóa hotel khỏi danh sách so sánh
function removeFromHotelCompare(hotelId) {
  try {
    let compareList = getHotelCompareList();
    const originalLength = compareList.length;
    
    compareList = compareList.filter((h) => h._id !== String(hotelId).trim());
    
    if (compareList.length < originalLength) {
      saveHotelCompareList(compareList);
      updateCompareDropdown();
      updateAllHotelCompareButtons();
      
      if (typeof notify !== "undefined" && notify) {
        notify.success("Đã xóa khỏi danh sách so sánh");
      }
      return true;
    }
    return false;
  } catch (e) {
    console.error("Error removing from hotel compare:", e);
    return false;
  }
}

// Xóa tất cả hotels khỏi danh sách so sánh
function clearHotelCompareList() {
  try {
    localStorage.removeItem("hotel_compare_list");
    updateCompareDropdown();
    updateAllHotelCompareButtons();
    return true;
  } catch (e) {
    console.error("Error clearing hotel compare list:", e);
    return false;
  }
}

// Cập nhật số lượng trong dropdown
function updateCompareDropdown() {
  const toursList = getCompareList();
  const hotelsList = getHotelCompareList();
  
  const toursCount = toursList.length;
  const hotelsCount = hotelsList.length;
  
  // Cập nhật tổng số trong badge chính
  const totalCount = toursCount + hotelsCount;
  const mainBadge = document.querySelector(".box-compare-count");
  if (mainBadge) {
    if (totalCount > 0) {
      mainBadge.textContent = totalCount;
      mainBadge.style.display = "flex";
    } else {
      mainBadge.textContent = "";
      mainBadge.style.display = "none";
    }
  }
  
  // Cập nhật số lượng trong dropdown
  const toursCountEl = document.querySelector('[data-count-type="tours"]');
  const hotelsCountEl = document.querySelector('[data-count-type="hotels"]');
  
  if (toursCountEl) {
    if (toursCount > 0) {
      toursCountEl.textContent = toursCount;
      toursCountEl.style.display = "inline-block";
    } else {
      toursCountEl.textContent = "";
      toursCountEl.style.display = "none";
    }
  }
  
  if (hotelsCountEl) {
    if (hotelsCount > 0) {
      hotelsCountEl.textContent = hotelsCount;
      hotelsCountEl.style.display = "inline-block";
    } else {
      hotelsCountEl.textContent = "";
      hotelsCountEl.style.display = "none";
    }
  }
}

// Xử lý click vào box-compare trigger để hiển thị dropdown
const boxCompareTrigger = document.querySelector(".box-compare-trigger");
const boxCompare = document.querySelector(".box-compare");

if (boxCompareTrigger && boxCompare) {
  boxCompareTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    boxCompare.classList.toggle("active");
    updateCompareDropdown();
  });
  
  // Đóng dropdown khi click ra ngoài
  document.addEventListener("click", (e) => {
    if (!boxCompare.contains(e.target)) {
      boxCompare.classList.remove("active");
    }
  });
}

// Xử lý click vào "So sánh Tours"
const toursCompareItem = document.querySelector(".box-compare-dropdown__item--tours");
if (toursCompareItem) {
  toursCompareItem.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const list = getCompareList();
    if (list.length === 0) {
      if (typeof notify !== "undefined" && notify) {
        notify.warning("Chưa có tour nào trong danh sách so sánh!");
      } else {
        alert("Chưa có tour nào trong danh sách so sánh!");
      }
      boxCompare.classList.remove("active");
      return;
    }

    // Tạo URL với danh sách tour IDs
    const tourIds = list.map((tour) => tour._id).join(",");
    window.location.href = `/tour/compare?ids=${tourIds}`;
  });
}

// Xử lý click vào "So sánh Khách sạn"
const hotelsCompareItem = document.querySelector(".box-compare-dropdown__item--hotels");
if (hotelsCompareItem) {
  hotelsCompareItem.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const list = getHotelCompareList();
    if (list.length === 0) {
      if (typeof notify !== "undefined" && notify) {
        notify.warning("Chưa có khách sạn nào trong danh sách so sánh!");
      } else {
        alert("Chưa có khách sạn nào trong danh sách so sánh!");
      }
      boxCompare.classList.remove("active");
      return;
    }

    // Tạo URL với danh sách hotel IDs
    const hotelIds = list.map((hotel) => hotel._id).join(",");
    window.location.href = `/hotel/compare?ids=${hotelIds}`;
  });
}

// Xử lý click nút so sánh trên hotel card
const hotelCompareButtons = document.querySelectorAll(".hotel-compare-btn");
hotelCompareButtons.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const hotelId = btn.getAttribute("data-hotel-id");
    if (!hotelId) {
      console.error("Hotel ID not found");
      return;
    }

    const hotelIdStr = String(hotelId).trim();
    const compareList = getHotelCompareList();
    const isAlreadyInList = compareList.some((item) => item._id === hotelIdStr);

    // Nếu hotel đã có trong danh sách, xóa khỏi danh sách
    if (isAlreadyInList) {
      removeFromHotelCompare(hotelIdStr);
      updateHotelCompareButtonState(btn, false);
      return;
    }

    // Nếu chưa có, thêm vào danh sách
    const hotelData = {
      _id: hotelIdStr,
      name: btn.getAttribute("data-hotel-name") || "",
      slug: btn.getAttribute("data-hotel-slug") || "",
      avatar: btn.getAttribute("data-hotel-avatar") || "",
      pricePerNight: Number(btn.getAttribute("data-hotel-price") || 0),
      cityName: btn.getAttribute("data-hotel-city") || "",
      address: btn.getAttribute("data-hotel-address") || "",
      rating: Number(btn.getAttribute("data-hotel-rating") || 0),
      starRating: Number(btn.getAttribute("data-hotel-star") || 0),
      companyName: btn.getAttribute("data-hotel-company") || "",
    };

    if (addToHotelCompare(hotelData)) {
      // Cập nhật trạng thái nút thành "Đang so sánh"
      updateHotelCompareButtonState(btn, true);
    }
  });
});

// Cập nhật trạng thái của một nút so sánh hotel
function updateHotelCompareButtonState(btn, isInCompare) {
  if (!btn) return;

  const icon = btn.querySelector("i");
  const textSpan = btn.querySelector("span.compare-btn-text");

  if (isInCompare) {
    btn.classList.add("is-comparing");
    btn.setAttribute("title", "Đã thêm vào danh sách so sánh");
    if (icon) {
      icon.className = "fa-solid fa-check";
    }
    if (textSpan) {
      textSpan.textContent = " Đang so sánh";
    }
  } else {
    btn.classList.remove("is-comparing");
    btn.setAttribute("title", "So sánh khách sạn");
    if (icon) {
      icon.className = "fa-solid fa-code-compare";
    }
    if (textSpan) {
      textSpan.textContent = " So sánh";
    }
  }
}

// Cập nhật tất cả nút so sánh hotel khi trang load
function updateAllHotelCompareButtons() {
  const hotelCompareButtons = document.querySelectorAll(".hotel-compare-btn");
  const compareList = getHotelCompareList();
  const compareIds = new Set(compareList.map((hotel) => hotel._id));

  hotelCompareButtons.forEach((btn) => {
    const hotelId = btn.getAttribute("data-hotel-id");
    if (hotelId && compareIds.has(String(hotelId).trim())) {
      updateHotelCompareButtonState(btn, true);
    } else {
      updateHotelCompareButtonState(btn, false);
    }
  });
}

// Cập nhật trạng thái các nút so sánh hotel khi trang load
updateAllHotelCompareButtons();

// Export functions để có thể dùng trong onclick
window.removeFromCompare = removeFromCompare;
window.clearCompareList = clearCompareList;
window.clearCompareListAndRedirect = clearCompareListAndRedirect;

// Migrate dữ liệu so sánh tour khi trang load (nếu có user đăng nhập)
document.addEventListener('DOMContentLoaded', function() {
  migrateCompareListIfNeeded();
  // Cập nhật badge sau khi migrate
  updateCompareBadge();
});
// End Tour Compare Feature
