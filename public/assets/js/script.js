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
  const seatBabyCheckbox = boxTourDetail.querySelector("[seat-baby-toggle]");

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

  let babyRules = [];
  try {
    const raw = boxTourDetail.dataset.babyRules || "[]";
    babyRules = JSON.parse(raw);
    if (!Array.isArray(babyRules)) babyRules = [];
  } catch {
    babyRules = [];
  }

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

  // ======== VẼ LẠI HỘP CHI TIẾT ========
  function drawBoxDetail(changedInput = null) {
    let adult = parseInt(inputAdult?.value) || 0;
    let child = parseInt(inputChild?.value) || 0;
    let baby = parseInt(inputBaby?.value) || 0;

    adult = Math.max(0, adult);
    child = Math.max(0, child);
    baby = Math.max(0, baby);

    const includeBabySeat = seatBabyCheckbox && seatBabyCheckbox.checked; // true nếu đã tick "đặt chỗ riêng"

    // ----- RÀNG BUỘC GHẾ -----
    if (maxSeats > 0) {
      let usedSeats = adult + child + (includeBabySeat ? baby : 0);

      if (usedSeats > maxSeats) {
        notify?.error?.(
          `Tổng số ghế sử dụng không được vượt quá ${maxSeats} chỗ còn lại!`
        );

        if (changedInput === inputAdult) {
          const other = child + (includeBabySeat ? baby : 0);
          adult = Math.max(0, maxSeats - other);
          inputAdult.value = adult;
        } else if (changedInput === inputChild) {
          const other = adult + (includeBabySeat ? baby : 0);
          child = Math.max(0, maxSeats - other);
          inputChild.value = child;
        } else if (includeBabySeat && changedInput === inputBaby) {
          const other = adult + child;
          baby = Math.max(0, maxSeats - other);
          inputBaby.value = baby;
        } else { // không phải là inputAdult, inputChild, inputBaby, 
          let overflow = usedSeats - maxSeats;
          if (includeBabySeat && baby > 0 && overflow > 0) {
            const dec = Math.min(baby, overflow);
            baby -= dec;
            overflow -= dec;
            inputBaby.value = baby;
          }
          if (child > 0 && overflow > 0) {
            const dec = Math.min(child, overflow);
            child -= dec;
            overflow -= dec;
            inputChild.value = child;
          }
          if (adult > 0 && overflow > 0) {
            const dec = Math.min(adult, overflow);
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

    const totalPrice =
      adult * priceAdultBase + child * priceChildBase + babyTotal;
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
  });
  if (seatBabyCheckbox) {
    seatBabyCheckbox.addEventListener("change", () => drawBoxDetail(null));
  }

  // === NHẬP TUỔI TỪNG TRẺ EM / EM BÉ ===
  const ageWrapper       = boxTourDetail.querySelector(".age-inputs-wrapper");
  const childrenGroup    = boxTourDetail.querySelector("#children-ages-group");
  const childrenAgesList = boxTourDetail.querySelector("#children-ages-list");
  const babiesGroup      = boxTourDetail.querySelector("#babies-ages-group");
  const babiesAgesList   = boxTourDetail.querySelector("#babies-ages-list");

  function renderAgeRows(container, count, min, max, labelPrefix, existingAges) {
    if (!container) return;
    // Giữ lại các giá trị hiện tại trước khi render lại
    const current = [];
    container.querySelectorAll(".age-input-row input").forEach(inp => {
      current.push(parseInt(inp.value, 10) || min);
    });
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const val = (existingAges && existingAges[i] !== undefined)
        ? existingAges[i]
        : (current[i] !== undefined ? current[i] : min);
      const row = document.createElement("div");
      row.className = "age-input-row";
      row.innerHTML = `
        <label class="age-input-label">${labelPrefix} thứ ${i + 1}:</label>
        <input class="age-input-field" type="number" min="${min}" max="${max}" value="${val}" required>
        <span class="age-input-hint">${min}–${max} tuổi</span>
      `;
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
      const babySeat = seatBabyCheckbox ? !!seatBabyCheckbox.checked : false;

      // Yêu cầu chọn ngày khởi hành nếu có danh sách
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

      if (quantityAdult > 0 || quantityChild > 0 || quantityBaby > 0) {
        // Thu thập tuổi
        const childrenAges = collectAges(childrenAgesList);
        const babyAges     = collectAges(babiesAgesList);

        const item = {
          tourId: tourId,
          quantityAdult,
          quantityChildren: quantityChild,
          quantityBaby,
          checked: true,
          babySeat,
          departureDateDisplay,
          childrenAges,
          babyAges,
          ageBands: { babyMaxAge: agebabyMax, childrenMinAge: ageChildMin, childrenMaxAge: ageChildMax },
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
      if (qaEl) qaEl.value = existItem.quantityAdult || 0;
      if (qcEl) qcEl.value = existItem.quantityChildren || 0;
      if (qbEl) qbEl.value = existItem.quantityBaby || 0;
      if (seatBabyCheckbox) seatBabyCheckbox.checked = !!existItem.babySeat;
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
        `<i class="fa-solid fa-chair" style="opacity:.7;margin-right:5px"></i>` +
        `<span>Số chỗ còn lại:</span> ` +
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

      // Upload CCCD images nếu có
      let cccdImages = [];
      const cccdInput = document.getElementById("cccd-file-input");
      if (cccdInput && cccdInput.files && cccdInput.files.length > 0) {
        const formData = new FormData();
        for (let i = 0; i < cccdInput.files.length; i++) {
          formData.append("files", cccdInput.files[i]);
        }
        try {
          const uploadRes = await fetch("/upload/images", { method: "POST", body: formData });
          const uploadData = await uploadRes.json();
          if (uploadData.success) cccdImages = uploadData.urls;
        } catch (e) {
          notify.error("Lỗi upload ảnh CCCD!");
          return;
        }
      }

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

      if (cart.length > 0) {
        const dataFinal = {
          fullName: fullName,
          phone: phone,
          email: email,
          cccdImages: cccdImages,
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
            if (data.code == "error") {
              notify.error(data.message);
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

  initCccdPreview("cccd-file-input", "cccd-preview");
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

        // cộng tiền chỉ khi item được tick
        if (item.checked) {
          subTotal += qAdult * unitAdult + qChild * unitChild + babyTotal;
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
                  <div>Khởi Hành Tại: <b>${item.cityName}</b></div>
                  <div>Số ghế còn lại: <b>${seatsTotal}</b></div>
                  ${
                    babySeat
                      ? `<div style="font-size:13px;color:#e67e22">Đặt chỗ ngồi riêng cho em bé</div>`
                      : ""
                  }
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
      pageCart.querySelector("[cart-sub-total]").innerHTML =
        subTotal.toLocaleString("vi-VN");
      pageCart.querySelector("[cart-total]").innerHTML =
        total.toLocaleString("vi-VN");

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

          // GHẾ = NL + TE + (EB nếu đã tick “đặt chỗ riêng” khi thêm vào giỏ)
          const babySeat = !!cartData[idx].babySeat;
          let usedSeats = qAdult + qChild + (babySeat ? qBaby : 0);

          if (seatsTotal > 0 && usedSeats > seatsTotal) {
            const overflow = usedSeats - seatsTotal;
            if (fieldName === "quantityBaby" && babySeat && qBaby > 0) {
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
  // Khi rời trang giỏ hàng, nếu đang ở chế độ ĐẶT NGAY thì xoá giỏ tạm
  window.addEventListener("pagehide", () => {
    if (isQuickOrderMode()) clearSessionCart();
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
      trigger.querySelector("i")?.style &&
        (trigger.querySelector("i").style.transform = "rotate(180deg)");
    } else {
      dropdown.removeAttribute("style");
      trigger.querySelector("i")?.style &&
        (trigger.querySelector("i").style.transform = "");
    }
  });

  // Click ra ngoài để đóng
  document.addEventListener("click", () => {
    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      dropdown.removeAttribute("style");
      trigger.querySelector("i")?.style &&
        (trigger.querySelector("i").style.transform = "");
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

// Box Pagination
const boxPagination = document.querySelector("[box-pagination]");
if (boxPagination) {
  const url = new URL(window.location.href);

  boxPagination.addEventListener("change", () => {
    const value = boxPagination.value;
    if (value) {
      url.searchParams.set("page", value);
    } else {
      url.searchParams.delete("page");
    }
    window.location.href = url.href;
  });

  // Hiển thị giá trị mặc định
  const valueCurrent = url.searchParams.get("page");
  if (valueCurrent) {
    boxPagination.value = valueCurrent;
  }
}
// End Box Pagination

(function () {
  const popup = document.getElementById("guestsPopup");
  const btn = document.getElementById("guestBtn");
  const text = document.getElementById("guestText");
  const roomsContainer = document.getElementById("roomsContainer");
  const addRoomBtn = document.getElementById("addRoomBtn");
  const roomsDataInput = document.getElementById("roomsDataInput");
  const roomsInput = document.getElementById("roomsInput");
  const adultsInput = document.getElementById("adultsInput");
  const childrenInput = document.getElementById("childrenInput");

  if (!popup || !btn || !text || !roomsContainer) return;

  // Parse dữ liệu từ URL query hoặc khởi tạo mặc định
  function parseRoomsFromQuery() {
    try {
      const url = new URL(window.location.href);
      const roomsData = url.searchParams.get("roomsData");
      if (roomsData) {
        return JSON.parse(decodeURIComponent(roomsData));
      }
    } catch (e) {
      console.warn("Failed to parse roomsData from URL", e);
    }
    
    // Fallback: parse từ query params cũ (rooms, adults, children)
    const url = new URL(window.location.href);
    const rooms = parseInt(url.searchParams.get("rooms") || "1", 10);
    const adults = parseInt(url.searchParams.get("adults") || "1", 10);
    const children = parseInt(url.searchParams.get("children") || "0", 10);
    
    // Tạo 1 phòng với dữ liệu cũ
    const room = {
      adults: adults,
      children: [],
    };
    
    // Thêm trẻ em với độ tuổi mặc định (nếu có)
    for (let i = 0; i < children; i++) {
      room.children.push({ age: 4 }); // Độ tuổi mặc định
    }
    
    // Tạo mảng phòng (có thể có nhiều phòng nhưng chỉ có dữ liệu cho phòng đầu)
    const result = [room];
    for (let i = 1; i < rooms; i++) {
      result.push({ adults: 1, children: [] });
    }
    
    return result;
  }

  let roomsData = parseRoomsFromQuery();

  // Render một phòng
  function renderRoom(roomIndex, room) {
    const roomId = `room-${roomIndex}`;
    const childrenHtml = room.children.map((child, childIndex) => {
      const childId = `${roomId}-child-${childIndex}`;
      return `
        <div class="guests-popup__child-item" data-child-index="${childIndex}">
          <div class="guests-popup__left">
            <strong>Trẻ ${childIndex + 1}</strong>
          </div>
          <div class="guests-popup__right">
            <div class="guests-popup__age-selector">
              <button type="button" class="guests-popup__age-btn" data-room="${roomIndex}" data-child="${childIndex}">
                <span class="guests-popup__age-display">${child.age === 0 ? "Dưới 1" : child.age}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="guests-popup__age-dropdown" style="display: none;">
                ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
                  .map(age => `<div class="guests-popup__age-option ${age === child.age ? 'active' : ''}" data-age="${age}">${age === 0 ? "Dưới 1" : age}</div>`)
                  .join("")}
              </div>
            </div>
            <button type="button" class="guests-popup__btn guests-popup__btn--remove-child" data-room="${roomIndex}" data-child="${childIndex}">×</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="guests-popup__room" data-room-index="${roomIndex}">
        <div class="guests-popup__room-header">
          <strong>Phòng ${roomIndex + 1}</strong>
          ${roomIndex > 0 ? `<button type="button" class="guests-popup__btn--remove-room" data-room="${roomIndex}">×</button>` : ""}
        </div>
        <div class="guests-popup__row">
          <div class="guests-popup__left">
            <strong>Người lớn</strong>
          </div>
          <div class="guests-popup__right">
            <button type="button" class="guests-popup__btn" data-room="${roomIndex}" data-type="adults" data-action="dec">−</button>
            <input type="text" class="guests-popup__input" value="${room.adults}" readonly data-room="${roomIndex}" data-type="adults">
            <button type="button" class="guests-popup__btn" data-room="${roomIndex}" data-type="adults" data-action="inc">+</button>
          </div>
        </div>
        <div class="guests-popup__row">
          <div class="guests-popup__left">
            <strong>Trẻ em</strong>
            <small>Tuổi từ 0 đến 17</small>
          </div>
          <div class="guests-popup__right">
            <button type="button" class="guests-popup__btn" data-room="${roomIndex}" data-type="children" data-action="dec">−</button>
            <input type="text" class="guests-popup__input" value="${room.children.length}" readonly data-room="${roomIndex}" data-type="children">
            <button type="button" class="guests-popup__btn" data-room="${roomIndex}" data-type="children" data-action="inc">+</button>
          </div>
        </div>
        <div class="guests-popup__children-list">
          ${childrenHtml}
        </div>
      </div>
    `;
  }

  // Render tất cả phòng
  function renderRooms() {
    roomsContainer.innerHTML = roomsData.map((room, index) => renderRoom(index, room)).join("");
    updateSummary();
    updateHiddenInputs();
  }

  // Cập nhật summary text
  function updateSummary() {
    const totalRooms = roomsData.length;
    const totalAdults = roomsData.reduce((sum, r) => sum + r.adults, 0);
    const totalChildren = roomsData.reduce((sum, r) => sum + r.children.length, 0);
    
    text.textContent = `${totalRooms} phòng - ${totalAdults} người lớn${totalChildren > 0 ? ` - ${totalChildren} trẻ em` : ""}`;
  }

  // Cập nhật hidden inputs
  function updateHiddenInputs() {
    const totalRooms = roomsData.length;
    const totalAdults = roomsData.reduce((sum, r) => sum + r.adults, 0);
    const totalChildren = roomsData.reduce((sum, r) => sum + r.children.length, 0);
    
    if (roomsInput) roomsInput.value = String(totalRooms);
    if (adultsInput) adultsInput.value = String(totalAdults);
    if (childrenInput) childrenInput.value = String(totalChildren);
    if (roomsDataInput) roomsDataInput.value = encodeURIComponent(JSON.stringify(roomsData));
  }

  // Thay đổi số lượng (adults hoặc children count)
  function changeQuantity(roomIndex, type, delta) {
    const room = roomsData[roomIndex];
    if (!room) return;
    
    if (type === "adults") {
      room.adults = Math.max(1, room.adults + delta);
    } else if (type === "children") {
      const currentCount = room.children.length;
      const newCount = Math.max(0, currentCount + delta);
      
      if (newCount > currentCount) {
        // Thêm trẻ em mới với độ tuổi mặc định
        for (let i = currentCount; i < newCount; i++) {
          room.children.push({ age: 4 });
        }
      } else if (newCount < currentCount) {
        // Xóa trẻ em cuối cùng
        room.children = room.children.slice(0, newCount);
      }
    }
    
    renderRooms();
  }

  // Thêm phòng mới
  function addRoom() {
    roomsData.push({ adults: 1, children: [] });
    renderRooms();
  }

  // Xóa phòng
  function removeRoom(roomIndex) {
    if (roomIndex === 0 || roomsData.length <= 1) return; // Không cho xóa phòng đầu tiên
    roomsData.splice(roomIndex, 1);
    renderRooms();
  }

  // Xóa trẻ em
  function removeChild(roomIndex, childIndex) {
    const room = roomsData[roomIndex];
    if (!room) return;
    room.children.splice(childIndex, 1);
    renderRooms();
  }

  // Thay đổi độ tuổi trẻ em
  function changeChildAge(roomIndex, childIndex, age) {
    const room = roomsData[roomIndex];
    if (!room || !room.children[childIndex]) return;
    room.children[childIndex].age = age;
    renderRooms();
  }

  // Xử lý click events
  popup.addEventListener("click", (e) => {
    // Ngăn event bubble lên để không đóng popup
    e.stopPropagation();
    
    // Nút tăng/giảm số lượng
    const qtyBtn = e.target.closest("button.guests-popup__btn[data-type]");
    if (qtyBtn && !qtyBtn.classList.contains("guests-popup__btn--remove-room") && !qtyBtn.classList.contains("guests-popup__btn--remove-child")) {
      const roomIndex = parseInt(qtyBtn.dataset.room, 10);
      const type = qtyBtn.dataset.type;
      const action = qtyBtn.dataset.action;
      const delta = action === "inc" ? 1 : -1;
      changeQuantity(roomIndex, type, delta);
      return;
    }

    // Nút xóa phòng
    const removeRoomBtn = e.target.closest("button.guests-popup__btn--remove-room");
    if (removeRoomBtn) {
      const roomIndex = parseInt(removeRoomBtn.dataset.room, 10);
      removeRoom(roomIndex);
      return;
    }

    // Nút xóa trẻ em
    const removeChildBtn = e.target.closest("button.guests-popup__btn--remove-child");
    if (removeChildBtn) {
      const roomIndex = parseInt(removeChildBtn.dataset.room, 10);
      const childIndex = parseInt(removeChildBtn.dataset.child, 10);
      removeChild(roomIndex, childIndex);
      return;
    }

    // Nút chọn độ tuổi
    const ageBtn = e.target.closest("button.guests-popup__age-btn");
    if (ageBtn) {
      const roomIndex = parseInt(ageBtn.dataset.room, 10);
      const childIndex = parseInt(ageBtn.dataset.child, 10);
      const dropdown = ageBtn.nextElementSibling;
      if (dropdown) {
        // Toggle dropdown
        document.querySelectorAll(".guests-popup__age-dropdown").forEach(d => {
          if (d !== dropdown) d.style.display = "none";
        });
        dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
      }
      return;
    }

    // Chọn độ tuổi từ dropdown
    const ageOption = e.target.closest(".guests-popup__age-option");
    if (ageOption) {
      const dropdown = ageOption.closest(".guests-popup__age-dropdown");
      const ageBtn = dropdown?.previousElementSibling;
      if (ageBtn) {
        const roomIndex = parseInt(ageBtn.dataset.room, 10);
        const childIndex = parseInt(ageBtn.dataset.child, 10);
        const age = parseInt(ageOption.dataset.age, 10);
        changeChildAge(roomIndex, childIndex, age);
        dropdown.style.display = "none";
      }
      return;
    }
  });

  // Đóng dropdown khi click ra ngoài (nhưng không đóng popup)
  document.addEventListener("click", (e) => {
    // Chỉ đóng dropdown, không đóng popup
    if (!e.target.closest(".guests-popup__age-selector")) {
      document.querySelectorAll(".guests-popup__age-dropdown").forEach(d => {
        d.style.display = "none";
      });
    }
  });

  // Nút thêm phòng
  if (addRoomBtn) {
    addRoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addRoom();
    });
  }

  // Toggle popup
  function openPopup() {
    btn.setAttribute("aria-expanded", "true");
    popup.setAttribute("aria-hidden", "false");
    popup.classList.add("is-open");
  }
  
  function closePopup() {
    btn.setAttribute("aria-expanded", "false");
    popup.setAttribute("aria-hidden", "true");
    popup.classList.remove("is-open");
  }
  
  function togglePopup() {
    const open = btn.getAttribute("aria-expanded") === "true";
    open ? closePopup() : openPopup();
  }

  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopup();
    });
  }

  // Click ra ngoài thì đóng
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !btn.contains(e.target)) {
      closePopup();
    }
  });

  // ESC để đóng
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopup();
  });

  // Khởi tạo
  renderRooms();
})();

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
