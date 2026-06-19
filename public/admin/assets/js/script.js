// Menu Mobile
const buttonMenuMobile = document.querySelector(".header .inner-button-menu");
if (buttonMenuMobile) {
  const sider = document.querySelector(".sider");
  const siderOverlay = document.querySelector(".sider-overlay");

  buttonMenuMobile.addEventListener("click", () => {
    sider.classList.add("active");
    siderOverlay.classList.add("active");
  });

  siderOverlay.addEventListener("click", () => {
    sider.classList.remove("active");
    siderOverlay.classList.remove("active");
  });
}
// End Menu Mobile

// Schedule Section 8
const scheduleSection8 = document.querySelector(".section-8 .inner-schedule");
if (scheduleSection8) {
  const buttonCreate = scheduleSection8.querySelector(".inner-schedule-create");
  const listItem = scheduleSection8.querySelector(".inner-schedule-list");

  buttonCreate.addEventListener("click", () => {
    const firstItem = listItem.querySelector(".inner-schedule-item");
    const cloneItem = firstItem.cloneNode(true);
    cloneItem.querySelector(".inner-schedule-head input").value = "";

    const innerBody = cloneItem.querySelector(".inner-schedule-body");
    const id = `mce_${Date.now()}`;
    innerBody.innerHTML = `<textarea id="${id}"></textarea>`;

    listItem.appendChild(cloneItem);

    initTinyMCE(`#${id}`);
  });

  listItem.addEventListener("click", (event) => {
    // Đóng/mở item
    if (event.target.closest(".inner-more")) {
      const parentItem = event.target.closest(".inner-schedule-item");
      if (parentItem) {
        parentItem.classList.toggle("hidden");
      }
    }

    // Xóa item
    if (event.target.closest(".inner-remove")) {
      const parentItem = event.target.closest(".inner-schedule-item");
      const totalItem = listItem.querySelectorAll(
        ".inner-schedule-item"
      ).length;
      if (parentItem && totalItem > 1) {
        parentItem.remove();
      }
    }
  });

  // Sắp xếp
  new Sortable(listItem, {
    handle: ".inner-move",
    animation: 150,
    onStart: (event) => {
      const textarea = event.item.querySelector(
        ".inner-schedule-body textarea"
      );
      const id = textarea.id;
      tinymce.get(id).remove();
    },
    onEnd: (event) => {
      const textarea = event.item.querySelector(
        ".inner-schedule-body textarea"
      );
      const id = textarea.id;
      initTinyMCE(`#${id}`);
    },
  });
}
// End Schedule Section 8

// Filepond Image
const listFilepondImage = document.querySelectorAll("[filepond-image]");
const filePond = {};
if (listFilepondImage.length > 0) {
  FilePond.registerPlugin(FilePondPluginImagePreview);
  FilePond.registerPlugin(FilePondPluginFileValidateType);

  listFilepondImage.forEach((filepondImage) => {
    if (filepondImage.closest('#hotel-edit-form[data-read-only="1"]')) {
      return;
    }
    let files = null;
    const elementImageDefault = filepondImage.closest("[image-default]");
    if (elementImageDefault) {
      const imageDefault = elementImageDefault.getAttribute("image-default");
      if (imageDefault) {
        files = [
          {
            source: imageDefault,
          },
        ];
      }
    }

    filePond[filepondImage.name] = FilePond.create(filepondImage, {
      labelIdle: "+",
      acceptedFileTypes: ["image/*"],
      files: files,
    });
  });
  window.filePond = filePond;
}
// End Filepond Image

// Filepond Image Multi
const listFilepondImageMulti = document.querySelectorAll(
  "[filepond-image-multi]"
);
const filePondMulti = {};
if (listFilepondImageMulti.length > 0) {
  FilePond.registerPlugin(FilePondPluginImagePreview);
  FilePond.registerPlugin(FilePondPluginFileValidateType);

  listFilepondImageMulti.forEach((filepondImage) => {
    if (filepondImage.closest('#hotel-edit-form[data-read-only="1"]')) {
      return;
    }
    let files = null;
    const elementListImageDefault = filepondImage.closest(
      "[list-image-default]"
    );
    if (elementListImageDefault) {
      let listImageDefault =
        elementListImageDefault.getAttribute("list-image-default");
      if (listImageDefault) {
        listImageDefault = JSON.parse(listImageDefault);
        files = [];
        listImageDefault.forEach((image) => {
          files.push({
            source: image,
          });
        });
      }
    }

    filePondMulti[filepondImage.name] = FilePond.create(filepondImage, {
      labelIdle: "+",
      acceptedFileTypes: ["image/*"],
      files: files,
      // Đảm bảo FilePond tự động thêm file vào form khi submit
      allowRevert: false,
      allowRemove: true,
      // Cho phép FilePond tự động thêm file vào form
      storeAsFile: true,
    });
  });
}
// Expose filePondMulti ra window để có thể truy cập từ inline scripts
window.filePondMulti = filePondMulti;
// End Filepond Image Multi

// Revenue Chart
const drawRevenueChart = (currentDate) => {
  // Lấy tháng/năm hiện tại
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  // Lấy tháng/năm trước
  const prevDate = new Date(currentYear, currentDate.getMonth() - 1, 1);
  const prevMonth = prevDate.getMonth() + 1;
  const prevYear = prevDate.getFullYear();

  // Lấy ra số ngày nhiều nhất
  const totalDayCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();
  const totalDayPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
  const totalDayMax =
    totalDayCurrentMonth > totalDayPrevMonth
      ? totalDayCurrentMonth
      : totalDayPrevMonth;
  const arrayDay = [];

  for (let i = 1; i <= totalDayMax; i++) {
    arrayDay.push(i);
  }

  const dataFinal = {
    currentMonth: currentMonth,
    currentYear: currentYear,
    prevMonth: prevMonth,
    prevYear: prevYear,
    arrayDay: arrayDay,
  };

  fetch(`/${pathAdmin}/dashboard/revenue-chart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dataFinal),
  })
    .then((res) => res.json())
    .then((data) => {
      const innerChart = document.querySelector(".section-2 .inner-chart");
      innerChart.innerHTML = `<canvas></canvas>`;
      const canvas = innerChart.querySelector("canvas");
      new Chart(canvas, {
        type: "line",
        data: {
          labels: arrayDay,
          datasets: [
            {
              label: `Tháng ${prevMonth}/${prevYear}`,
              data: data.dataPrevMonth,
              borderColor: "#FE6383",
              borderWidth: 1.5,
            },
            {
              label: `Tháng ${currentMonth}/${currentYear}`,
              data: data.dataCurrentMonth,
              borderColor: "#36A1EA",
              borderWidth: 1.5,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
        },
      });
    });
};

const revenueChart = document.querySelector("#revenue-chart");
if (revenueChart) {
  drawRevenueChart(new Date());

  const inputChangeMonth = document.querySelector("[input-change-month]");
  inputChangeMonth.addEventListener("change", () => {
    drawRevenueChart(new Date(inputChangeMonth.value));
  });
}
// End Revenue Chart

// Category Create Form
const categoryCreateForm = document.querySelector("#super-admin-category-create-form");
if (categoryCreateForm) {
  const validator = new JustValidate("#super-admin-category-create-form");

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên danh mục!",
      },
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const parent = event.target.parent.value;
      const position = event.target.position.value;
      const status = event.target.status.value;
      const avatar = filePond.avatar.getFile()?.file;
      const description = tinymce.get("description").getContent();

      // Tạo FormData
      const formData = new FormData();
      formData.append("name", name);
      formData.append("parent", parent);
      formData.append("position", position);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);

      fetch(`/${pathAdmin}/super-admin/category/create`, {
        method: "POST",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            drawNotify(data.code, data.message);
            window.location.reload();
          }
        });
    });
}
// End Category Create Form

// Super Admin Category Edit Form
const superAdminCategoryEditForm = document.querySelector("#super-admin-category-edit-form");

if (superAdminCategoryEditForm) {
  
  const validator = new JustValidate("#super-admin-category-edit-form");

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên danh mục!",
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const parent = event.target.parent.value;
      const position = event.target.position.value;
      const status = event.target.status.value;
      let avatar = filePond.avatar?.getFile()?.file;
      if (avatar) {
        const elementImageDefault =
          event.target.avatar.closest("[image-default]");
        const imageDefault = elementImageDefault?.getAttribute("image-default");
        if (imageDefault && imageDefault.includes(avatar.name)) {
          avatar = null;
        }
      }
      const description = tinymce.get("description")?.getContent() || "";

      // Tạo FormData
      const formData = new FormData();
      formData.append("name", name);
      formData.append("parent", parent);
      formData.append("position", position);
      formData.append("status", status);
      formData.append("avatar", avatar);
      formData.append("description", description);

      fetch(`/${pathAdmin}/super-admin/category/edit/${id}`, {
        method: "PATCH",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            notify.success(data.message);
          }
        })
    });
}

// End Super Admin Category Edit Form

// Tour Create Form
const tourCreateForm = document.querySelector("#tour-create-form");
function collectTourCategoryIds(formEl) {
  if (!formEl) return [];
  return Array.from(formEl.querySelectorAll('input[name="categories"]:checked'))
    .map((el) => el.value)
    .filter(Boolean);
}

function wireTourCategoryTree(formEl) {
  if (!formEl) return;
  formEl.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || target.name !== "categories") return;

    const allBoxes = Array.from(
      formEl.querySelectorAll('input[name="categories"]')
    );
    const fromIdx = allBoxes.indexOf(target);
    if (fromIdx < 0) return;

    const parentLevel = parseInt(target.dataset.level || "0", 10) || 0;
    const nextChecked = !!target.checked;

    // Chọn/Bỏ chọn danh mục cha -> áp cho toàn bộ danh mục con phía dưới.
    for (let i = fromIdx + 1; i < allBoxes.length; i++) {
      const lvl = parseInt(allBoxes[i].dataset.level || "0", 10) || 0;
      if (lvl <= parentLevel) break;
      allBoxes[i].checked = nextChecked;
    }
  });
}
wireTourCategoryTree(tourCreateForm);

if (tourCreateForm) {
  const validator = new JustValidate("#tour-create-form");

  // ==== CẤU HÌNH GIÁ EM BÉ THEO BẬC ====
  const babyModeSelect = tourCreateForm.querySelector("#babyPricingMode");
  const babyRulesWrapper = document.querySelector(
    "#baby-pricing-rules-wrapper"
  );
  const babyRulesBody = document.querySelector("#baby-rules-body");
  const babyRulesHiddenInput = document.querySelector("#babyPricingRulesJson");

  const priceBabyInput = tourCreateForm.querySelector(
    'input[name="priceBaby"]'
  );
  const priceNewBabyInput = tourCreateForm.querySelector(
    'input[name="priceNewBaby"]'
  );

  // Tạo 1 dòng quy tắc mới
  function createRuleRow(from = "", to = "", percent = "", ref = "children") {
    const row = document.createElement("div");
    row.className = "baby-rule-row";
    row.innerHTML = `
      <div class="baby-rules-cell">
        <input class="rule-from" type="number" min="1" value="${from}">
      </div>
      <div class="baby-rules-cell">
        <input class="rule-to" type="number" min="1"
               placeholder="VD: 2 (hoặc bỏ trống = trở lên)"
               value="${to === "inf" ? "" : to}">
      </div>
      <div class="baby-rules-cell">
        <input class="rule-percent" type="number" min="0" max="100" value="${percent}">
      </div>
      <div class="baby-rules-cell">
        <select class="rule-ref">
          <option value="children" ${
            ref === "children" ? "selected" : ""
          }>Giá Trẻ em</option>
          <option value="adult" ${
            ref === "adult" ? "selected" : ""
          }>Giá Người lớn</option>
        </select>
      </div>
      <div class="baby-rules-cell">
        <button type="button" class="baby-rule-remove type-button">Xóa</button>
      </div>
    `;
    return row;
  }

  // Đọc các dòng quy tắc trong UI -> array rules
  function collectBabyRules() {
    if (!babyRulesBody) return [];
    const rows = babyRulesBody.querySelectorAll(".baby-rule-row");
    const rules = [];
    rows.forEach((row) => {
      const fromEl = row.querySelector(".rule-from");
      const toEl = row.querySelector(".rule-to");
      const percentEl = row.querySelector(".rule-percent");
      const refEl = row.querySelector(".rule-ref");

      const from = Number(fromEl?.value || "");
      const toRaw = toEl?.value || "";
      const percent = Number(percentEl?.value || "");
      const ref = refEl?.value === "adult" ? "adult" : "children";

      if (!Number.isFinite(from)) return;
      let to = "inf";
      if (toRaw !== "") {
        const toNum = Number(toRaw);
        if (!Number.isFinite(toNum)) return;
        to = toNum;
      }
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;

      rules.push({ from, to, percent, ref });
    });
    return rules;
  }

  // Hiển thị/ẩn khối quy tắc + bật/tắt ô giá Em bé
  function syncBabyModeUI() {
    const mode = babyModeSelect?.value || "fixed";
    const isTiered = mode === "tiered";

    if (babyRulesWrapper) {
      babyRulesWrapper.style.display = isTiered ? "block" : "none";
    }

    // Khi theo bậc: xóa và khóa 2 ô giá Em bé
    if (priceBabyInput) {
      if (isTiered) {
        priceBabyInput.value = "";
        priceBabyInput.disabled = true;
      } else {
        priceBabyInput.disabled = false;
      }
    }
    if (priceNewBabyInput) {
      if (isTiered) {
        priceNewBabyInput.value = "";
        priceNewBabyInput.disabled = true;
      } else {
        priceNewBabyInput.disabled = false;
      }
    }
  }

  // Sự kiện thêm / xóa dòng quy tắc
  const addRuleBtn = document.querySelector("#baby-rule-add");
  if (addRuleBtn && babyRulesBody) {
    addRuleBtn.addEventListener("click", () => {
      babyRulesBody.appendChild(createRuleRow());
    });

    babyRulesBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".baby-rule-remove");
      if (btn) {
        const row = btn.closest(".baby-rule-row");
        if (row && babyRulesBody.children.length > 1) {
          row.remove();
        }
      }
    });
  }

  // Gắn event change cho select chế độ
  if (babyModeSelect) {
    babyModeSelect.addEventListener("change", syncBabyModeUI);
    syncBabyModeUI(); // chạy lần đầu
  }
  // ==== HẾT CẤU HÌNH GIÁ EM BÉ THEO BẬC ====

  // ==== THỜI HẠN KHUYẾN MÃI THEO GIÁ CỐ ĐỊNH ====
  const oldAdultInput = tourCreateForm.querySelector("#priceAdult");
  const oldChildrenInput = tourCreateForm.querySelector("#priceChildren");
  const oldBabyInput = tourCreateForm.querySelector("#priceBaby");

  const discountWrapper = tourCreateForm.querySelector(
    "#manual-discount-group"
  );
  const discountFromInput = tourCreateForm.querySelector("#discountFrom");
  const discountToInput = tourCreateForm.querySelector("#discountTo");

  function hasOldPriceCreate() {
    const a = parseInt(oldAdultInput?.value || "0", 10) || 0;
    const c = parseInt(oldChildrenInput?.value || "0", 10) || 0;
    const b = parseInt(oldBabyInput?.value || "0", 10) || 0;
    return a > 0 || c > 0 || b > 0;
  }

  function syncManualDiscountVisibilityCreate() {
    if (!discountWrapper) return;
    if (hasOldPriceCreate()) {
      discountWrapper.style.display = "";
    } else {
      discountWrapper.style.display = "none";
      if (discountFromInput) discountFromInput.value = "";
      if (discountToInput) discountToInput.value = "";
    }
  }

  [oldAdultInput, oldChildrenInput, oldBabyInput].forEach((el) => {
    if (el) el.addEventListener("input", syncManualDiscountVisibilityCreate);
  });

  // chạy 1 lần khi load form
  syncManualDiscountVisibilityCreate();
  // ==== HẾT THỜI HẠN KHUYẾN MÃI THEO GIÁ CỐ ĐỊNH ====

  // ==== ĐỊA ĐIỂM CÓ TRONG TOUR (UI nhiều điểm đến) ====
  const locationsWrapper = tourCreateForm.querySelector(
    "#tour-locations-wrapper"
  );
  const locationAddBtn = tourCreateForm.querySelector("#location-add-btn");
  const categorySelect = tourCreateForm.querySelector("#category");
  const countriesGroup = tourCreateForm.querySelector("#tour-countries-group");
  const vietnamLocationsGroup = tourCreateForm.querySelector("#vietnam-locations-group");
  const countryCheckboxes = tourCreateForm.querySelectorAll(".tour-country-checkbox");

  // Hàm lấy danh sách thành phố của một quốc gia cụ thể
  function getCitiesByCountryId(countryId) {
    if (!countryId) {
      console.log("getCitiesByCountryId: No countryId provided");
      return [];
    }
    const countryIdStr = String(countryId).trim();
    const cities = window.europeanCities || [];
    
    console.log("getCitiesByCountryId - Looking for countryId:", countryIdStr);
    console.log("getCitiesByCountryId - Total cities available:", cities.length);
    if (cities.length > 0) {
      console.log("getCitiesByCountryId - Sample city:", cities[0]);
      console.log("getCitiesByCountryId - Sample city countryId:", cities[0].countryId, "type:", typeof cities[0].countryId);
    }
    
    const filtered = cities.filter((city) => {
      // Kiểm tra nhiều cách lấy countryId
      let cityCountryId = null;
      if (city.countryId) {
        if (typeof city.countryId === 'object' && city.countryId !== null) {
          // Nếu là object, lấy _id
          cityCountryId = city.countryId._id ? String(city.countryId._id).trim() : null;
        } else {
          // Nếu là string hoặc giá trị khác, convert sang string
          cityCountryId = String(city.countryId).trim();
        }
      }
      
      // So sánh (case-insensitive và trim)
      const match = cityCountryId && cityCountryId === countryIdStr;
      if (match) {
        console.log("✓ Matched city:", city.name, "countryId:", cityCountryId, "=== looking for:", countryIdStr);
      }
      return match;
    });
    
    console.log("getCitiesByCountryId - Found cities:", filtered.length);
    if (filtered.length === 0 && cities.length > 0) {
      console.warn("No cities found! Checking first few cities:");
      cities.slice(0, 5).forEach((city, idx) => {
        const cityCountryId = city.countryId ? (typeof city.countryId === 'object' ? String(city.countryId._id || '') : String(city.countryId)) : null;
        console.log(`  City ${idx + 1}: ${city.name}, countryId: ${cityCountryId}, match: ${cityCountryId === countryIdStr}`);
      });
    }
    return filtered;
  }

  // Hàm tạo location item cho quốc gia cụ thể
  function createLocationItemForCountry(countryId) {
    const div = document.createElement("div");
    div.className = "tour-location-item";
    div.setAttribute("data-country-id", countryId);

    const cities = getCitiesByCountryId(countryId);
    console.log("createLocationItemForCountry - countryId:", countryId, "found cities:", cities.length);
    
    let cityOptions = "";
    if (cities.length > 0) {
      cityOptions = cities
        .map(
          (city) =>
            `<option value="${city._id || city.id}">${city.name}</option>`
        )
        .join("");
      console.log("createLocationItemForCountry - cityOptions created, first city:", cities[0].name);
    } else {
      console.warn("createLocationItemForCountry - No cities found for countryId:", countryId);
    }

    div.innerHTML = `
      <div class="inner-input-list">
        <div class="inner-input-item">
          <label>Điểm đến</label>
          <select class="location-city" data-country-id="${countryId}">
            <option value="">-- Chọn thành phố --</option>
            ${cityOptions}
          </select>
        </div>
        <div class="inner-input-item">
          <label>Các địa điểm nổi tiếng</label>
          <div class="location-spots-list">
            <div class="location-spot-item">
              <div class="spot-input-group">
                <textarea class="spot-input" placeholder="VD: Tháp Eiffel" rows="2"></textarea>
                <button type="button" class="spot-remove-btn">Xóa</button>
              </div>
            </div>
          </div>
          <div class="spot-actions">
            <button type="button" class="spot-add-btn">+ Thêm địa điểm</button>
          </div>
        </div>
      </div>
      <div class="location-actions">
        <button type="button" class="location-remove-btn">Xóa điểm đến</button>
      </div>
    `;
    
    // Kiểm tra lại sau khi tạo
    const select = div.querySelector(".location-city");
    console.log("createLocationItemForCountry - Select created with", select?.options.length, "options");
    if (select && select.options.length > 1) {
      console.log("createLocationItemForCountry - First option:", select.options[1].textContent);
    }
    
    return div;
  }

  // Hàm tạo location item cho Việt Nam
  function createLocationItem() {
    const div = document.createElement("div");
    div.className = "tour-location-item";

    const vietnamCities = window.vietnamCities || [];
    const cityOptions = vietnamCities
      .map(
        (city) =>
          `<option value="${city._id || city.id}">${city.name}</option>`
      )
      .join("");

    div.innerHTML = `
      <div class="inner-input-list">
        <div class="inner-input-item">
          <label>Điểm đến</label>
          <select class="location-city">
            <option value="">-- Chọn tỉnh/thành --</option>
            ${cityOptions}
          </select>
        </div>
        <div class="inner-input-item">
          <label>Các địa điểm nổi tiếng</label>
          <div class="location-spots-list">
            <div class="location-spot-item">
              <div class="spot-input-group">
                <textarea class="spot-input" placeholder="VD: Chùa Linh Ứng" rows="2"></textarea>
                <button type="button" class="spot-remove-btn">Xóa</button>
              </div>
            </div>
          </div>
          <div class="spot-actions">
            <button type="button" class="spot-add-btn">+ Thêm địa điểm</button>
          </div>
        </div>
      </div>
      <div class="location-actions">
        <button type="button" class="location-remove-btn">Xóa điểm đến</button>
      </div>
    `;
    return div;
  }

  // Xử lý khi chọn/bỏ chọn quốc gia
  console.log("Tour Create - Found", countryCheckboxes.length, "country checkboxes");
  if (countryCheckboxes.length > 0) {
    countryCheckboxes.forEach((checkbox, idx) => {
      console.log(`Setting up listener for checkbox ${idx + 1}:`, checkbox.value);
      checkbox.addEventListener("change", (e) => {
        const countryId = String(checkbox.value); // Đảm bảo là string
        const countryItem = checkbox.closest(".country-item");
        const locationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
        
        console.log("Country checkbox changed:", {
          countryId: countryId,
          checkboxValue: checkbox.value,
          checked: checkbox.checked,
          countryItem: countryItem,
          locationsWrapper: locationsWrapper
        });
        console.log("window.europeanCities length:", window.europeanCities?.length);
        
        if (checkbox.checked && locationsWrapper) {
          // Hiển thị khối địa điểm của quốc gia
          locationsWrapper.style.display = "";
          
          // Lấy danh sách cities cho quốc gia này
          const cities = getCitiesByCountryId(countryId);
          console.log("Country checkbox checked - countryId:", countryId, "found cities:", cities.length);
          if (cities.length > 0) {
            console.log("First few cities:", cities.slice(0, 3).map(c => c.name));
          }
          
          // Kiểm tra xem đã có location item nào chưa
          const existingItems = locationsWrapper.querySelectorAll(".tour-location-item");
          console.log("Found", existingItems.length, "existing location items");
          
          // Luôn cập nhật tất cả location items (cả mới và cũ)
          existingItems.forEach((item, idx) => {
            const select = item.querySelector(".location-city");
            if (select) {
              const currentValue = select.value;
              console.log(`Updating select ${idx + 1} for countryId: ${countryId}, current value:`, currentValue);
              console.log(`Cities to add:`, cities.length);
              
              // Xóa tất cả options (trừ option đầu tiên)
              while (select.options.length > 1) {
                select.remove(1);
              }
              
              // Thêm các thành phố
              if (cities.length > 0) {
                cities.forEach((city, cityIdx) => {
                  const option = document.createElement("option");
                  option.value = city._id || city.id;
                  option.textContent = city.name;
                  select.appendChild(option);
                  if (cityIdx < 3) {
                    console.log(`  Added city option: ${city.name} (${city._id || city.id})`);
                  }
                });
                console.log(`Select ${idx + 1} updated with`, select.options.length, "options total");
              } else {
                console.warn(`No cities to add for countryId: ${countryId}`);
              }
              
              // Khôi phục giá trị nếu còn tồn tại
              if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
                select.value = currentValue;
              }
            } else {
              console.warn(`No select found in location item ${idx + 1}`);
            }
          });
          
          // Nếu chưa có location item nào, tạo một item mới
          if (existingItems.length === 0) {
            console.log("No existing items, creating new location item");
            const firstItem = createLocationItemForCountry(countryId);
            const locationGlobalActions = locationsWrapper.querySelector(".location-global-actions");
            if (locationGlobalActions) {
              locationsWrapper.insertBefore(firstItem, locationGlobalActions);
            } else {
              locationsWrapper.appendChild(firstItem);
            }
            
            // Kiểm tra lại sau khi tạo
            const select = firstItem.querySelector(".location-city");
            console.log("After creation - Select has", select?.options.length, "options");
            if (select) {
              console.log("Select options:", Array.from(select.options).map(opt => ({value: opt.value, text: opt.textContent})));
            }
          }
        } else if (!checkbox.checked && locationsWrapper) {
          // Ẩn khối địa điểm của quốc gia
          locationsWrapper.style.display = "none";
        }
      });
    });
  }

  // Xử lý nút "Thêm điểm đến" cho mỗi quốc gia
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".country-location-add-btn");
    if (addBtn) {
      const countryId = addBtn.getAttribute("data-country-id");
      const countryItem = addBtn.closest(".country-item");
      const locationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
      
      if (locationsWrapper && countryId) {
        const newItem = createLocationItemForCountry(countryId);
        const locationGlobalActions = locationsWrapper.querySelector(".location-global-actions");
        if (locationGlobalActions) {
          locationsWrapper.insertBefore(newItem, locationGlobalActions);
        } else {
          locationsWrapper.appendChild(newItem);
        }
      }
    }
  });

  // Xử lý xóa location item trong khối quốc gia
  document.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".location-remove-btn");
    if (removeBtn) {
      const locationItem = removeBtn.closest(".tour-location-item");
      const locationsWrapper = locationItem?.closest(".country-locations-wrapper") || 
                               locationItem?.closest("#tour-locations-wrapper");
      
      if (locationItem && locationsWrapper) {
        const allItems = locationsWrapper.querySelectorAll(".tour-location-item");
        if (allItems.length > 1) {
          locationItem.remove();
        } else {
          // Nếu chỉ còn 1 item, chỉ xóa giá trị thay vì xóa item
          const citySelect = locationItem.querySelector(".location-city");
          if (citySelect) citySelect.value = "";
          locationItem.querySelectorAll(".spot-input").forEach(t => t.value = "");
        }
      }
    }
  });

  if (locationAddBtn && locationsWrapper) {
    locationAddBtn.addEventListener("click", () => {
      locationsWrapper.appendChild(createLocationItem());
    });

    // Xóa điểm đến (không cho xóa nếu chỉ còn 1 dòng)
    locationsWrapper.addEventListener("click", (e) => {
      const btn = e.target.closest(".location-remove-btn");
      if (btn) {
        const item = btn.closest(".tour-location-item");
        if (item && locationsWrapper.children.length > 1) {
          item.remove();
        }
      }
    });
  }
  // ==== HẾT ĐỊA ĐIỂM CÓ TRONG TOUR (UI) ====

  // ==== LỊCH KHỞI HÀNH (UI - CREATE): cặp ngày khởi hành + kết thúc ====
  const departuresWrapper = document.getElementById("departures-wrapper");
  const departurePairAddBtn = document.getElementById("departure-pair-add-btn");

  function createDeparturePairItem() {
    const div = document.createElement("div");
    div.className = "departure-pair-item";
    div.setAttribute("data-index", Date.now());
    div.innerHTML = `
      <div class="departure-pair-inputs">
        <div class="departure-pair-field">
          <label>Ngày khởi hành</label>
          <input type="date" class="departure-date-input">
        </div>
        <div class="departure-pair-field">
          <label>Ngày kết thúc</label>
          <input type="date" class="end-date-input">
        </div>
        <div class="departure-pair-field">
          <label>Tổng số ghế</label>
          <input type="number" class="seats-total-input" min="0" placeholder="VD: 40">
        </div>
        <div class="departure-pair-field">
          <label>Ghế còn lại</label>
          <input type="number" class="seats-remaining-input" min="0" placeholder="VD: 40">
        </div>
      </div>
      <div class="departure-pair-field departure-pair-field--remove">
        <label aria-hidden="true">&nbsp;</label>
        <button type="button" class="departure-pair-remove-btn">Xóa</button>
      </div>
    `;
    return div;
  }

  if (departurePairAddBtn && departuresWrapper) {
    departurePairAddBtn.addEventListener("click", () => {
      departuresWrapper.appendChild(createDeparturePairItem());
    });

    departuresWrapper.addEventListener("click", (e) => {
      const btn = e.target.closest(".departure-pair-remove-btn");
      if (btn) {
        const item = btn.closest(".departure-pair-item");
        if (item && departuresWrapper.children.length > 1) {
          item.remove();
        } else if (item) {
          item.querySelector(".departure-date-input").value = "";
          item.querySelector(".end-date-input").value = "";
        }
      }
    });
  }
  // ==== HẾT LỊCH KHỞI HÀNH (UI - CREATE) ====

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên tour!",
      },
    ])
    .onSuccess((event) => {
      const f = event.target;

      const name = f.name.value;
      const categoryIds = collectTourCategoryIds(f);
      const position = f.position.value;
      const status = f.status.value;
      const avatar = filePond.avatar.getFile()?.file;

      // Giá
      let priceAdult = f.priceAdult.value;
      let priceChildren = f.priceChildren.value;
      let priceBaby = f.priceBaby.value;
      let priceNewAdult = f.priceNewAdult.value;
      let priceNewChildren = f.priceNewChildren.value;
      let priceNewBaby = f.priceNewBaby.value;

      // Cấu hình Em bé
      const babyPricingMode = f.babyPricingMode.value || "fixed";
      let babyPricingRulesJson = "";

      if (babyPricingMode === "tiered") {
        // Không dùng giá cố định cho Em bé nữa
        priceBaby = "";
        priceNewBaby = "";
        const rules = collectBabyRules();
        babyPricingRulesJson = JSON.stringify(rules);
      }

      // ==== LẤY / KIỂM TRA THỜI HẠN KHUYẾN MÃI (GIẢM THEO SỐ TIỀN CỐ ĐỊNH) ====
      const hasManualOldPrice = hasOldPriceCreate();
      const discountFrom = discountFromInput?.value || "";
      const discountTo = discountToInput?.value || "";

      if (hasManualOldPrice) {
        if (!discountFrom || !discountTo) {
          notify.error(
            "Vui lòng nhập Từ ngày / Đến ngày khuyến mãi, hoặc xóa hết giá cũ (Người lớn / Trẻ em / Em bé)!"
          );
          return;
        }
      }
      // ==== HẾT KIỂM TRA THỜI HẠN KHUYẾN MÃI ====

      // ==== ĐIỂM KHỞI HÀNH ====
      const departureCity = f.departureCity?.value || "";

      // ==== ĐỊA ĐIỂM CÓ TRONG TOUR (mảng { cityId, spots[] }) ====
      const locations = [];
      
      // Kiểm tra xem có quốc gia nào được check không (tour nước ngoài)
      const checkedCountries = tourCreateForm.querySelectorAll('.tour-country-checkbox:checked');
      
      if (checkedCountries.length > 0) {
        // Tour nước ngoài: collect từ các .country-locations-wrapper
        console.log("Tour Create - Collecting locations from", checkedCountries.length, "countries");
        checkedCountries.forEach((checkbox) => {
          const countryId = checkbox.value;
          const countryItem = checkbox.closest(".country-item");
          const countryLocationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
          
          if (countryLocationsWrapper) {
            countryLocationsWrapper
              .querySelectorAll(".tour-location-item")
              .forEach((item) => {
                const citySelect = item.querySelector(".location-city");
                const cityId = citySelect?.value || "";
                
                // Thu thập spots từ các spot-input textarea
                const spots = [];
                item.querySelectorAll(".spot-input").forEach(textarea => {
                  const value = textarea.value.trim();
                  if (value) spots.push(value);
                });

                if (cityId && spots.length > 0) {
                  locations.push({ cityId, spots });
                  console.log("Tour Create - Added location:", cityId, "with", spots.length, "spots");
                }
              });
          }
        });
      } else if (locationsWrapper) {
        // Tour trong nước: collect từ #tour-locations-wrapper
        console.log("Tour Create - Collecting locations from Vietnam wrapper");
        locationsWrapper
          .querySelectorAll(".tour-location-item")
          .forEach((item) => {
            const citySelect = item.querySelector(".location-city");
            const cityId = citySelect?.value || "";
            
            // Thu thập spots từ các spot-input textarea
            const spots = [];
            item.querySelectorAll(".spot-input").forEach(textarea => {
              const value = textarea.value.trim();
              if (value) spots.push(value);
            });

            if (cityId && spots.length > 0) {
              locations.push({ cityId, spots });
              console.log("Tour Create - Added location:", cityId, "with", spots.length, "spots");
            }
          });
      }
      
      console.log("Tour Create - Total locations collected:", locations.length);

      // ==== LỊCH KHỞI HÀNH (cặp ngày - CREATE) ====
      const departuresWrapperC = document.getElementById("departures-wrapper");
      const departures = [];
      if (departuresWrapperC) {
        departuresWrapperC.querySelectorAll(".departure-pair-item").forEach((item) => {
          const depVal = item.querySelector(".departure-date-input")?.value || "";
          const endVal = item.querySelector(".end-date-input")?.value || "";
          const sTotal = parseInt(item.querySelector(".seats-total-input")?.value) || 0;
          let sRem = parseInt(item.querySelector(".seats-remaining-input")?.value);
          if (isNaN(sRem)) sRem = sTotal;
          if (sRem > sTotal) sRem = sTotal;
          if (depVal) departures.push({ departureDate: depVal, endDate: endVal || null, seatsTotal: sTotal, seatsRemaining: sRem });
        });
      }
      // ==== HẾT LỊCH KHỞI HÀNH ====

      // Khác
      const time = f.time.value;
      const vehicle = f.vehicle.value;
      const information = tinymce.get("information").getContent();

      const schedules = [];
      tourCreateForm
        .querySelectorAll(".inner-schedule-item")
        .forEach((item) => {
          const input = item.querySelector(".inner-schedule-head input");
          const title = input?.value || "";
          const textarea = item.querySelector(".inner-schedule-body textarea");
          const id = textarea?.id;
          const description = id ? tinymce.get(id).getContent() : "";
          schedules.push({ title, description });
        });

      // Tạo FormData
      const formData = new FormData();
      formData.append("customId", (tourCreateForm.querySelector("#customId")?.value || "").trim());
      formData.append("name", name);
      categoryIds.forEach((id) => formData.append("categories", id));
      formData.append("category", categoryIds[0] || "");
      formData.append("position", position);
      formData.append("status", status);
      formData.append("avatar", avatar);

      // Giá
      formData.append("priceAdult", priceAdult);
      formData.append("priceChildren", priceChildren);
      formData.append("priceBaby", priceBaby);
      formData.append("priceNewAdult", priceNewAdult);
      formData.append("priceNewChildren", priceNewChildren);
      formData.append("priceNewBaby", priceNewBaby);

      // Cấu hình Em bé
      formData.append("babyPricingMode", babyPricingMode);
      formData.append("babyPricingRulesJson", babyPricingRulesJson);
      const maxBabiesPerAdultEl = tourCreateForm.querySelector("#maxBabiesPerAdult");
      const babySeatFeeEl = tourCreateForm.querySelector("#babySeatFee");
      const maxBabiesPerAdult = maxBabiesPerAdultEl
        ? Math.max(0, parseInt(maxBabiesPerAdultEl.value, 10) || 0)
        : 1;
      const babySeatFee =
        maxBabiesPerAdult === 0
          ? 0
          : babySeatFeeEl
          ? Math.max(0, parseInt(babySeatFeeEl.value, 10) || 0)
          : 0;
      formData.append("maxBabiesPerAdult", maxBabiesPerAdult);
      formData.append("babySeatFee", babySeatFee);

      // ==== GỬI THỜI HẠN KHUYẾN MÃI NẾU CÓ ====
      if (hasManualOldPrice && discountFrom && discountTo) {
        formData.append("discountFrom", discountFrom);
        formData.append("discountTo", discountTo);
      }
      // ==== HẾT GỬI THỜI HẠN ====

      // Điểm khởi hành + Địa điểm có trong tour
      formData.append("departureCity", departureCity);
      formData.append("locations", JSON.stringify(locations));

      // Khác
      formData.append("time", time);
      formData.append("vehicle", vehicle);
      formData.append("departures", JSON.stringify(departures));
      formData.append("information", information);
      formData.append("schedules", JSON.stringify(schedules));

      // Điểm nổi bật, bao gồm, không bao gồm - Thu thập từ các textarea riêng biệt
      const highlightsArray = [];
      tourCreateForm.querySelectorAll('.highlight-input').forEach(textarea => {
        const value = textarea.value.trim();
        if (value) highlightsArray.push(value);
      });
      
      const includesArray = [];
      tourCreateForm.querySelectorAll('.include-input').forEach(textarea => {
        const value = textarea.value.trim();
        if (value) includesArray.push(value);
      });
      
      const excludesArray = [];
      tourCreateForm.querySelectorAll('.exclude-input').forEach(textarea => {
        const value = textarea.value.trim();
        if (value) excludesArray.push(value);
      });
      
      formData.append("highlights", highlightsArray.join('\n'));
      formData.append("includes", includesArray.join('\n'));
      formData.append("excludes", excludesArray.join('\n'));

      // Tags (loại hình trải nghiệm)
      const tagsCheckboxes = f.querySelectorAll('input[name="tags"]:checked');
      const tags = Array.from(tagsCheckboxes).map(cb => cb.value);
      tags.forEach(tag => {
        formData.append("tags", tag);
      });

      // images
      if (filePondMulti.images.getFiles().length > 0) {
        filePondMulti.images.getFiles().forEach((item) => {
          formData.append("images", item.file);
        });
      }
      // End images

      fetch(`/${pathAdmin}/tour/create`, {
        method: "POST",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            drawNotify(data.code, data.message);
            window.location.reload();
          }
        });
    });
}
// End Tour Create Form

// Order Edit Form
const orderEditForm = document.querySelector("#order-edit-form");
if (orderEditForm && orderEditForm.dataset.readOnly === "1") {
  // Super admin xem chi tiết: không validate / không PATCH
} else if (orderEditForm) {
  const validator = new JustValidate("#order-edit-form");

  validator
    .addField("#fullName", [
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
    .addField("#phone", [
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
    .onSuccess((event) => {
      const id = event.target.id.value;
      const fullName = event.target.fullName.value;
      const phone = event.target.phone.value;
      const note = event.target.note.value;
      const paymentMethod = event.target.paymentMethod.value;
      const paymentStatus = event.target.paymentStatus.value;
      const status = event.target.status.value;

      const dataFinal = {
        fullName: fullName,
        phone: phone,
        note: note,
        paymentMethod: paymentMethod,
        paymentStatus: paymentStatus,
        status: status,
      };

      const patchUrl =
        orderEditForm.getAttribute("data-patch-url") ||
        `/${pathAdmin}/order/edit/${id}`;
      fetch(patchUrl, {
        method: "PATCH",
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
          }
        });
    });
}
// End Order Edit Form

// Setting Website Info Form
const settingWebsiteInfoForm = document.querySelector(
  "#setting-website-info-form"
);
if (settingWebsiteInfoForm) {
  const validator = new JustValidate("#setting-website-info-form");

  validator
    .addField("#websiteName", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên website!",
      },
    ])
    .addField("#email", [
      {
        rule: "email",
        errorMessage: "Email không đúng định dạng!",
      },
    ])
    .onSuccess((event) => {
      const websiteName = event.target.websiteName.value;
      const phone = event.target.phone.value;
      const email = event.target.email.value;
      const address = event.target.address.value;
      const logo = filePond.logo?.getFile?.()?.file;
      // Tạo FormData
      const formData = new FormData();
      formData.append("websiteName", websiteName);
      formData.append("phone", phone);
      formData.append("email", email);
      formData.append("address", address);
      // Chỉ append khi user thực sự chọn file (tránh FormData cast undefined → "undefined")
      if (logo instanceof Blob) formData.append("logo", logo);
      // Lấy danh mục Section 4 từ hidden inputs (quản lý bởi tag picker)
      document
        .querySelectorAll('#s4-hidden input[name="categoryIdsSection4"]')
        .forEach((inp) => {
          if (inp.value) formData.append("categoryIdsSection4", inp.value);
        });

      const patchUrl =
        settingWebsiteInfoForm.getAttribute("data-patch-url") ||
        `/${pathAdmin}/setting/website-info`;
      fetch(patchUrl, {
        method: "PATCH",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            notify.success(data.message);
          }
        });
    });
}
// End Setting Website Info Form

// Setting Account Admin Create Form
const settingAccountAdminCreateForm = document.querySelector(
  "#setting-account-admin-create-form"
);
if (settingAccountAdminCreateForm) {
  const scopeSelect = settingAccountAdminCreateForm.querySelector(
    "#tabAccessScope"
  );
  const hotelWrap = settingAccountAdminCreateForm.querySelector(
    "#account-admin-assigned-hotel-wrap"
  );
  const syncHotelStaffFields = () => {
    if (!scopeSelect || !hotelWrap) return;
    const show = scopeSelect.value === "hotel_staff";
    hotelWrap.style.display = show ? "" : "none";
  };
  syncHotelStaffFields();
  if (scopeSelect) {
    scopeSelect.addEventListener("change", syncHotelStaffFields);
  }

  const validator = new JustValidate("#setting-account-admin-create-form");

  validator
    .addField("#fullName", [
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
    .addField("#email", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập email!",
      },
      {
        rule: "email",
        errorMessage: "Email không đúng định dạng!",
      },
    ])
    .addField("#phone", [
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
    .addField("#password", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mật khẩu!",
      },
      {
        rule: "minLength",
        value: 8,
        errorMessage: "Mật khẩu phải có ít nhất 8 ký tự!",
      },
      {
        rule: "customRegexp",
        value: /[A-Z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết hoa!",
      },
      {
        rule: "customRegexp",
        value: /[a-z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết thường!",
      },
      {
        rule: "customRegexp",
        value: /\d/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ số!",
      },
      {
        rule: "customRegexp",
        value: /[~!@#$%^&*]/,
        errorMessage:
          "Mật khẩu phải có ít nhất một ký tự đặc biệt! (~!@#$%^&*)",
      },
    ])
    .onSuccess((event) => {
      const fullName = event.target.fullName.value;
      const email = event.target.email.value;
      const phone = event.target.phone.value;
      const role = event.target.role ? event.target.role.value : "";
      const tabAccessScope = event.target.tabAccessScope
        ? event.target.tabAccessScope.value
        : "inherit";
      const positionCompany = event.target.positionCompany.value;
      const status = event.target.status.value;
      const password = event.target.password.value;
      const avatar = filePond.avatar.getFile()?.file;

      const formData = new FormData();
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("phone", phone);
      if (event.target.role) formData.append("role", role);
      formData.append("tabAccessScope", tabAccessScope);
      if (tabAccessScope === "hotel_staff" && event.target.assignedHotelId) {
        formData.append(
          "assignedHotelId",
          event.target.assignedHotelId.value
        );
      }
      formData.append("positionCompany", positionCompany);
      formData.append("status", status);
      formData.append("password", password);
      formData.append("avatar", avatar);

      fetch(`/${pathAdmin}/setting/account-admin/create`, {
        method: "POST",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            drawNotify(data.code, data.message);
            window.location.reload();
          }
        });
    });
}
// End Setting Account Admin Create Form

// Setting Account Admin Edit Form
const settingAccountAdminEditForm = document.querySelector(
  "#setting-account-admin-edit-form"
);
if (settingAccountAdminEditForm) {
  const scopeSelectEdit = settingAccountAdminEditForm.querySelector(
    "#tabAccessScope"
  );
  const hotelWrapEdit = settingAccountAdminEditForm.querySelector(
    "#account-admin-assigned-hotel-wrap"
  );
  const syncHotelStaffFieldsEdit = () => {
    if (!scopeSelectEdit || !hotelWrapEdit) return;
    const show = scopeSelectEdit.value === "hotel_staff";
    hotelWrapEdit.style.display = show ? "" : "none";
  };
  syncHotelStaffFieldsEdit();
  if (scopeSelectEdit) {
    scopeSelectEdit.addEventListener("change", syncHotelStaffFieldsEdit);
  }

  const validator = new JustValidate("#setting-account-admin-edit-form");

  validator
    .addField("#fullName", [
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
    .addField("#email", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập email!",
      },
      {
        rule: "email",
        errorMessage: "Email không đúng định dạng!",
      },
    ])
    .addField("#phone", [
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
    .addField("#password", [
      {
        rule: "minLength",
        value: 8,
        errorMessage: "Mật khẩu phải có ít nhất 8 ký tự!",
      },
      {
        rule: "customRegexp",
        value: /[A-Z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết hoa!",
      },
      {
        rule: "customRegexp",
        value: /[a-z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết thường!",
      },
      {
        rule: "customRegexp",
        value: /\d/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ số!",
      },
      {
        rule: "customRegexp",
        value: /[~!@#$%^&*]/,
        errorMessage:
          "Mật khẩu phải có ít nhất một ký tự đặc biệt! (~!@#$%^&*)",
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const fullName = event.target.fullName.value;
      const email = event.target.email.value;
      const phone = event.target.phone.value;
      const role = event.target.role ? event.target.role.value : "";
      const tabAccessScope = event.target.tabAccessScope
        ? event.target.tabAccessScope.value
        : "inherit";
      const positionCompany = event.target.positionCompany.value;
      const status = event.target.status.value;
      const password = event.target.password.value;
      const avatar = filePond.avatar.getFile()?.file;

      // Tạo FormData
      const formData = new FormData();
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("phone", phone);
      if (event.target.role) formData.append("role", role);
      formData.append("tabAccessScope", tabAccessScope);
      if (tabAccessScope === "hotel_staff" && event.target.assignedHotelId) {
        formData.append(
          "assignedHotelId",
          event.target.assignedHotelId.value
        );
      }
      formData.append("positionCompany", positionCompany);
      formData.append("status", status);
      formData.append("password", password);
      formData.append("avatar", avatar);

      fetch(`/${pathAdmin}/setting/account-admin/edit/${id}`, {
        method: "PATCH",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            notify.success(data.message);
          }
        });
    });
}
// End Setting Account Admin Edit Form

// Setting Role Create Form
const settingRoleCreateForm = document.querySelector(
  "#setting-role-create-form"
);
if (settingRoleCreateForm) {
  const validator = new JustValidate("#setting-role-create-form");

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên nhóm quyền!",
      },
    ])
    .onSuccess((event) => {
      const name = event.target.name.value;
      const description = event.target.description.value;
      const permissions = [];

      // permissions
      const listInputPermission = settingRoleCreateForm.querySelectorAll(
        `input[name="permissions"]`
      );
      listInputPermission.forEach((input) => {
        if (input.checked) {
          permissions.push(input.value);
        }
      });
      // End permissions

      const dataFinal = {
        name: name,
        description: description,
        permissions: permissions,
      };

      fetch(`/${pathAdmin}/setting/role/create`, {
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
            drawNotify(data.code, data.message);
            window.location.reload();
          }
        });
    });
}
// End Setting Role Create Form

// Setting Role Edit Form
const settingRoleEditForm = document.querySelector("#setting-role-edit-form");
if (settingRoleEditForm) {
  const validator = new JustValidate("#setting-role-edit-form");

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên nhóm quyền!",
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value;
      const name = event.target.name.value;
      const description = event.target.description.value;
      const permissions = [];

      // permissions
      const listInputPermission = settingRoleEditForm.querySelectorAll(
        `input[name="permissions"]`
      );
      listInputPermission.forEach((input) => {
        if (input.checked) {
          permissions.push(input.value);
        }
      });
      // End permissions

      const dataFinal = {
        name: name,
        description: description,
        permissions: permissions,
      };

      fetch(`/${pathAdmin}/setting/role/edit/${id}`, {
        method: "PATCH",
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
          }
        });
    });
}
// End Setting Role Edit Form

// Profile Edit Form
const profileEditForm = document.querySelector("#profile-edit-form");
if (profileEditForm) {
  const isSuperAdminProfile = profileEditForm.classList.contains(
    "profile-edit-form--super-admin"
  );
  const profilePatchUrl =
    (profileEditForm.dataset.profilePatchUrl &&
      String(profileEditForm.dataset.profilePatchUrl).trim()) ||
    `/${pathAdmin}/profile/edit`;

  const validator = new JustValidate("#profile-edit-form");

  const chain = validator
    .addField("#fullName", [
      { rule: "required", errorMessage: "Vui lòng nhập họ tên!" },
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
    .addField("#email", [
      { rule: "required", errorMessage: "Vui lòng nhập email!" },
      { rule: "email", errorMessage: "Email không đúng định dạng!" },
    ])
    .addField("#phone", [
      { rule: "required", errorMessage: "Vui lòng nhập số điện thoại!" },
      {
        rule: "customRegexp",
        value: /^(0?)(3[2-9]|5[6|8|9]|7[0|6-9]|8[0-6|8|9]|9[0-4|6-9])[0-9]{7}$/,
        errorMessage: "Số điện thoại không đúng định dạng!",
      },
    ]);

  if (!isSuperAdminProfile && profileEditForm.querySelector("#role")) {
    chain.addField("#role", [
      { rule: "required", errorMessage: "Vui lòng chọn nhóm quyền!" },
    ]);
  }

  chain.onSuccess(async (event) => {
      const formEl = event.target;
      const submitBtn = formEl.querySelector('button[type="submit"]');
      submitBtn && (submitBtn.disabled = true);

      const fullName = formEl.fullName.value.trim();
      const email = formEl.email.value.trim().toLowerCase(); // chuẩn hoá
      const phone = formEl.phone.value.trim();
      const positionCompany = (formEl.positionCompany && formEl.positionCompany.value.trim()) || "";
      const roleVal = formEl.role && formEl.role.value ? String(formEl.role.value).trim() : "";

      // Chỉ lấy file nếu có (filePond global + window.filePond sau khi init Filepond)
      const pond = typeof filePond !== "undefined" ? filePond : window.filePond;
      const avatarFile =
        pond && pond.avatar && pond.avatar.getFile && pond.avatar.getFile()
          ? pond.avatar.getFile().file
          : null;

      const formData = new FormData();
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("phone", phone);
      if (!isSuperAdminProfile) {
        formData.append("positionCompany", positionCompany);
        if (roleVal) formData.append("role", roleVal);
      }
      if (avatarFile) formData.append("avatar", avatarFile); // chỉ append khi có file

      try {
        const res = await fetch(profilePatchUrl, {
          method: "PATCH",
          body: formData,
          credentials: "same-origin",
        });

        // Nếu server trả về HTML (ví dụ bị redirect về login), tránh .json() bị lỗi
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          window.location.reload();
          return;
        }

        const data = await res.json();
        if (data.code === "error") {
          notify.error(data.message);
        } else {
          drawNotify(data.code, data.message);
          window.location.reload();
        }
      } catch {
        notify.error("Không thể kết nối máy chủ!");
      } finally {
        submitBtn && (submitBtn.disabled = false);
      }
    });
}
// End Profile Edit Form

// Profile Change Password Form
const profileChangePasswordForm = document.querySelector(
  "#profile-change-password-form"
);
if (profileChangePasswordForm) {
  const validator = new JustValidate("#profile-change-password-form");

  validator
    .addField("#password", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mật khẩu mới!",
      },
      {
        rule: "minLength",
        value: 8,
        errorMessage: "Mật khẩu phải có ít nhất 8 ký tự!",
      },
      {
        rule: "customRegexp",
        value: /[A-Z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết hoa!",
      },
      {
        rule: "customRegexp",
        value: /[a-z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết thường!",
      },
      {
        rule: "customRegexp",
        value: /\d/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ số!",
      },
      {
        rule: "customRegexp",
        value: /[~!@#$%^&*]/,
        errorMessage:
          "Mật khẩu phải có ít nhất một ký tự đặc biệt! (~!@#$%^&*)",
      },
    ])
    .addField("#confirmPassword", [
      {
        validator: (value, fields) => {
          const password = fields["#password"].elem.value;
          return password == value;
        },
        errorMessage: "Mật khẩu xác nhận không khớp!",
      },
    ])
    .onSuccess((event) => {
      const password = event.target.password.value;
      console.log(password);
    });
}
// End Profile Change Password Form

// Admin Tab Switch
const adminTabSwitch = document.querySelector(".admin-tab-switch");
if (adminTabSwitch) {
  const tabButtons = adminTabSwitch.querySelectorAll(".tab-btn");
  const menuTour = document.querySelector(".sider .menu-tour");
  const menuHotel = document.querySelector(".sider .menu-hotel");
  
  // Xác định tab hiện tại dựa trên URL
  const currentPath = location.pathname;
  let currentTab = "tour"; // Mặc định là tour
  
  // Kiểm tra URL để xác định tab
  // Nếu URL chứa /hotel (bao gồm /hotel/dashboard, /hotel/list, /hotel/room-types)
  if (currentPath.includes("/hotel")) {
    currentTab = "hotel";
  } else {
    // Các URL khác (dashboard, tour, order, user, contact, company) đều thuộc tour
    currentTab = "tour";
  }
  
  // Lấy tab từ localStorage nếu có (ưu tiên URL hơn localStorage)
  // Chỉ dùng localStorage khi không thể xác định từ URL
  const savedTab = localStorage.getItem("adminActiveTab");
  if (!currentPath.includes("/hotel") && !currentPath.includes("/tour") && 
      !currentPath.includes("/dashboard") && !currentPath.includes("/order") &&
      !currentPath.includes("/user") && !currentPath.includes("/contact") &&
      !currentPath.includes("/company") && !currentPath.includes("/category")) {
    if (savedTab && (savedTab === "tour" || savedTab === "hotel")) {
      currentTab = savedTab;
    }
  }
  
  // Hàm chuyển đổi tab
  function switchTab(tab) {
    // Cập nhật nút active
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
    
    // Hiển thị/ẩn menu tương ứng
    if (tab === "tour") {
      if (menuTour) menuTour.style.display = "";
      if (menuHotel) menuHotel.style.display = "none";
    } else if (tab === "hotel") {
      if (menuTour) menuTour.style.display = "none";
      if (menuHotel) menuHotel.style.display = "";
    }
    
    // Lưu vào localStorage
    localStorage.setItem("adminActiveTab", tab);
  }
  
  // Khởi tạo tab ban đầu
  switchTab(currentTab);
  
  // Xử lý click vào tab
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}
// End Admin Tab Switch

// ========== HOTEL SELECTOR ==========
// Hiển thị hotel selector khi ở tab hotel
(function() {
  function toggleHotelSelector() {
    const hotelSelectorBar = document.querySelector(".hotel-selector-bar");
    if (hotelSelectorBar) {
      const currentPath = window.location.pathname;
      console.log("Hotel Selector - Current path:", currentPath);
      
      // Ẩn hotel selector khi đang ở các trang liên quan đến một hotel cụ thể
      const hidePaths = [
        "/hotel/edit/",              // Edit hotel: /admin/hotel/edit/:id
        "/hotel/create",             // Create hotel: /admin/hotel/create
        "/hotel/room-types/manage",  // Manage room types: /admin/hotel/:hotelId/room-types/manage
        "/hotel/room/create",        // Create room type: /admin/hotel/:hotelId/room/create
        "/hotel/room/",              // Edit room type: /admin/hotel/:hotelId/room/:roomId/edit
      ];
      
      // Kiểm tra pattern: /hotel/:hotelId/room-types/manage hoặc /hotel/:hotelId/room/:roomId/edit
      const isManageRoomTypes = /\/hotel\/[^\/]+\/room-types\/manage/.test(currentPath);
      const isEditRoomType = /\/hotel\/[^\/]+\/room\/[^\/]+\/edit/.test(currentPath);
      const isCreateRoomType = /\/hotel\/[^\/]+\/room\/create/.test(currentPath);
      
      // Kiểm tra pattern: /hotel/:hotelId/rooms/list (danh sách phòng của một hotel cụ thể)
      const isRoomsListByHotel = /\/hotel\/[^\/]+\/rooms\/list/.test(currentPath);
      
      // Kiểm tra pattern: /hotel/rooms/create (tạo phòng mới, có thể có query parameter hotelId)
      const isCreateRoom = /\/hotel\/rooms\/create/.test(currentPath);
      
      // Kiểm tra pattern: /hotel/:hotelId/rooms/:roomId/edit (chỉnh sửa phòng cụ thể)
      const isEditRoom = /\/hotel\/[^\/]+\/rooms\/[^\/]+\/edit/.test(currentPath);
      
      const shouldHide = hidePaths.some(path => currentPath.includes(path)) || 
                         isManageRoomTypes || 
                         isEditRoomType || 
                         isCreateRoomType ||
                         isRoomsListByHotel ||
                         isCreateRoom ||
                         isEditRoom;

      // Admin chỉ tab Khách sạn: luôn coi như đang ở ngữ cảnh KS (không có hàng chuyển tab)
      const hotelOnlyAdmin = document.body.classList.contains("admin-hotel-only");
      const showHotelSelector =
        !shouldHide &&
        (currentPath.includes("/hotel") || hotelOnlyAdmin);

      if (showHotelSelector) {
        hotelSelectorBar.classList.remove("hidden");
        console.log("Hotel Selector - Showing", hotelSelectorBar);
      } else {
        hotelSelectorBar.classList.add("hidden");
        console.log("Hotel Selector - Hiding");
      }
    } else {
      console.log("Hotel Selector - Element not found!");
    }
  }
  
  // Chạy ngay khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', toggleHotelSelector);
  } else {
    // Chạy sau một chút để đảm bảo element đã được render
    setTimeout(toggleHotelSelector, 100);
  }
  
  // Cập nhật khi chuyển tab
  const adminTabSwitch = document.querySelector(".admin-tab-switch");
  if (adminTabSwitch) {
    const tabButtons = adminTabSwitch.querySelectorAll(".tab-btn");
    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        setTimeout(toggleHotelSelector, 200);
      });
    });
  }
})();

// Hotel Selector - Chỉ xử lý localStorage, không xử lý change event (đã có trong template)
function initHotelSelector() {
  const hotelSelector = document.getElementById("hotelSelector");

  if (!hotelSelector || hotelSelector.options.length === 0) {
    return;
  }

  const optionValues = new Set(
    Array.from(hotelSelector.options)
      .map((o) => o.value)
      .filter((v) => v != null && String(v).trim() !== "")
  );

  // Lấy hotel ID đã chọn từ URL hoặc localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const hotelIdFromUrl = urlParams.get("hotelId");
  const savedHotelId = localStorage.getItem("selectedHotelId");

  // Không dùng "all": dropdown không có option đó → select trống (hay gặp ở /hotel/tour-assignments)
  let initialHotelId = hotelIdFromUrl || savedHotelId || "";
  if (
    !initialHotelId ||
    initialHotelId === "all" ||
    !optionValues.has(initialHotelId)
  ) {
    initialHotelId = hotelSelector.options[0]
      ? String(hotelSelector.options[0].value)
      : "";
  }

  if (initialHotelId && hotelSelector.value !== initialHotelId) {
    hotelSelector.value = initialHotelId;
  }

  if (hotelIdFromUrl && optionValues.has(hotelIdFromUrl)) {
    localStorage.setItem("selectedHotelId", hotelIdFromUrl);
  } else if (!hotelIdFromUrl && initialHotelId && optionValues.has(initialHotelId)) {
    localStorage.setItem("selectedHotelId", initialHotelId);
  }
}

// Append hotelId vào các hotel menu links trong sidebar
function appendHotelIdToSidebarLinks() {
  const savedHotelId = localStorage.getItem("selectedHotelId");
  
  if (!savedHotelId || savedHotelId === "all") {
    return;
  }
  
  // Danh sách các hotel menu items cần thêm hotelId
  const hotelMenuLinks = [
    `/${pathAdmin}/hotel/dashboard`,
    `/${pathAdmin}/hotel/list`,
    `/${pathAdmin}/hotel/link-requests`,
    `/${pathAdmin}/hotel/booking/list`,
    `/${pathAdmin}/hotel/tour-assignments`,
    `/${pathAdmin}/hotel/room-types`,
    `/${pathAdmin}/hotel/rooms/list`,
    `/${pathAdmin}/hotel/customers`,
    `/${pathAdmin}/hotel/payments`,
    `/${pathAdmin}/hotel/reviews`,
  ];
  
  // Tìm tất cả các links trong sidebar
  const sidebarLinks = document.querySelectorAll('.menu-hotel a');
  
  sidebarLinks.forEach(link => {
    const href = link.getAttribute('href');
    
    // Kiểm tra xem link có trong danh sách hotel menu không
    const matchingPath = hotelMenuLinks.find(path => href && href.includes(path));
    
    if (matchingPath) {
      // Thêm hotelId vào href
      const url = new URL(href, window.location.origin);
      url.searchParams.set('hotelId', savedHotelId);
      link.setAttribute('href', url.pathname + url.search);
    }
  });
}

// Gọi function khi DOM sẵn sàng
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    initHotelSelector();
    appendHotelIdToSidebarLinks();
  });
} else {
  setTimeout(function() {
    initHotelSelector();
    appendHotelIdToSidebarLinks();
  }, 100);
}

// Global search functionality (tạm thời chỉ log, có thể mở rộng sau)
function initHotelGlobalSearch() {
  const hotelGlobalSearch = document.getElementById("hotelGlobalSearch");
  if (hotelGlobalSearch) {
    hotelGlobalSearch.addEventListener("keypress", function(e) {
      if (e.key === "Enter") {
        const searchTerm = this.value.trim();
        if (searchTerm) {
          // TODO: Implement global search across bookings, customers, rooms
          console.log("Global search:", searchTerm);
        }
      }
    });
  }
}

// Gọi function khi DOM sẵn sàng
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHotelGlobalSearch);
} else {
  setTimeout(initHotelGlobalSearch, 100);
}
// End Hotel Selector

// Sider
const sider = document.querySelector(".sider");
if (sider) {
  const pathNameCurrent = location.pathname;
  const splitPathNameCurrent = pathNameCurrent.split("/");
  const menuList = sider.querySelectorAll("a");
  
  // Kiểm tra xem có phải Super Admin sidebar không
  const isSuperAdminSider = sider.classList.contains("super-admin-sider");
  
  menuList.forEach((item) => {
    const href = item.getAttribute("href");
    
    // Bỏ qua các link không phải URL (ví dụ: javascript:;)
    if (!href || href.startsWith("javascript:")) {
      return;
    }
    
    let isMatch = false;
    
    if (isSuperAdminSider) {
      // Super Admin: so sánh 3 phần đầu (admin/super-admin/dashboard)
      const splitHref = href.split("/").filter(p => p);
      isMatch = 
        splitPathNameCurrent[1] == splitHref[0] &&
        splitPathNameCurrent[2] == splitHref[1] &&
        splitPathNameCurrent[3] == splitHref[2];
    } else {
      // Company Admin: so sánh chính xác URL path
      // Loại bỏ query string và hash nếu có
      const currentPath = pathNameCurrent.split("?")[0].split("#")[0];
      const hrefPath = href.split("?")[0].split("#")[0];
      
      // So sánh chính xác path - chỉ match khi URL hoàn toàn giống nhau
      // Điều này đảm bảo /admin/hotel/list không match với /admin/hotel/room-types
      isMatch = currentPath === hrefPath;
      
      // Ngoại lệ 1: Nếu đang ở trang edit/create hotel, highlight menu "Khách sạn" (hotel/list)
      if (!isMatch && hrefPath.includes("/hotel/list")) {
        // Kiểm tra nếu currentPath là edit hoặc create hotel
        if (currentPath.includes("/hotel/edit/") || currentPath.includes("/hotel/create")) {
          isMatch = true;
        }
      }
      
      // Ngoại lệ 2: Nếu đang ở các trang quản lý loại phòng, highlight menu "Quản lý loại phòng" (hotel/room-types)
      if (!isMatch && hrefPath.includes("/hotel/room-types") && !hrefPath.includes("/manage") && !hrefPath.includes("/edit")) {
        // Kiểm tra nếu currentPath là manage room types hoặc edit room type
        // Pattern: /hotel/:hotelId/room-types/manage hoặc /hotel/:hotelId/room/:roomId/edit
        if (currentPath.includes("/hotel/") && currentPath.includes("/room-types/manage")) {
          isMatch = true;
        } else if (currentPath.includes("/hotel/") && currentPath.includes("/room/") && currentPath.includes("/edit") && !currentPath.includes("/rooms/")) {
          // /hotel/:hotelId/room/:roomId/edit (tạo loại phòng) - không phải /hotel/rooms/create
          isMatch = true;
        } else if (currentPath.includes("/hotel/") && currentPath.includes("/room/create") && !currentPath.includes("/rooms/create")) {
          // /hotel/:hotelId/room/create (tạo loại phòng) - không phải /hotel/rooms/create
          isMatch = true;
        }
      }
      
      // Ngoại lệ 3: Nếu đang ở trang tạo phòng mới, danh sách phòng của hotel, hoặc chỉnh sửa phòng, highlight menu "Danh sách phòng" (hotel/rooms/list)
      if (!isMatch && hrefPath.includes("/hotel/rooms/list")) {
        // Kiểm tra nếu currentPath là create room, danh sách phòng của một hotel, hoặc chỉnh sửa phòng
        // Pattern: /hotel/rooms/create hoặc /hotel/:hotelId/rooms/list hoặc /hotel/:hotelId/rooms/:roomId/edit
        if (currentPath.includes("/hotel/rooms/create")) {
          isMatch = true;
        } else if (currentPath.match(/\/hotel\/[^\/]+\/rooms\/list/)) {
          // /hotel/:hotelId/rooms/list
          isMatch = true;
        } else if (currentPath.match(/\/hotel\/[^\/]+\/rooms\/[^\/]+\/edit/)) {
          // /hotel/:hotelId/rooms/:roomId/edit
          isMatch = true;
        }
      }
      
      // Ngoại lệ 4: Nếu đang ở các trang booking (Lịch phòng, danh sách đặt phòng, etc.), highlight menu "Đặt phòng" (hotel/booking/list)
      if (!isMatch && hrefPath.includes("/hotel/booking/list")) {
        // Kiểm tra nếu currentPath là bất kỳ trang booking nào
        // Pattern: /hotel/booking/list, /hotel/booking/calendar, /hotel/booking/:id, etc.
        if (currentPath.includes("/hotel/booking/")) {
          isMatch = true;
        }
      }

      // Ngoại lệ 5: Phân phòng cho tour — danh sách và /hotel/tour-assignments/:segmentId (kèm query)
      if (!isMatch && hrefPath.includes("/hotel/tour-assignments")) {
        if (
          currentPath === hrefPath ||
          currentPath.startsWith(hrefPath + "/")
        ) {
          isMatch = true;
        }
      }

      // Ngoại lệ 6: Liên kết Tour – Khách sạn — list, /tour-hotel/detail/:tourId, /tour-hotel/assign/:segmentId
      if (!isMatch && hrefPath.includes("/tour-hotel/list")) {
        if (currentPath === hrefPath) {
          isMatch = true;
        } else if (
          currentPath.includes("/tour-hotel/detail/") ||
          currentPath.includes("/tour-hotel/assign/")
        ) {
          isMatch = true;
        }
      }

      // Ngoại lệ 7: Đổi mật khẩu — cùng nhóm "Thông tin cá nhân" với /profile/edit
      if (!isMatch && hrefPath.includes("/profile/edit")) {
        if (currentPath.includes("/profile/change-password")) {
          isMatch = true;
        }
      }

      // Ngoại lệ 8: Cài đặt chung — setting/list + website-info + account-admin/role
      if (!isMatch && hrefPath.includes("/setting/list")) {
        if (
          currentPath === hrefPath ||
          currentPath.includes("/setting/website-info") ||
          currentPath.includes("/setting/account-admin/") ||
          currentPath.includes("/setting/role/")
        ) {
          isMatch = true;
        }
      }

      // Ngoại lệ 9: Quản lý tour — list + create/edit cùng active menu
      if (!isMatch && hrefPath.includes("/tour/list")) {
        if (
          currentPath === hrefPath ||
          currentPath.includes("/tour/create") ||
          currentPath.includes("/tour/edit/")
        ) {
          isMatch = true;
        }
      }

      // Ngoại lệ 10: Quản lý đơn hàng — list + edit/detail cùng active menu
      if (!isMatch && hrefPath.includes("/order/list")) {
        if (
          currentPath === hrefPath ||
          currentPath.includes("/order/edit/") ||
          currentPath.includes("/order/detail/")
        ) {
          isMatch = true;
        }
      }
    }
    
    if (isMatch) {
      item.classList.add("active");
    }
  });

  // Giữ vị trí cuộn sidebar sau khi chuyển trang (full reload) — Super Admin / Company Admin
  const attachSiderScrollPersistence = (scrollKey) => {
    const persistScroll = () => {
      sessionStorage.setItem(scrollKey, String(Math.round(sider.scrollTop)));
    };
    const restoreScroll = () => {
      const raw = sessionStorage.getItem(scrollKey);
      if (raw == null) return;
      const y = parseInt(raw, 10);
      if (Number.isNaN(y) || y < 0) return;
      const apply = () => {
        sider.scrollTop = y;
      };
      requestAnimationFrame(() => {
        apply();
        requestAnimationFrame(apply);
      });
    };

    let scrollDebounce;
    sider.addEventListener(
      "scroll",
      () => {
        clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(persistScroll, 100);
      },
      { passive: true }
    );

    sider.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (!a || !sider.contains(a)) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("javascript:")) return;
      persistScroll();
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", restoreScroll);
    } else {
      restoreScroll();
    }
    window.addEventListener("load", restoreScroll);
    window.addEventListener("pageshow", (ev) => {
      if (ev.persisted) restoreScroll();
    });
  };

  if (isSuperAdminSider) {
    attachSiderScrollPersistence("adminSuperAdminSiderScrollTop");
  } else {
    attachSiderScrollPersistence("adminCompanySiderScrollTop");
  }
}
// End Sider

// Logout
const buttonLogout = document.querySelector(".sider .inner-logout");
if (buttonLogout) {
  buttonLogout.addEventListener("click", () => {
    fetch(`/${pathAdmin}/account/logout`, {
      method: "POST",
    })
      .then((res) => res.json())
      .then((data) => {
        drawNotify(data.code, data.message);
        window.location.href = `/${pathAdmin}/account/login`;
      });
  });
}
// End Logout

// Button Delete
const listButtonDelete = document.querySelectorAll("[button-delete]");
if (listButtonDelete.length > 0) {
  listButtonDelete.forEach((button) => {
    button.addEventListener("click", () => {
      const dataApi = button.getAttribute("data-api");

      fetch(dataApi, {
        method: "PATCH",
      })
        .then((res) => res.json())
        .then((data) => {
          drawNotify(data.code, data.message);
          window.location.reload();
        });
    });
  });
}
// End Button Delete

// Button Undo
const listButtonUndo = document.querySelectorAll("[button-undo]");
if (listButtonUndo.length > 0) {
  listButtonUndo.forEach((button) => {
    button.addEventListener("click", () => {
      const dataApi = button.getAttribute("data-api");

      fetch(dataApi, {
        method: "PATCH",
      })
        .then((res) => res.json())
        .then((data) => {
          drawNotify(data.code, data.message);
          window.location.reload();
        });
    });
  });
}
// End Button Undo

// Button Destroy
const listButtonDestroy = document.querySelectorAll("[button-destroy]");
if (listButtonDestroy.length > 0) {
  listButtonDestroy.forEach((button) => {
    button.addEventListener("click", () => {
      const isConfirm = confirm(
        "Bạn có chắc chắn muốn xóa? Hành động này sẽ không thể khôi phục lại bản ghi."
      );

      if (isConfirm) {
        const dataApi = button.getAttribute("data-api");

        fetch(dataApi, {
          method: "DELETE",
        })
          .then((res) => res.json())
          .then((data) => {
            drawNotify(data.code, data.message);
            window.location.reload();
          });
      }
    });
  });
}
// End Button Destroy

// Filter Status
const filterStatus = document.querySelector("[filter-status]");
if (filterStatus) {
  const url = new URL(window.location.href);

  filterStatus.addEventListener("change", () => {
    const value = filterStatus.value;
    if (value) {
      url.searchParams.set("status", value);
    } else {
      url.searchParams.delete("status");
    }
    window.location.href = url.href;
  });

  // Hiển thị giá trị mặc định
  const valueCurrent = url.searchParams.get("status");
  if (valueCurrent) {
    filterStatus.value = valueCurrent;
  }
}
// End Filter Status

// Filter Created By
const filterCreatedBy = document.querySelector("[filter-created-by]");
if (filterCreatedBy) {
  const url = new URL(window.location.href);

  filterCreatedBy.addEventListener("change", () => {
    const value = filterCreatedBy.value;
    if (value) {
      url.searchParams.set("createdBy", value);
    } else {
      url.searchParams.delete("createdBy");
    }
    window.location.href = url.href;
  });

  // Hiển thị giá trị mặc định
  const valueCurrent = url.searchParams.get("createdBy");
  if (valueCurrent) {
    filterCreatedBy.value = valueCurrent;
  }
}
// End Filter Created By

// Filter Start Date
const filterStartDate = document.querySelector("[filter-start-date]");
if (filterStartDate) {
  const url = new URL(window.location.href);

  filterStartDate.addEventListener("change", () => {
    const value = filterStartDate.value;
    if (value) {
      url.searchParams.set("startDate", value);
    } else {
      url.searchParams.delete("startDate");
    }
    window.location.href = url.href;
  });

  // Hiển thị giá trị mặc định
  const valueCurrent = url.searchParams.get("startDate");
  if (valueCurrent) {
    filterStartDate.value = valueCurrent;
  }
}
// End Filter Start Date

// Filter End Date
const filterEndDate = document.querySelector("[filter-end-date]");
if (filterEndDate) {
  const url = new URL(window.location.href);

  filterEndDate.addEventListener("change", () => {
    const value = filterEndDate.value;
    if (value) {
      url.searchParams.set("endDate", value);
    } else {
      url.searchParams.delete("endDate");
    }
    window.location.href = url.href;
  });

  // Hiển thị giá trị mặc định
  const valueCurrent = url.searchParams.get("endDate");
  if (valueCurrent) {
    filterEndDate.value = valueCurrent;
  }
}
// End Filter End Date

// Filter Reset
const filterReset = document.querySelector("[filter-reset]");
if (filterReset) {
  const url = new URL(window.location.href);
  const listName = ["status", "createdBy", "startDate", "endDate"];

  filterReset.addEventListener("click", () => {
    listName.forEach((name) => {
      url.searchParams.delete(name);
    });
    window.location.href = url.href;
  });
}
// End Filter Reset

// Check All
const checkAll = document.querySelector("[check-all]");
if (checkAll) {
  checkAll.addEventListener("click", () => {
    const listCheckItem = document.querySelectorAll("[check-item]");
    listCheckItem.forEach((item) => {
      item.checked = checkAll.checked;
    });
  });
}
// End Check All

// Change Multi
const changeMulti = document.querySelector("[change-multi]");
if (changeMulti) {
  const select = changeMulti.querySelector("select");
  const button = changeMulti.querySelector("button");
  const dataApi = changeMulti.getAttribute("data-api");

  button.addEventListener("click", () => {
    const value = select.value;
    const ids = [];

    const listInputChecked = document.querySelectorAll("[check-item]:checked");
    listInputChecked.forEach((input) => {
      const id = input.getAttribute("check-item");
      ids.push(id);
    });

    if (value && ids.length > 0) {
      const dataFinal = {
        value: value,
        ids: ids,
      };

      fetch(dataApi, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then((res) => res.json())
        .then((data) => {
          // Trường hợp đặc biệt: bulk bật "Hoạt động" nhưng có tour bị chặn vì
          // chưa đủ điều kiện hiển thị (canPublishTour). Hiển thị chi tiết.
          var hasBlocked =
            data && Array.isArray(data.blocked) && data.blocked.length > 0;
          if (hasBlocked) {
            var lines = [];
            lines.push(data.message || "Một số tour không thể bật hiển thị:");
            lines.push("");
            data.blocked.forEach(function (b) {
              lines.push("• " + (b.name || "(không tên)"));
              (b.reasons || []).forEach(function (r) {
                lines.push("    - " + r);
              });
            });
            window.alert(lines.join("\n"));
            window.location.reload();
            return;
          }

          // Trường hợp editPatch trả về reasons[] khi từ chối bật hiển thị
          if (
            data &&
            data.code === "error" &&
            Array.isArray(data.reasons) &&
            data.reasons.length > 0
          ) {
            var lines2 = [];
            lines2.push(data.message || "Không thể thực hiện hành động:");
            lines2.push("");
            data.reasons.forEach(function (r) {
              lines2.push("• " + r);
            });
            window.alert(lines2.join("\n"));
            window.location.reload();
            return;
          }

          drawNotify(data.code, data.message);
          window.location.reload();
        });
    }
  });
}
// End Change Multi

// Search
const search = document.querySelector("[search]");
if (search) {
  const url = new URL(window.location.href);

  search.addEventListener("keyup", (event) => {
    if (event.code == "Enter") {
      const value = search.value;
      if (value) {
        url.searchParams.set("keyword", value);
      } else {
        url.searchParams.delete("keyword");
      }
      window.location.href = url.href;
    }
  });

  // Hiển thị giá trị mặc định
  const valueCurrent = url.searchParams.get("keyword");
  if (valueCurrent) {
    search.value = valueCurrent;
  }
}
// End Search

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

// Tour Edit Form
const tourEditForm = document.querySelector("#tour-edit-form");
wireTourCategoryTree(tourEditForm);
if (tourEditForm) {
  const validator = new JustValidate("#tour-edit-form");

  // ==== CẤU HÌNH GIÁ EM BÉ THEO BẬC ====
  const modeSel = tourEditForm.querySelector("#babyPricingMode");
  const rulesWrapper = document.querySelector("#baby-pricing-rules-wrapper");
  const rulesBody = document.querySelector("#baby-rules-body");
  const rulesHidden = document.querySelector("#babyPricingRulesJson");

  const priceBabyInput = tourEditForm.querySelector('input[name="priceBaby"]');
  const priceNewBabyInput = tourEditForm.querySelector(
    'input[name="priceNewBaby"]'
  );

  function createRuleRow(from = "", to = "", percent = "", ref = "children") {
    const row = document.createElement("div");
    row.className = "baby-rule-row";
    row.innerHTML = `
      <div class="baby-rules-cell">
        <input class="rule-from" type="number" min="1" value="${from}">
      </div>
      <div class="baby-rules-cell">
        <input class="rule-to" type="number" min="1"
               placeholder="VD: 2 (hoặc bỏ trống = trở lên)"
               value="${to === "inf" ? "" : to}">
      </div>
      <div class="baby-rules-cell">
        <input class="rule-percent" type="number" min="0" max="100" value="${percent}">
      </div>
      <div class="baby-rules-cell">
        <select class="rule-ref">
          <option value="children" ${
            ref === "children" ? "selected" : ""
          }>Giá Trẻ em</option>
          <option value="adult" ${
            ref === "adult" ? "selected" : ""
          }>Giá Người lớn</option>
        </select>
      </div>
      <div class="baby-rules-cell">
        <button type="button" class="baby-rule-remove type-button">Xóa</button>
      </div>
    `;
    return row;
  }

  function loadRulesFromHidden() {
    if (!rulesBody) return;
    rulesBody.innerHTML = "";
    let arr = [];
    try {
      arr = JSON.parse(rulesHidden?.value || "[]");
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    if (arr.length === 0) {
      rulesBody.appendChild(createRuleRow());
    } else {
      arr.forEach((r) => {
        rulesBody.appendChild(
          createRuleRow(
            r.from || "",
            r.to ?? "",
            r.percent || "",
            r.ref || "children"
          )
        );
      });
    }
  }

  function collectBabyRules() {
    if (!rulesBody) return [];
    const rows = rulesBody.querySelectorAll(".baby-rule-row");
    const rules = [];
    rows.forEach((row) => {
      const fromEl = row.querySelector(".rule-from");
      const toEl = row.querySelector(".rule-to");
      const percentEl = row.querySelector(".rule-percent");
      const refEl = row.querySelector(".rule-ref");

      const from = Number(fromEl?.value || "");
      const toRaw = toEl?.value || "";
      const percent = Number(percentEl?.value || "");
      const ref = refEl?.value === "adult" ? "adult" : "children";

      if (!Number.isFinite(from)) return;
      let to = "inf";
      if (toRaw !== "") {
        const toNum = Number(toRaw);
        if (!Number.isFinite(toNum)) return;
        to = toNum;
      }
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;

      rules.push({ from, to, percent, ref });
    });
    return rules;
  }

  function syncBabyModeUI() {
    const mode = modeSel?.value || "fixed";
    const isTiered = mode === "tiered";

    if (rulesWrapper) {
      rulesWrapper.style.display = isTiered ? "block" : "none";
    }

    if (priceBabyInput) {
      if (isTiered) {
        priceBabyInput.value = "";
        priceBabyInput.disabled = true;
      } else {
        priceBabyInput.disabled = false;
      }
    }
    if (priceNewBabyInput) {
      if (isTiered) {
        priceNewBabyInput.value = "";
        priceNewBabyInput.disabled = true;
      } else {
        priceNewBabyInput.disabled = false;
      }
    }
  }

  const addRuleBtn = document.querySelector("#baby-rule-add");
  if (addRuleBtn && rulesBody) {
    addRuleBtn.addEventListener("click", () => {
      rulesBody.appendChild(createRuleRow());
    });

    rulesBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".baby-rule-remove");
      if (btn) {
        const row = btn.closest(".baby-rule-row");
        if (row && rulesBody.children.length > 1) {
          row.remove();
        }
      }
    });
  }

  if (modeSel) {
    modeSel.addEventListener("change", syncBabyModeUI);
  }
  loadRulesFromHidden();
  syncBabyModeUI();
  // ==== HẾT CẤU HÌNH GIÁ EM BÉ THEO BẬC ====

  // ==== THỜI HẠN KHUYẾN MÃI THEO GIÁ CỐ ĐỊNH (EDIT) ====
  const oldAdultInputE = tourEditForm.querySelector("#priceAdult");
  const oldChildrenInputE = tourEditForm.querySelector("#priceChildren");
  const oldBabyInputE = tourEditForm.querySelector("#priceBaby");

  const discountWrapperE = tourEditForm.querySelector("#manual-discount-group");
  const discountFromInputE = tourEditForm.querySelector("#discountFrom");
  const discountToInputE = tourEditForm.querySelector("#discountTo");

  function hasOldPriceEdit() {
    const a = parseInt(oldAdultInputE?.value || "0", 10) || 0;
    const c = parseInt(oldChildrenInputE?.value || "0", 10) || 0;
    const b = parseInt(oldBabyInputE?.value || "0", 10) || 0;
    return a > 0 || c > 0 || b > 0;
  }

  function syncManualDiscountVisibilityEdit() {
    if (!discountWrapperE) return;
    if (hasOldPriceEdit()) {
      discountWrapperE.style.display = "";
    } else {
      discountWrapperE.style.display = "none";
      if (discountFromInputE) discountFromInputE.value = "";
      if (discountToInputE) discountToInputE.value = "";
    }
  }

  [oldAdultInputE, oldChildrenInputE, oldBabyInputE].forEach((el) => {
    if (el) el.addEventListener("input", syncManualDiscountVisibilityEdit);
  });

  // chạy 1 lần khi load form với dữ liệu hiện tại
  syncManualDiscountVisibilityEdit();
  // ==== HẾT THỜI HẠN KHUYẾN MÃI THEO GIÁ CỐ ĐỊNH ====

  // ==== ĐỊA ĐIỂM CÓ TRONG TOUR (UI nhiều điểm đến) ====
  const locationsWrapperE = tourEditForm.querySelector(
    "#tour-locations-wrapper"
  );
  const locationAddBtnE = tourEditForm.querySelector("#location-add-btn");
  const countriesGroupE = tourEditForm.querySelector("#tour-countries-group");
  const vietnamLocationsGroupE = tourEditForm.querySelector("#vietnam-locations-group");
  const countryCheckboxesE = tourEditForm.querySelectorAll(".tour-country-checkbox");
  
  console.log("Tour Edit Form - Found elements:", {
    countriesGroup: !!countriesGroupE,
    vietnamLocationsGroup: !!vietnamLocationsGroupE,
    countryCheckboxes: countryCheckboxesE.length
  });

  // Hàm lấy danh sách thành phố của một quốc gia cụ thể (cho form edit)
  function getCitiesByCountryIdEdit(countryId) {
    if (!countryId) return [];
    const countryIdStr = String(countryId);
    const cities = window.europeanCities || [];
    
    return cities.filter((city) => {
      // Kiểm tra nhiều cách lấy countryId
      let cityCountryId = null;
      if (city.countryId) {
        if (typeof city.countryId === 'object') {
          // Nếu là object, lấy _id
          cityCountryId = city.countryId._id ? String(city.countryId._id) : null;
        } else {
          // Nếu là string hoặc giá trị khác, convert sang string
          cityCountryId = String(city.countryId);
        }
      }
      
      // So sánh
      return cityCountryId && String(cityCountryId) === countryIdStr;
    });
  }

  // Hàm tạo location item cho quốc gia cụ thể (cho form edit)
  function createLocationItemForCountryEdit(countryId) {
    const div = document.createElement("div");
    div.className = "tour-location-item";
    div.setAttribute("data-country-id", countryId);

    const cities = getCitiesByCountryIdEdit(countryId);
    const cityOptions = cities
      .map(
        (city) =>
          `<option value="${city._id || city.id}">${city.name}</option>`
      )
      .join("");

    div.innerHTML = `
      <div class="inner-input-list">
        <div class="inner-input-item">
          <label>Điểm đến</label>
          <select class="location-city" data-country-id="${countryId}">
            <option value="">-- Chọn thành phố --</option>
            ${cityOptions}
          </select>
        </div>
        <div class="inner-input-item">
          <label>Các địa điểm nổi tiếng</label>
          <div class="location-spots-list">
            <div class="location-spot-item">
              <div class="spot-input-group">
                <textarea class="spot-input" placeholder="VD: Tháp Eiffel" rows="2"></textarea>
                <button type="button" class="spot-remove-btn">Xóa</button>
              </div>
            </div>
          </div>
          <div class="spot-actions">
            <button type="button" class="spot-add-btn">+ Thêm địa điểm</button>
          </div>
        </div>
      </div>
      <div class="location-actions">
        <button type="button" class="location-remove-btn">Xóa điểm đến</button>
      </div>
    `;
    return div;
  }

  // Hàm tạo location item cho Việt Nam (cho form edit)
  function createLocationItemEdit() {
    const div = document.createElement("div");
    div.className = "tour-location-item";

    const vietnamCities = window.vietnamCities || [];
    const cityOptions = vietnamCities
      .map(
        (city) =>
          `<option value="${city._id || city.id}">${city.name}</option>`
      )
      .join("");

    div.innerHTML = `
      <div class="inner-input-list">
        <div class="inner-input-item">
          <label>Điểm đến</label>
          <select class="location-city">
            <option value="">-- Chọn tỉnh/thành --</option>
            ${cityOptions}
          </select>
        </div>
        <div class="inner-input-item">
          <label>Các địa điểm nổi tiếng</label>
          <div class="location-spots-list">
            <div class="location-spot-item">
              <div class="spot-input-group">
                <textarea class="spot-input" placeholder="VD: Chùa Linh Ứng" rows="2"></textarea>
                <button type="button" class="spot-remove-btn">Xóa</button>
              </div>
            </div>
          </div>
          <div class="spot-actions">
            <button type="button" class="spot-add-btn">+ Thêm địa điểm</button>
          </div>
        </div>
      </div>
      <div class="location-actions">
        <button type="button" class="location-remove-btn">Xóa điểm đến</button>
      </div>
    `;
    return div;
  }

  // Xử lý khi chọn/bỏ chọn quốc gia (cho form edit)
  console.log("Tour Edit - Found", countryCheckboxesE.length, "country checkboxes");
  if (countryCheckboxesE.length > 0) {
    countryCheckboxesE.forEach((checkbox, idx) => {
      console.log(`Tour Edit - Setting up listener for checkbox ${idx + 1}:`, checkbox.value, checkbox.id);
      checkbox.addEventListener("change", (e) => {
        console.log("Tour Edit - Checkbox change event fired!", checkbox.value, checkbox.checked);
        const countryId = String(checkbox.value); // Đảm bảo là string
        const countryItem = checkbox.closest(".country-item");
        const locationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
        
        console.log("Tour Edit - Elements found:", {
          countryId: countryId,
          countryItem: !!countryItem,
          locationsWrapper: !!locationsWrapper
        });
        
        if (checkbox.checked && locationsWrapper) {
          // Hiển thị khối địa điểm của quốc gia
          locationsWrapper.style.display = "";
          
          // Lấy danh sách cities cho quốc gia này
          const cities = getCitiesByCountryIdEdit(countryId);
          console.log("Tour Edit - Country checkbox checked - countryId:", countryId, "found cities:", cities.length);
          if (cities.length > 0) {
            console.log("Tour Edit - First few cities:", cities.slice(0, 3).map(c => c.name));
          }
          
          // Kiểm tra xem đã có location item nào chưa
          const existingItems = locationsWrapper.querySelectorAll(".tour-location-item");
          console.log("Tour Edit - Found", existingItems.length, "existing location items");
          
          // Luôn cập nhật tất cả location items (cả mới và cũ)
          existingItems.forEach((item, idx) => {
            const select = item.querySelector(".location-city");
            if (select) {
              const currentValue = select.value;
              console.log(`Tour Edit - Updating select ${idx + 1} for countryId: ${countryId}, current value:`, currentValue);
              console.log(`Tour Edit - Cities to add:`, cities.length);
              
              // Xóa tất cả options (trừ option đầu tiên)
              while (select.options.length > 1) {
                select.remove(1);
              }
              
              // Thêm các thành phố
              if (cities.length > 0) {
                cities.forEach((city, cityIdx) => {
                  const option = document.createElement("option");
                  option.value = city._id || city.id;
                  option.textContent = city.name;
                  select.appendChild(option);
                  if (cityIdx < 3) {
                    console.log(`Tour Edit - Added city option: ${city.name} (${city._id || city.id})`);
                  }
                });
                console.log(`Tour Edit - Select ${idx + 1} updated with`, select.options.length, "options total");
              } else {
                console.warn(`Tour Edit - No cities to add for countryId: ${countryId}`);
              }
              
              // Khôi phục giá trị nếu còn tồn tại
              if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
                select.value = currentValue;
              }
            } else {
              console.warn(`Tour Edit - No select found in location item ${idx + 1}`);
            }
          });
          
          // Nếu chưa có location item nào, tạo một item mới
          if (existingItems.length === 0) {
            console.log("Tour Edit - No existing items, creating new location item");
            const firstItem = createLocationItemForCountryEdit(countryId);
            const locationGlobalActions = locationsWrapper.querySelector(".location-global-actions");
            if (locationGlobalActions) {
              locationsWrapper.insertBefore(firstItem, locationGlobalActions);
            } else {
              locationsWrapper.appendChild(firstItem);
            }
            
            // Kiểm tra lại sau khi tạo
            const select = firstItem.querySelector(".location-city");
            console.log("Tour Edit - After creation - Select has", select?.options.length, "options");
            if (select) {
              console.log("Tour Edit - Select options:", Array.from(select.options).map(opt => ({value: opt.value, text: opt.textContent})));
            }
          }
        } else if (!checkbox.checked && locationsWrapper) {
          // Ẩn khối địa điểm của quốc gia
          locationsWrapper.style.display = "none";
        }
      });
    });
  }

  // Xử lý nút "Thêm điểm đến" cho mỗi quốc gia (cho form edit)
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".country-location-add-btn");
    if (addBtn && tourEditForm.contains(addBtn)) {
      const countryId = addBtn.getAttribute("data-country-id");
      const countryItem = addBtn.closest(".country-item");
      const locationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
      
      if (locationsWrapper && countryId) {
        const newItem = createLocationItemForCountryEdit(countryId);
        const locationGlobalActions = locationsWrapper.querySelector(".location-global-actions");
        if (locationGlobalActions) {
          locationsWrapper.insertBefore(newItem, locationGlobalActions);
        } else {
          locationsWrapper.appendChild(newItem);
        }
      }
    }
  });

  // Xử lý xóa location item trong khối quốc gia (cho form edit)
  document.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".location-remove-btn");
    if (removeBtn && tourEditForm.contains(removeBtn)) {
      const locationItem = removeBtn.closest(".tour-location-item");
      const locationsWrapper = locationItem?.closest(".country-locations-wrapper") || 
                               locationItem?.closest("#tour-locations-wrapper");
      
      if (locationItem && locationsWrapper) {
        const allItems = locationsWrapper.querySelectorAll(".tour-location-item");
        if (allItems.length > 1) {
          locationItem.remove();
        } else {
          // Nếu chỉ còn 1 item, chỉ xóa giá trị thay vì xóa item
          const citySelect = locationItem.querySelector(".location-city");
          if (citySelect) citySelect.value = "";
          locationItem.querySelectorAll(".spot-input").forEach(t => t.value = "");
        }
      }
    }
  });

  if (locationAddBtnE && locationsWrapperE) {
    locationAddBtnE.addEventListener("click", () => {
      locationsWrapperE.appendChild(createLocationItemEdit());
    });

    locationsWrapperE.addEventListener("click", (e) => {
      const btn = e.target.closest(".location-remove-btn");
      if (btn) {
        const item = btn.closest(".tour-location-item");
        if (item && locationsWrapperE.children.length > 1) {
          item.remove();
        }
      }
    });
  }
  // ==== HẾT ĐỊA ĐIỂM CÓ TRONG TOUR (UI) ====

  // ==== LỊCH KHỞI HÀNH (UI - EDIT): cặp ngày khởi hành + kết thúc ====
  const departuresWrapperE = document.getElementById("departures-wrapper");
  const departurePairAddBtnE = document.getElementById("departure-pair-add-btn");

  function createDeparturePairItemEdit() {
    const div = document.createElement("div");
    div.className = "departure-pair-item";
    div.setAttribute("data-index", Date.now());
    div.innerHTML = `
      <div class="departure-pair-inputs">
        <div class="departure-pair-field">
          <label>Ngày khởi hành</label>
          <input type="date" class="departure-date-input">
        </div>
        <div class="departure-pair-field">
          <label>Ngày kết thúc</label>
          <input type="date" class="end-date-input">
        </div>
        <div class="departure-pair-field">
          <label>Tổng số ghế</label>
          <input type="number" class="seats-total-input" min="0" placeholder="VD: 40">
        </div>
        <div class="departure-pair-field">
          <label>Ghế còn lại</label>
          <input type="number" class="seats-remaining-input" min="0" placeholder="VD: 40">
        </div>
      </div>
      <div class="departure-pair-field departure-pair-field--remove">
        <label aria-hidden="true">&nbsp;</label>
        <button type="button" class="departure-pair-remove-btn">Xóa</button>
      </div>
    `;
    return div;
  }

  if (departurePairAddBtnE && departuresWrapperE) {
    departurePairAddBtnE.addEventListener("click", () => {
      departuresWrapperE.appendChild(createDeparturePairItemEdit());
    });

    departuresWrapperE.addEventListener("click", (e) => {
      const btn = e.target.closest(".departure-pair-remove-btn");
      if (btn) {
        const item = btn.closest(".departure-pair-item");
        if (item && departuresWrapperE.children.length > 1) {
          item.remove();
        } else if (item) {
          item.querySelector(".departure-date-input").value = "";
          item.querySelector(".end-date-input").value = "";
        }
      }
    });
  }
  // ==== HẾT LỊCH KHỞI HÀNH (UI - EDIT) ====

  validator
    .addField("#name", [
      { rule: "required", errorMessage: "Vui lòng nhập tên tour!" },
    ])
    .onSuccess((event) => {
      const f = event.target;

      // Lấy ID tour từ input hidden
      const id = f.querySelector("#tourId")?.value || "";
      if (!id) {
        notify.error("Không xác định được ID tour!");
        return;
      }

      const name = f.name.value;
      const categoryIds = collectTourCategoryIds(f);
      const position = f.position.value;
      const status = f.status.value;
      let avatarFile = filePond.avatar.getFile()?.file;
      // Nếu FilePond đang giữ ảnh mặc định cũ (cùng tên file) thì bỏ qua
      // để không gửi lại → tránh audit log báo "đổi ảnh đại diện" sai.
      if (avatarFile) {
        const avatarInput = f.querySelector('input[name="avatar"]');
        const imageDefault = avatarInput
          ?.closest("[image-default]")
          ?.getAttribute("image-default");
        if (imageDefault && imageDefault.includes(avatarFile.name)) {
          avatarFile = null;
        }
      }

      // Giá
      let priceAdult = f.priceAdult.value;
      let priceChildren = f.priceChildren.value;
      let priceBaby = f.priceBaby.value;
      let priceNewAdult = f.priceNewAdult.value;
      let priceNewChildren = f.priceNewChildren.value;
      let priceNewBaby = f.priceNewBaby?.value ?? "";

      // Cấu hình Em bé
      const babyPricingMode = f.babyPricingMode?.value || "fixed";
      let babyPricingRulesJson = "";

      if (babyPricingMode === "tiered") {
        priceBaby = "";
        priceNewBaby = "";
        const rules = collectBabyRules();
        babyPricingRulesJson = JSON.stringify(rules);
      }

      // ==== LẤY / KIỂM TRA THỜI HẠN KHUYẾN MÃI (EDIT) ====
      const hasManualOldPriceE = hasOldPriceEdit();
      const discountFromE = discountFromInputE?.value || "";
      const discountToE = discountToInputE?.value || "";

      if (hasManualOldPriceE) {
        if (!discountFromE || !discountToE) {
          notify.error(
            "Vui lòng nhập Từ ngày / Đến ngày khuyến mãi, hoặc xóa hết giá cũ (Người lớn / Trẻ em / Em bé)!"
          );
          return;
        }
      }
      // ==== HẾT KIỂM TRA THỜI HẠN KHUYẾN MÃI (EDIT) ====

      // ==== ĐIỂM KHỞI HÀNH ====
      const departureCity = f.departureCity?.value || "";

      // ==== ĐỊA ĐIỂM CÓ TRONG TOUR (mảng { cityId, spots[] }) ====
      const locations = [];
      
      // Kiểm tra xem có quốc gia nào được check không (tour nước ngoài)
      const checkedCountries = tourEditForm.querySelectorAll('.tour-country-checkbox:checked');
      
      if (checkedCountries.length > 0) {
        // Tour nước ngoài: collect từ các .country-locations-wrapper
        console.log("Tour Edit - Collecting locations from", checkedCountries.length, "countries");
        checkedCountries.forEach((checkbox) => {
          const countryId = checkbox.value;
          const countryItem = checkbox.closest(".country-item");
          const countryLocationsWrapper = countryItem?.querySelector(".country-locations-wrapper");
          
          if (countryLocationsWrapper) {
            countryLocationsWrapper
              .querySelectorAll(".tour-location-item")
              .forEach((item) => {
                const citySelect = item.querySelector(".location-city");
                const cityId = citySelect?.value || "";
                
                // Thu thập spots từ các spot-input textarea
                const spots = [];
                item.querySelectorAll(".spot-input").forEach(textarea => {
                  const value = textarea.value.trim();
                  if (value) spots.push(value);
                });

                if (cityId && spots.length > 0) {
                  locations.push({ cityId, spots });
                  console.log("Tour Edit - Added location:", cityId, "with", spots.length, "spots");
                }
              });
          }
        });
      } else if (locationsWrapperE) {
        // Tour trong nước: collect từ #tour-locations-wrapper
        console.log("Tour Edit - Collecting locations from Vietnam wrapper");
        locationsWrapperE
          .querySelectorAll(".tour-location-item")
          .forEach((item) => {
            const citySelect = item.querySelector(".location-city");
            const cityId = citySelect?.value || "";
            
            // Thu thập spots từ các spot-input textarea
            const spots = [];
            item.querySelectorAll(".spot-input").forEach(textarea => {
              const value = textarea.value.trim();
              if (value) spots.push(value);
            });

            if (cityId && spots.length > 0) {
              locations.push({ cityId, spots });
              console.log("Tour Edit - Added location:", cityId, "with", spots.length, "spots");
            }
          });
      }
      
      console.log("Tour Edit - Total locations collected:", locations.length);

      // ==== LỊCH KHỞI HÀNH (cặp ngày - EDIT) ====
      const departuresWrapperEdit = document.getElementById("departures-wrapper");
      const departuresE = [];
      if (departuresWrapperEdit) {
        departuresWrapperEdit.querySelectorAll(".departure-pair-item").forEach((item) => {
          const depVal = item.querySelector(".departure-date-input")?.value || "";
          const endVal = item.querySelector(".end-date-input")?.value || "";
          const sTotalE = parseInt(item.querySelector(".seats-total-input")?.value) || 0;
          let sRemE = parseInt(item.querySelector(".seats-remaining-input")?.value);
          if (isNaN(sRemE)) sRemE = sTotalE;
          if (sRemE > sTotalE) sRemE = sTotalE;
          if (depVal) departuresE.push({ departureDate: depVal, endDate: endVal || null, seatsTotal: sTotalE, seatsRemaining: sRemE });
        });
      }
      // ==== HẾT LỊCH KHỞI HÀNH ====

      // Khác
      const time = f.time.value;
      const vehicle = f.vehicle.value;
      const information = tinymce.get("information").getContent();

      const scheduleRo =
        tourEditForm.getAttribute("data-schedule-readonly") === "1";
      let schedules = [];
      if (scheduleRo) {
        const roEl = document.getElementById("tour-schedules-json-ro");
        if (roEl && roEl.textContent) {
          try {
            const parsed = JSON.parse(roEl.textContent.trim());
            schedules = Array.isArray(parsed) ? parsed : [];
          } catch (_e) {
            schedules = [];
          }
        }
      } else {
        tourEditForm.querySelectorAll(".inner-schedule-item").forEach((item) => {
          const title =
            item.querySelector(".inner-schedule-head input")?.value || "";
          const textarea = item.querySelector(".inner-schedule-body textarea");
          const tid = textarea?.id;
          const description = tid ? tinymce.get(tid).getContent() : "";
          schedules.push({ title, description });
        });
      }

      // FormData
      const formData = new FormData();
      formData.append("customId", (tourEditForm.querySelector("#customId")?.value || "").trim());
      formData.append("name", name);
      categoryIds.forEach((id) => formData.append("categories", id));
      formData.append("category", categoryIds[0] || "");
      formData.append("position", position);
      formData.append("status", status);
      if (avatarFile) formData.append("avatar", avatarFile);

      // Giá
      formData.append("priceAdult", priceAdult);
      formData.append("priceChildren", priceChildren);
      formData.append("priceBaby", priceBaby);
      formData.append("priceNewAdult", priceNewAdult);
      formData.append("priceNewChildren", priceNewChildren);
      formData.append("priceNewBaby", priceNewBaby);

      // Cấu hình Em bé
      formData.append("babyPricingMode", babyPricingMode);
      formData.append("babyPricingRulesJson", babyPricingRulesJson);
      const maxBabiesPerAdultEl = tourEditForm.querySelector("#maxBabiesPerAdult");
      const babySeatFeeEl = tourEditForm.querySelector("#babySeatFee");
      const maxBabiesPerAdult = maxBabiesPerAdultEl
        ? Math.max(0, parseInt(maxBabiesPerAdultEl.value, 10) || 0)
        : 1;
      const babySeatFee =
        maxBabiesPerAdult === 0
          ? 0
          : babySeatFeeEl
          ? Math.max(0, parseInt(babySeatFeeEl.value, 10) || 0)
          : 0;
      formData.append("maxBabiesPerAdult", maxBabiesPerAdult);
      formData.append("babySeatFee", babySeatFee);

      // ==== GỬI THỜI HẠN KHUYẾN MÃI NẾU CÓ (EDIT) ====
      if (hasManualOldPriceE && discountFromE && discountToE) {
        formData.append("discountFrom", discountFromE);
        formData.append("discountTo", discountToE);
      }
      // ==== HẾT GỬI THỜI HẠN (EDIT) ====

      // Điểm khởi hành + Địa điểm có trong tour
      formData.append("departureCity", departureCity);
      formData.append("locations", JSON.stringify(locations));

      // Khác
      formData.append("time", time);
      formData.append("vehicle", vehicle);
      formData.append("departures", JSON.stringify(departuresE));
      formData.append("information", information);
      formData.append("schedules", JSON.stringify(schedules));

      // Điểm nổi bật, bao gồm, không bao gồm - Thu thập từ các textarea riêng biệt
      const highlightsArrayE = [];
      tourEditForm.querySelectorAll('.highlight-input').forEach(textarea => {
        const value = textarea.value.trim();
        if (value) highlightsArrayE.push(value);
      });
      
      const includesArrayE = [];
      tourEditForm.querySelectorAll('.include-input').forEach(textarea => {
        const value = textarea.value.trim();
        if (value) includesArrayE.push(value);
      });
      
      const excludesArrayE = [];
      tourEditForm.querySelectorAll('.exclude-input').forEach(textarea => {
        const value = textarea.value.trim();
        if (value) excludesArrayE.push(value);
      });
      
      formData.append("highlights", highlightsArrayE.join('\n'));
      formData.append("includes", includesArrayE.join('\n'));
      formData.append("excludes", excludesArrayE.join('\n'));

      // Tags (loại hình trải nghiệm)
      const tagsCheckboxesE = f.querySelectorAll('input[name="tags"]:checked');
      const tagsE = Array.from(tagsCheckboxesE).map(cb => cb.value);
      tagsE.forEach(tag => {
        formData.append("tags", tag);
      });

      // images
      if (filePondMulti.images.getFiles().length > 0) {
        filePondMulti.images.getFiles().forEach((item) => {
          formData.append("images", item.file);
        });
      }
      // End images

      const tourPatchUrl =
        tourEditForm.getAttribute("data-patch-url") ||
        `/${pathAdmin}/tour/edit/${id}`;
      fetch(tourPatchUrl, {
        method: "PATCH",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code === "error") {
            // Khi server từ chối bật hiển thị, kèm reasons[] chi tiết
            if (Array.isArray(data.reasons) && data.reasons.length > 0) {
              const lines = [data.message || "Không thể lưu tour:"];
              lines.push("");
              data.reasons.forEach((r) => lines.push("• " + r));
              window.alert(lines.join("\n"));
              return;
            }
            return notify.error(data.message);
          }
          if (data.code === "success") notify.success(data.message);
        });
    });
}
// End Tour Edit Form

const bulkForm = document.querySelector("#bulk-discount-form");
if (bulkForm) {
  bulkForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const percent = Number(bulkForm.percent.value);

    // tên input trong pug: name="discountFrom", name="discountTo"
    const discountFrom = bulkForm.discountFrom?.value;
    const discountTo = bulkForm.discountTo?.value;

    if (!Number.isFinite(percent) || percent < 1 || percent > 90) {
      return notify.error("Phần trăm giảm phải từ 1 đến 90!");
    }

    if (!discountFrom || !discountTo) {
      return notify.error(
        "Vui lòng chọn thời gian bắt đầu và kết thúc khuyến mãi!"
      );
    }
    if (discountFrom > discountTo) {
      return notify.error("Ngày bắt đầu không được lớn hơn ngày kết thúc!");
    }

    // Lấy danh sách tour đang được tick
    const ids = [];
    document.querySelectorAll("[check-item]:checked").forEach((input) => {
      const id = input.getAttribute("check-item");
      if (id) ids.push(id);
    });

    if (ids.length === 0) {
      return notify.error("Vui lòng chọn ít nhất 1 tour để áp dụng giảm giá!");
    }

    if (
      !confirm(
        `Giảm ${percent}% giá NL/TE/EB cho ${ids.length} tour đã chọn từ ${discountFrom} đến ${discountTo}?`
      )
    )
      return;

    const submitBtn = bulkForm.querySelector('button[type="submit"]');
    submitBtn && (submitBtn.disabled = true);

    try {
      const res = await fetch(`/${pathAdmin}/tour/bulk-discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent, ids, discountFrom, discountTo }),
      });
      const data = await res.json();
      drawNotify(data.code, data.message);
      if (data.code === "success") window.location.reload();
    } catch (err) {
      console.error(err);
      notify.error("Không thể kết nối máy chủ!");
    } finally {
      submitBtn && (submitBtn.disabled = false);
    }
  });
}

// public/admin/assets/js/script.js (thêm đoạn này)
const companyInfoForm = document.querySelector("#company-info-form");
if (companyInfoForm) {
  companyInfoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData();

    // Text: tổng quan công ty
    const overviewEl = companyInfoForm.querySelector('textarea[name="overview"]');
    if (overviewEl) {
      fd.append("overview", overviewEl.value || "");
    }

    // Thông tin liên hệ & chính sách
    const addressEl = companyInfoForm.querySelector('input[name="address"]');
    const emailEl = companyInfoForm.querySelector('input[name="email"]');
    const hotlineEl = companyInfoForm.querySelector('input[name="hotline"]');
    const foundedYearEl = companyInfoForm.querySelector('input[name="foundedYear"]');
    const cancelTourEl = companyInfoForm.querySelector('textarea[name="cancelPolicyTour"]');
    const cancelHotelEl = companyInfoForm.querySelector('textarea[name="cancelPolicyHotel"]');

    if (addressEl) fd.append("address", addressEl.value || "");
    if (emailEl) fd.append("email", emailEl.value || "");
    if (hotlineEl) fd.append("hotline", hotlineEl.value || "");
    if (foundedYearEl) fd.append("foundedYear", foundedYearEl.value || "");
    if (cancelTourEl) fd.append("cancelPolicyTour", cancelTourEl.value || "");
    if (cancelHotelEl) fd.append("cancelPolicyHotel", cancelHotelEl.value || "");

    // Lấy file từ FilePond (nếu bạn đã khởi tạo filepond-image)
    const bannerFile =
      filePond?.banner?.getFile?.()?.file ||
      document.querySelector("#banner")?.files?.[0];
    const logoFile =
      filePond?.logo?.getFile?.()?.file ||
      document.querySelector("#logo")?.files?.[0];

    if (bannerFile) fd.append("banner", bannerFile);
    if (logoFile) fd.append("logo", logoFile);

    try {
      const res = await fetch(`/${pathAdmin}/company/info`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      drawNotify(data.code, data.message);
      if (data.code === "success") window.location.reload();
    } catch {
      notify.error("Không thể kết nối máy chủ!");
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const page = document.querySelector(".discount-page");
  if (!page) return;

  // pathAdmin (vd: "admin") lấy từ data-attribute hoặc biến global
  const pathAdminAttr = page.dataset.pathAdmin || window.pathAdmin || "admin";
  const basePath = "/" + pathAdminAttr;

  // Lặp qua từng dòng tour trong bảng khuyến mãi
  document.querySelectorAll("tr[data-tour-row]").forEach(function (row) {
    const id = row.dataset.id;
    if (!id) return;

    // Có thể KHÔNG có form % giảm (tour “Giảm linh hoạt”)
    const form = row.querySelector(".discount-form");
    const percentInput = form
      ? form.querySelector('input[name="percent"]')
      : null;

    const discountFromInput = row.querySelector('input[name="discountFrom"]');
    const discountToInput = row.querySelector('input[name="discountTo"]');

    const btnSave = row.querySelector(".btn-save");
    const btnCancel = row.querySelector(".btn-cancel-discount");

    // ====== LƯU: cập nhật % giảm (nếu có) + thời gian ======
    if (btnSave) {
      btnSave.addEventListener("click", async function () {
        const payload = {
          discountFrom: discountFromInput ? discountFromInput.value : "",
          discountTo: discountToInput ? discountToInput.value : "",
        };

        // Chỉ gửi percent nếu tồn tại ô input (tức là tour giảm theo %)
        if (percentInput && percentInput.value !== "") {
          payload.percent = percentInput.value;
        }

        try {
          const res = await fetch(`${basePath}/tour/discount/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();

          if (typeof drawNotify === "function") {
            drawNotify(data.code, data.message);
          } else {
            alert(data.message || "Đã cập nhật khuyến mãi");
          }

          if (data.code === "success") {
            window.location.reload();
          }
        } catch (err) {
          console.error(err);
          if (typeof notify?.error === "function") {
            notify.error("Lỗi kết nối máy chủ!");
          } else {
            alert("Lỗi kết nối máy chủ!");
          }
        }
      });
    }

    // ====== HỦY KHUYẾN MÃI ======
    if (btnCancel) {
      btnCancel.addEventListener("click", async function () {
        if (!confirm("Bạn có chắc muốn hủy khuyến mãi tour này?")) return;

        try {
          const res = await fetch(`${basePath}/tour/discount/${id}/cancel`, {
            method: "PATCH",
          });
          const data = await res.json();

          if (typeof drawNotify === "function") {
            drawNotify(data.code, data.message);
          } else {
            alert(data.message || "Đã hủy khuyến mãi");
          }

          if (data.code === "success") {
            window.location.reload();
          }
        } catch (err) {
          console.error(err);
          if (typeof notify?.error === "function") {
            notify.error("Lỗi kết nối máy chủ!");
          } else {
            alert("Lỗi kết nối máy chủ!");
          }
        }
      });
    }
  });
});

// ================== HOTEL CREATE FORM ==================
const hotelCreateForm = document.querySelector("#hotel-create-form");
if (hotelCreateForm) {
  const validator = new JustValidate("#hotel-create-form");

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên khách sạn!",
      },
    ])
    .onSuccess((event) => {
      // --- các field cơ bản ---
      const name = event.target.name.value;
      const province = event.target.province?.value || "";
      const address = event.target.address.value;
      const starRating = event.target.starRating.value;
      const basePrice = event.target.basePrice.value;
      const currency = event.target.currency.value;
      const status = event.target.status.value;

      // --- các field mới (textarea / input) ---
      const checkinTimeFrom = event.target.checkinTimeFrom.value;
      const checkoutTimeTo = event.target.checkoutTimeTo.value;
      const earlyCheckinTime = event.target.earlyCheckinTime?.value || "";
      const earlyCheckinFee = event.target.earlyCheckinFee?.value || 0;
      const lateCheckoutTime = event.target.lateCheckoutTime?.value || "";
      const lateCheckoutFee = event.target.lateCheckoutFee?.value || 0;
      const numberOfRooms = event.target.numberOfRooms.value;

      // --- FAQ (nhiều dòng) ---
      const faqQuestions = [];
      const faqAnswers = [];
      hotelCreateForm.querySelectorAll(".hotel-faq-row").forEach((row) => {
        const q = row.querySelector('input[name="faqQuestions"]')?.value || "";
        const a = row.querySelector('textarea[name="faqAnswers"]')?.value || "";
        if (q.trim() || a.trim()) {
          faqQuestions.push(q);
          faqAnswers.push(a);
        }
      });

      // --- avatar ---
      const avatar = filePond.avatar.getFile()?.file;

      // --- Loại phòng (room types) ---
      // Hiện tại /admin/hotel/create chỉ hiển thị thông báo; loại phòng quản lý qua /admin/hotel/room-types …
      // Đoạn dưới đây từng đọc từ modal (#hotel-room-modal) hoặc .hotel-room-row — UI đã không còn trên form này.
      // Giữ mảng rỗng: FormData không gửi roomType* → backend parseRoomTypes → [].
      const roomTypeNames = [];
      const roomTypeMaxGuests = [];
      const roomTypeBasePrices = [];
      const roomTypeDescriptions = [];
      const roomTypeSizes = [];
      const roomTypeBedInfos = [];
      const roomTypeViews = [];
      const roomTypeSmokingPolicies = [];
      const roomTypeBathroomAmenities = [];
      const roomTypeRoomAmenities = [];
      /*
      if (window.roomTypesDataForSubmit && window.roomTypesDataForSubmit.length > 0) {
        window.roomTypesDataForSubmit.forEach((room) => {
          roomTypeNames.push(room.name);
          roomTypeMaxGuests.push(room.maxGuests);
          roomTypeBasePrices.push(room.basePrice);
          roomTypeDescriptions.push(room.description);
          roomTypeSizes.push(room.sizeM2 || "");
          roomTypeBedInfos.push(room.bedInfo);
          roomTypeViews.push(room.view);
          roomTypeSmokingPolicies.push(room.smokingPolicy);
          room.bathroomAmenities.forEach(amenity => roomTypeBathroomAmenities.push(amenity));
          room.roomAmenities.forEach(amenity => roomTypeRoomAmenities.push(amenity));
        });
      } else {
        hotelCreateForm.querySelectorAll(".hotel-room-row").forEach((row) => {
          const nameInput = row.querySelector('input[name="roomTypeNames"]');
          const guestInput = row.querySelector('input[name="roomTypeMaxGuests"]');
          const priceInput = row.querySelector('input[name="roomTypeBasePrices"]');
          const descInput = row.querySelector('input[name="roomTypeDescriptions"]');

          if (nameInput && nameInput.value.trim()) {
            roomTypeNames.push(nameInput.value);
            roomTypeMaxGuests.push(guestInput?.value || "");
            roomTypeBasePrices.push(priceInput?.value || "");
            roomTypeDescriptions.push(descInput?.value || "");
            roomTypeSizes.push("");
            roomTypeBedInfos.push("");
            roomTypeViews.push("");
            roomTypeSmokingPolicies.push("");
          }
        });
      }
      */

      // --- build FormData ---
      const formData = new FormData();
      formData.append("name", name);
      formData.append("province", province);
      formData.append("address", address);
      formData.append("phone", event.target.phone?.value || "");
      formData.append("googleMapsLink", event.target.googleMapsLink?.value || "");
      formData.append("starRating", starRating);
      formData.append("basePrice", basePrice);
      formData.append("currency", currency);
      
      // Amenities: xử lý từ các amenity items với cấu trúc mới
      const amenityNames = [];
      const amenityFeatures = [];
      
      hotelCreateForm.querySelectorAll('.hotel-amenity-item').forEach(item => {
        const nameInput = item.querySelector('.amenity-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        
        if (name) {
          amenityNames.push(name);
          
          // Thu thập tất cả features của amenity này
          const features = [];
          item.querySelectorAll('.feature-input').forEach(featureTextarea => {
            const featureValue = featureTextarea.value.trim();
            if (featureValue) {
              features.push(featureValue);
            }
          });
          
          // Join các features bằng newline để gửi lên server
          amenityFeatures.push(features.join('\n'));
        }
      });
      
      amenityNames.forEach(v => formData.append("amenityNames", v));
      amenityFeatures.forEach(v => formData.append("amenityFeatures", v));
      
      formData.append("status", status);

      // Highlights: xử lý ảnh và tiêu đề
      const highlightTitles = [];
      const highlightImageInputs = hotelCreateForm.querySelectorAll('input[name="highlightImages"]');
      
      highlightImageInputs.forEach((input, index) => {
        const titleInput = hotelCreateForm.querySelectorAll('input[name="highlightTitles"]')[index];
        const title = titleInput ? titleInput.value.trim() : '';
        
        if (title) {
          highlightTitles.push(title);
          // Nếu có file ảnh mới, append vào formData
          if (input.files && input.files[0]) {
            formData.append("highlightImages", input.files[0]);
          }
        }
      });
      
      // Append titles
      highlightTitles.forEach((title) => formData.append("highlightTitles", title));
      
      // Facilities: xử lý từ các facility items
      const facilityNames = [];
      const facilityCategories = [];
      const facilityImageInputs = hotelCreateForm.querySelectorAll('input[name="facilityImages"]');
      
      hotelCreateForm.querySelectorAll('.hotel-facility-item').forEach((item, index) => {
        const nameInput = item.querySelector('input[name="facilityNames"]');
        const categorySelect = item.querySelector('select[name="facilityCategories"]');
        const categoryCustomInput = item.querySelector('.facility-category-custom-input');
        
        const name = nameInput ? nameInput.value.trim() : '';
        if (name) {
          facilityNames.push(name);
          
          // Ưu tiên lấy giá trị từ input tùy chỉnh nếu có, nếu không thì lấy từ select
          let categoryValue = 'other';
          if (categoryCustomInput && categoryCustomInput.value.trim()) {
            categoryValue = categoryCustomInput.value.trim();
          } else if (categorySelect) {
            categoryValue = categorySelect.value;
          }
          facilityCategories.push(categoryValue);
          
          // Nếu có file ảnh mới, append vào formData
          const imageInput = facilityImageInputs[index];
          if (imageInput && imageInput.files && imageInput.files[0]) {
            formData.append("facilityImages", imageInput.files[0]);
          }
        }
      });
      
      facilityNames.forEach(v => formData.append("facilityNames", v));
      facilityCategories.forEach(v => formData.append("facilityCategories", v));
      
      formData.append("checkinTimeFrom", checkinTimeFrom);
      formData.append("checkoutTimeTo", checkoutTimeTo);
      formData.append("earlyCheckinTime", earlyCheckinTime);
      formData.append("earlyCheckinFee", earlyCheckinFee);
      formData.append("lateCheckoutTime", lateCheckoutTime);
      formData.append("lateCheckoutFee", lateCheckoutFee);
      formData.append("numberOfRooms", numberOfRooms);
      
      // Age Bands (Khối B và C - Đầy đủ)
      const ageBandsList = hotelCreateForm.querySelector('#ageBandsList');
      if (ageBandsList) {
        const ageBandItems = ageBandsList.querySelectorAll('.age-band-item');
        ageBandItems.forEach(item => {
          // Khối B - Thông tin cơ bản
          const name = item.querySelector('.age-band-name')?.value || '';
          const minAge = item.querySelector('.age-band-min')?.value || '0';
          const maxAge = item.querySelector('.age-band-max')?.value || '';
          const bandType = item.querySelector('.age-band-type')?.value || 'adult';
          
          if (name.trim()) {
            formData.append('ageBandNames', name);
            formData.append('ageBandMinAges', minAge);
            formData.append('ageBandMaxAges', maxAge || 'unlimited');
            formData.append('ageBandTypes', bandType);
            
            // Khối C - Thu thập đầy đủ
            // C.1: Occupancy counting
            const countInOccupancy = item.querySelector('.config-count-occupancy')?.checked || false;
            const occupancyWeight = item.querySelector('.config-occupancy-weight')?.value || '1';
            formData.append('ageBandCountInOccupancies', countInOccupancy ? 'on' : '');
            formData.append('ageBandOccupancyWeights', occupancyWeight);
            
            // C.2: Free / Free limit
            const isFree = item.querySelector('.config-is-free')?.checked || false;
            const freeLimit = item.querySelector('.config-free-limit')?.value || '0';
            const feeExceedingFree = item.querySelector('.config-fee-exceeding-free')?.value || '';
            formData.append('ageBandIsFrees', isFree ? 'on' : '');
            formData.append('ageBandFreeLimits', freeLimit);
            formData.append('ageBandFeeExceedingFreeLimits', feeExceedingFree);
            
            // C.3: Breakfast (Khách hàng tự chọn đăng ký, admin chỉ cấu hình phí)
            const breakfastFreeRadio = item.querySelector('.config-breakfast-free')?.checked || false;
            const breakfastPaidRadio = item.querySelector('.config-breakfast-paid')?.checked || false;
            const breakfastFee = item.querySelector('.config-breakfast-fee')?.value || '0';
            formData.append('ageBandBreakfastIsFrees', breakfastFreeRadio ? 'free' : (breakfastPaidRadio ? 'paid' : 'free'));
            formData.append('ageBandBreakfastFees', breakfastFee);
            
            // C.4: Extra person charge (chỉ hiện khi countInOccupancy = true)
            const extraPersonFee = item.querySelector('.config-extra-person-fee')?.value || '0';
            formData.append('ageBandExtraPersonFeePerNights', extraPersonFee);
          }
        });
      }
      
      // Children Policy (GIỮ LẠI ĐỂ TƯƠNG THÍCH NGƯỢC)
      const infant0to1FreeWithExistingBed = hotelCreateForm.querySelector('input[name="infant0to1FreeWithExistingBed"]');
      const infant0to1CribAvailable = hotelCreateForm.querySelector('input[name="infant0to1CribAvailable"]');
      const infant0to1Note = hotelCreateForm.querySelector('input[name="infant0to1Note"]');
      if (infant0to1FreeWithExistingBed && infant0to1FreeWithExistingBed.checked) {
        formData.append("infant0to1FreeWithExistingBed", "on");
      }
      if (infant0to1CribAvailable && infant0to1CribAvailable.checked) {
        formData.append("infant0to1CribAvailable", "on");
      }
      if (infant0to1Note) {
        formData.append("infant0to1Note", infant0to1Note.value || "");
      }
      
      const child2to5FreeWithExistingBed = hotelCreateForm.querySelector('input[name="child2to5FreeWithExistingBed"]');
      const child2to5ExtraBedCharge = hotelCreateForm.querySelector('input[name="child2to5ExtraBedCharge"]');
      const child2to5Note = hotelCreateForm.querySelector('input[name="child2to5Note"]');
      if (child2to5FreeWithExistingBed && child2to5FreeWithExistingBed.checked) {
        formData.append("child2to5FreeWithExistingBed", "on");
      }
      if (child2to5ExtraBedCharge) {
        formData.append("child2to5ExtraBedCharge", child2to5ExtraBedCharge.value || "0");
      }
      if (child2to5Note) {
        formData.append("child2to5Note", child2to5Note.value || "");
      }
      
      const guest6PlusConsideredAdult = hotelCreateForm.querySelector('input[name="guest6PlusConsideredAdult"]');
      const guest6PlusExtraBedRequired = hotelCreateForm.querySelector('input[name="guest6PlusExtraBedRequired"]');
      const guest6PlusExtraBedCharge = hotelCreateForm.querySelector('input[name="guest6PlusExtraBedCharge"]');
      const guest6PlusNote = hotelCreateForm.querySelector('input[name="guest6PlusNote"]');
      if (guest6PlusConsideredAdult && guest6PlusConsideredAdult.checked) {
        formData.append("guest6PlusConsideredAdult", "on");
      }
      if (guest6PlusExtraBedRequired && guest6PlusExtraBedRequired.checked) {
        formData.append("guest6PlusExtraBedRequired", "on");
      }
      if (guest6PlusExtraBedCharge) {
        formData.append("guest6PlusExtraBedCharge", guest6PlusExtraBedCharge.value || "0");
      }
      if (guest6PlusNote) {
        formData.append("guest6PlusNote", guest6PlusNote.value || "");
      }
      
      // Useful Info
      const builtYear = hotelCreateForm.querySelector('input[name="builtYear"]');
      const numberOfFloors = hotelCreateForm.querySelector('input[name="numberOfFloors"]');
      const inRoomVoltage = hotelCreateForm.querySelector('input[name="inRoomVoltage"]');
      const nonSmokingRooms = hotelCreateForm.querySelector('input[name="nonSmokingRooms"]');
      const numberOfRestaurants = hotelCreateForm.querySelector('input[name="numberOfRestaurants"]');
      const numberOfBars = hotelCreateForm.querySelector('input[name="numberOfBars"]');
      const licenseNumber = hotelCreateForm.querySelector('input[name="licenseNumber"]');
      
      if (builtYear) formData.append("builtYear", builtYear.value || "0");
      if (numberOfFloors) formData.append("numberOfFloors", numberOfFloors.value || "0");
      if (inRoomVoltage) formData.append("inRoomVoltage", inRoomVoltage.value || "");
      if (nonSmokingRooms && nonSmokingRooms.checked) {
        formData.append("nonSmokingRooms", "on");
      }
      if (numberOfRestaurants) formData.append("numberOfRestaurants", numberOfRestaurants.value || "0");
      if (numberOfBars) formData.append("numberOfBars", numberOfBars.value || "0");
      if (licenseNumber) formData.append("licenseNumber", licenseNumber.value || "");

      // FAQ – gửi dạng nhiều value
      faqQuestions.forEach((v) => formData.append("faqQuestions", v));
      faqAnswers.forEach((v) => formData.append("faqAnswers", v));

      // avatar
      if (avatar) formData.append("avatar", avatar);

      // room types — cùng logic mảng rỗng ở trên (không gửi khi không có UI trên form create)
      roomTypeNames.forEach((v) => formData.append("roomTypeNames", v));
      roomTypeMaxGuests.forEach((v) => formData.append("roomTypeMaxGuests", v));
      roomTypeBasePrices.forEach((v) => formData.append("roomTypeBasePrices", v));
      roomTypeDescriptions.forEach((v) => formData.append("roomTypeDescriptions", v));
      roomTypeSizes.forEach((v) => formData.append("roomTypeSizes", v));
      roomTypeBedInfos.forEach((v) => formData.append("roomTypeBedInfos", v));
      roomTypeViews.forEach((v) => formData.append("roomTypeViews", v));
      roomTypeSmokingPolicies.forEach((v) => formData.append("roomTypeSmokingPolicies", v));
      roomTypeBathroomAmenities.forEach((v) => formData.append("roomTypeBathroomAmenities", v));
      roomTypeRoomAmenities.forEach((v) => formData.append("roomTypeRoomAmenities", v));

      // images gallery
      if (filePondMulti && filePondMulti.images) {
        filePondMulti.images.getFiles().forEach((item) => {
          formData.append("images", item.file);
        });
      }

      fetch(`/${pathAdmin}/hotel/create`, {
        method: "POST",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code === "error") {
            notify.error(data.message);
          }

          if (data.code === "success") {
            drawNotify(data.code, data.message);
            // Redirect về trang list hotels với hotelId vừa tạo
            setTimeout(() => {
              if (data.hotelId) {
                window.location.href = `/${pathAdmin}/hotel/list?hotelId=${data.hotelId}`;
              } else {
                window.location.href = `/${pathAdmin}/hotel/list`;
              }
            }, 1000);
          }
        });
    });
}
// ================== END HOTEL CREATE FORM ==================

// ================== HOTEL EDIT FORM ==================
const hotelEditForm = document.querySelector("#hotel-edit-form");
if (hotelEditForm && hotelEditForm.dataset.readOnly === "1") {
  // Super admin xem chi tiết: không validate / không PATCH
} else if (hotelEditForm) {
  const validator = new JustValidate("#hotel-edit-form");

  validator
    .addField("#name", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập tên khách sạn!",
      },
    ])
    .onSuccess((event) => {
      const id = event.target.id.value; // như cũ bạn đang dùng

      // --- basic fields ---
      const name = event.target.name.value;
      const province = event.target.province?.value || "";
      const address = event.target.address.value;
      const starRating = event.target.starRating.value;
      const basePrice = event.target.basePrice.value;
      const currency = event.target.currency.value;
      const status = event.target.status.value;

      const checkinTimeFrom = event.target.checkinTimeFrom.value;
      const checkoutTimeTo = event.target.checkoutTimeTo.value;
      const earlyCheckinTime = event.target.earlyCheckinTime?.value || "";
      const earlyCheckinFee = event.target.earlyCheckinFee?.value || 0;
      const lateCheckoutTime = event.target.lateCheckoutTime?.value || "";
      const lateCheckoutFee = event.target.lateCheckoutFee?.value || 0;
      const numberOfRooms = event.target.numberOfRooms.value;

      const faqQuestions = [];
      const faqAnswers = [];
      hotelEditForm.querySelectorAll(".hotel-faq-row").forEach((row) => {
        const q = row.querySelector('input[name="faqQuestions"]')?.value || "";
        const a = row.querySelector('textarea[name="faqAnswers"]')?.value || "";
        if (q.trim() || a.trim()) {
          faqQuestions.push(q);
          faqAnswers.push(a);
        }
      });

      let avatar = filePond.avatar.getFile()?.file;
      if (avatar) {
        const avatarInput = hotelEditForm.querySelector('input[name="avatar"]');
        const imageDefault = avatarInput
          ?.closest("[image-default]")
          ?.getAttribute("image-default");
        if (imageDefault && imageDefault.includes(avatar.name)) {
          avatar = null;
        }
      }

      // --- Loại phòng (room types) ---
      // Form /admin/hotel/edit hiện không có modal / .hotel-room-row; loại phòng sửa ở trang quản lý riêng.
      const roomTypeNames = [];
      const roomTypeMaxGuests = [];
      const roomTypeBasePrices = [];
      const roomTypeDescriptions = [];
      const roomTypeSizes = [];
      const roomTypeBedInfos = [];
      const roomTypeViews = [];
      const roomTypeSmokingPolicies = [];
      const roomTypeBathroomAmenities = [];
      const roomTypeRoomAmenities = [];
      /*
      if (window.roomTypesDataForSubmit && window.roomTypesDataForSubmit.length > 0) {
        window.roomTypesDataForSubmit.forEach((room) => {
          roomTypeNames.push(room.name);
          roomTypeMaxGuests.push(room.maxGuests);
          roomTypeBasePrices.push(room.basePrice);
          roomTypeDescriptions.push(room.description);
          roomTypeSizes.push(room.sizeM2 || "");
          roomTypeBedInfos.push(room.bedInfo);
          roomTypeViews.push(room.view);
          roomTypeSmokingPolicies.push(room.smokingPolicy);
          room.bathroomAmenities.forEach(amenity => roomTypeBathroomAmenities.push(amenity));
          room.roomAmenities.forEach(amenity => roomTypeRoomAmenities.push(amenity));
        });
      } else {
        hotelEditForm.querySelectorAll(".hotel-room-row").forEach((row) => {
          const nameInput = row.querySelector('input[name="roomTypeNames"]');
          const guestInput = row.querySelector('input[name="roomTypeMaxGuests"]');
          const priceInput = row.querySelector('input[name="roomTypeBasePrices"]');
          const descInput = row.querySelector('input[name="roomTypeDescriptions"]');

          if (nameInput && nameInput.value.trim()) {
            roomTypeNames.push(nameInput.value);
            roomTypeMaxGuests.push(guestInput?.value || "");
            roomTypeBasePrices.push(priceInput?.value || "");
            roomTypeDescriptions.push(descInput?.value || "");
            roomTypeSizes.push("");
            roomTypeBedInfos.push("");
            roomTypeViews.push("");
            roomTypeSmokingPolicies.push("");
          }
        });
      }
      */

      const formData = new FormData();
      formData.append("name", name);
      formData.append("province", province);
      formData.append("address", address);
      formData.append("phone", event.target.phone?.value || "");
      formData.append("googleMapsLink", event.target.googleMapsLink?.value || "");
      formData.append("starRating", starRating);
      formData.append("basePrice", basePrice);
      formData.append("currency", currency);
      
      // Amenities: xử lý từ các amenity items với cấu trúc mới
      const amenityNames = [];
      const amenityFeatures = [];
      
      hotelEditForm.querySelectorAll('.hotel-amenity-item').forEach(item => {
        const nameInput = item.querySelector('.amenity-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        
        if (name) {
          amenityNames.push(name);
          
          // Thu thập tất cả features của amenity này
          const features = [];
          item.querySelectorAll('.feature-input').forEach(featureTextarea => {
            const featureValue = featureTextarea.value.trim();
            if (featureValue) {
              features.push(featureValue);
            }
          });
          
          // Join các features bằng newline để gửi lên server
          amenityFeatures.push(features.join('\n'));
        }
      });
      
      amenityNames.forEach(v => formData.append("amenityNames", v));
      amenityFeatures.forEach(v => formData.append("amenityFeatures", v));
      
      formData.append("status", status);

      // Highlights: xử lý ảnh và tiêu đề
      const highlightTitles = [];
      const highlightImageInputs = hotelEditForm.querySelectorAll('input[name="highlightImages"]');
      
      highlightImageInputs.forEach((input, index) => {
        const titleInput = hotelEditForm.querySelectorAll('input[name="highlightTitles"]')[index];
        const title = titleInput ? titleInput.value.trim() : '';
        
        if (title) {
          highlightTitles.push(title);
          // Nếu có file ảnh mới, append vào formData
          if (input.files && input.files[0]) {
            formData.append("highlightImages", input.files[0]);
          }
        }
      });
      
      // Append titles
      highlightTitles.forEach((title) => formData.append("highlightTitles", title));
      
      // Facilities: xử lý từ các facility items
      const facilityNames = [];
      const facilityCategories = [];
      const facilityImageInputs = hotelEditForm.querySelectorAll('input[name="facilityImages"]');
      
      hotelEditForm.querySelectorAll('.hotel-facility-item').forEach((item, index) => {
        const nameInput = item.querySelector('input[name="facilityNames"]');
        const categorySelect = item.querySelector('select[name="facilityCategories"]');
        const categoryCustomInput = item.querySelector('.facility-category-custom-input');
        
        const name = nameInput ? nameInput.value.trim() : '';
        if (name) {
          facilityNames.push(name);
          
          // Ưu tiên lấy giá trị từ input tùy chỉnh nếu có, nếu không thì lấy từ select
          let categoryValue = 'other';
          if (categoryCustomInput && categoryCustomInput.value.trim()) {
            categoryValue = categoryCustomInput.value.trim();
          } else if (categorySelect) {
            categoryValue = categorySelect.value;
          }
          facilityCategories.push(categoryValue);
          
          // Nếu có file ảnh mới, append vào formData
          const imageInput = facilityImageInputs[index];
          if (imageInput && imageInput.files && imageInput.files[0]) {
            formData.append("facilityImages", imageInput.files[0]);
          }
        }
      });
      
      facilityNames.forEach(v => formData.append("facilityNames", v));
      facilityCategories.forEach(v => formData.append("facilityCategories", v));
      
      formData.append("checkinTimeFrom", checkinTimeFrom);
      formData.append("checkoutTimeTo", checkoutTimeTo);
      formData.append("earlyCheckinTime", earlyCheckinTime);
      formData.append("earlyCheckinFee", earlyCheckinFee);
      formData.append("lateCheckoutTime", lateCheckoutTime);
      formData.append("lateCheckoutFee", lateCheckoutFee);
      formData.append("numberOfRooms", numberOfRooms);
      
      // Age Bands (Khối B và C - Đầy đủ)
      const ageBandsList = hotelEditForm.querySelector('#ageBandsList');
      if (ageBandsList) {
        const ageBandItems = ageBandsList.querySelectorAll('.age-band-item');
        ageBandItems.forEach(item => {
          // Khối B - Thông tin cơ bản
          const name = item.querySelector('.age-band-name')?.value || '';
          const minAge = item.querySelector('.age-band-min')?.value || '0';
          const maxAge = item.querySelector('.age-band-max')?.value || '';
          const bandType = item.querySelector('.age-band-type')?.value || 'adult';
          
          if (name.trim()) {
            formData.append('ageBandNames', name);
            formData.append('ageBandMinAges', minAge);
            formData.append('ageBandMaxAges', maxAge || 'unlimited');
            formData.append('ageBandTypes', bandType);
            
            // Khối C - Thu thập đầy đủ
            // C.1: Occupancy counting
            const countInOccupancy = item.querySelector('.config-count-occupancy')?.checked || false;
            const occupancyWeight = item.querySelector('.config-occupancy-weight')?.value || '1';
            formData.append('ageBandCountInOccupancies', countInOccupancy ? 'on' : '');
            formData.append('ageBandOccupancyWeights', occupancyWeight);
            
            // C.2: Free / Free limit
            const isFree = item.querySelector('.config-is-free')?.checked || false;
            const freeLimit = item.querySelector('.config-free-limit')?.value || '0';
            const feeExceedingFree = item.querySelector('.config-fee-exceeding-free')?.value || '';
            formData.append('ageBandIsFrees', isFree ? 'on' : '');
            formData.append('ageBandFreeLimits', freeLimit);
            formData.append('ageBandFeeExceedingFreeLimits', feeExceedingFree);
            
            // C.3: Breakfast (Khách hàng tự chọn đăng ký, admin chỉ cấu hình phí)
            const breakfastFreeRadio = item.querySelector('.config-breakfast-free')?.checked || false;
            const breakfastPaidRadio = item.querySelector('.config-breakfast-paid')?.checked || false;
            const breakfastFee = item.querySelector('.config-breakfast-fee')?.value || '0';
            formData.append('ageBandBreakfastIsFrees', breakfastFreeRadio ? 'free' : (breakfastPaidRadio ? 'paid' : 'free'));
            formData.append('ageBandBreakfastFees', breakfastFee);
            
            // C.4: Extra person charge (chỉ hiện khi countInOccupancy = true)
            const extraPersonFee = item.querySelector('.config-extra-person-fee')?.value || '0';
            formData.append('ageBandExtraPersonFeePerNights', extraPersonFee);
          }
        });
      }
      
      // Children Policy (GIỮ LẠI ĐỂ TƯƠNG THÍCH NGƯỢC)
      const infant0to1FreeWithExistingBed = hotelEditForm.querySelector('input[name="infant0to1FreeWithExistingBed"]');
      const infant0to1CribAvailable = hotelEditForm.querySelector('input[name="infant0to1CribAvailable"]');
      const infant0to1Note = hotelEditForm.querySelector('input[name="infant0to1Note"]');
      if (infant0to1FreeWithExistingBed && infant0to1FreeWithExistingBed.checked) {
        formData.append("infant0to1FreeWithExistingBed", "on");
      }
      if (infant0to1CribAvailable && infant0to1CribAvailable.checked) {
        formData.append("infant0to1CribAvailable", "on");
      }
      if (infant0to1Note) {
        formData.append("infant0to1Note", infant0to1Note.value || "");
      }
      
      const child2to5FreeWithExistingBed = hotelEditForm.querySelector('input[name="child2to5FreeWithExistingBed"]');
      const child2to5ExtraBedCharge = hotelEditForm.querySelector('input[name="child2to5ExtraBedCharge"]');
      const child2to5Note = hotelEditForm.querySelector('input[name="child2to5Note"]');
      if (child2to5FreeWithExistingBed && child2to5FreeWithExistingBed.checked) {
        formData.append("child2to5FreeWithExistingBed", "on");
      }
      if (child2to5ExtraBedCharge) {
        formData.append("child2to5ExtraBedCharge", child2to5ExtraBedCharge.value || "0");
      }
      if (child2to5Note) {
        formData.append("child2to5Note", child2to5Note.value || "");
      }
      
      const guest6PlusConsideredAdult = hotelEditForm.querySelector('input[name="guest6PlusConsideredAdult"]');
      const guest6PlusExtraBedRequired = hotelEditForm.querySelector('input[name="guest6PlusExtraBedRequired"]');
      const guest6PlusExtraBedCharge = hotelEditForm.querySelector('input[name="guest6PlusExtraBedCharge"]');
      const guest6PlusNote = hotelEditForm.querySelector('input[name="guest6PlusNote"]');
      if (guest6PlusConsideredAdult && guest6PlusConsideredAdult.checked) {
        formData.append("guest6PlusConsideredAdult", "on");
      }
      if (guest6PlusExtraBedRequired && guest6PlusExtraBedRequired.checked) {
        formData.append("guest6PlusExtraBedRequired", "on");
      }
      if (guest6PlusExtraBedCharge) {
        formData.append("guest6PlusExtraBedCharge", guest6PlusExtraBedCharge.value || "0");
      }
      if (guest6PlusNote) {
        formData.append("guest6PlusNote", guest6PlusNote.value || "");
      }
      
      // Useful Info
      const builtYear = hotelEditForm.querySelector('input[name="builtYear"]');
      const numberOfFloors = hotelEditForm.querySelector('input[name="numberOfFloors"]');
      const inRoomVoltage = hotelEditForm.querySelector('input[name="inRoomVoltage"]');
      const nonSmokingRooms = hotelEditForm.querySelector('input[name="nonSmokingRooms"]');
      const numberOfRestaurants = hotelEditForm.querySelector('input[name="numberOfRestaurants"]');
      const numberOfBars = hotelEditForm.querySelector('input[name="numberOfBars"]');
      const licenseNumber = hotelEditForm.querySelector('input[name="licenseNumber"]');
      
      if (builtYear) formData.append("builtYear", builtYear.value || "0");
      if (numberOfFloors) formData.append("numberOfFloors", numberOfFloors.value || "0");
      if (inRoomVoltage) formData.append("inRoomVoltage", inRoomVoltage.value || "");
      if (nonSmokingRooms && nonSmokingRooms.checked) {
        formData.append("nonSmokingRooms", "on");
      }
      if (numberOfRestaurants) formData.append("numberOfRestaurants", numberOfRestaurants.value || "0");
      if (numberOfBars) formData.append("numberOfBars", numberOfBars.value || "0");
      if (licenseNumber) formData.append("licenseNumber", licenseNumber.value || "");

      faqQuestions.forEach((v) => formData.append("faqQuestions", v));
      faqAnswers.forEach((v) => formData.append("faqAnswers", v));

      if (avatar) formData.append("avatar", avatar);

      // room types: mảng luôn rỗng (xem comment khối thu thập ở trên); không gửi → không ghi đè roomTypes khi PATCH
      if (roomTypeNames.length > 0) {
        roomTypeNames.forEach((v) => formData.append("roomTypeNames", v));
        roomTypeMaxGuests.forEach((v) => formData.append("roomTypeMaxGuests", v));
        roomTypeBasePrices.forEach((v) => formData.append("roomTypeBasePrices", v));
        roomTypeDescriptions.forEach((v) => formData.append("roomTypeDescriptions", v));
        roomTypeSizes.forEach((v) => formData.append("roomTypeSizes", v));
        roomTypeBedInfos.forEach((v) => formData.append("roomTypeBedInfos", v));
        roomTypeViews.forEach((v) => formData.append("roomTypeViews", v));
        roomTypeSmokingPolicies.forEach((v) => formData.append("roomTypeSmokingPolicies", v));
        roomTypeBathroomAmenities.forEach((v) => formData.append("roomTypeBathroomAmenities", v));
        roomTypeRoomAmenities.forEach((v) => formData.append("roomTypeRoomAmenities", v));
      }

      if (filePondMulti && filePondMulti.images) {
        filePondMulti.images.getFiles().forEach((item) => {
          formData.append("images", item.file);
        });
      }

      const hotelPatchUrl =
        hotelEditForm.getAttribute("data-patch-url") ||
        `/${pathAdmin}/hotel/edit/${id}`;
      fetch(hotelPatchUrl, {
        method: "PATCH",
        body: formData,
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code === "error") {
            notify.error(data.message);
          }

          if (data.code === "success") {
            notify.success(data.message);
          }
        });
    });
}
// ================== END HOTEL EDIT FORM ==================

// Hotel Room Types Modal — code cũ cho UI đã xóa khỏi hotel-create / hotel-edit (không còn #manage-room-types-btn).
// Bật lại khi thêm lại modal vào Pug; để false tránh console.warn mỗi lần load admin.
const HOTEL_FORM_ROOM_TYPES_MODAL_ENABLED = false;

document.addEventListener("DOMContentLoaded", () => {
  if (!HOTEL_FORM_ROOM_TYPES_MODAL_ENABLED) return;

  const manageBtn = document.getElementById("manage-room-types-btn");
  const modal = document.getElementById("hotel-room-modal");

  if (!manageBtn) {
    console.warn("Manage room types button not found");
    return;
  }

  if (!modal) {
    console.error("Hotel room modal not found in DOM");
    return;
  }
  
  const modalOverlay = modal.querySelector(".hotel-room-modal-overlay");
  const modalClose = modal.querySelector(".hotel-room-modal-close");
  const roomList = document.getElementById("hotel-room-list");
  const roomForm = document.getElementById("hotel-room-form");
  const addNewBtn = document.getElementById("room-add-new-btn");
  const formCancelBtns = modal.querySelectorAll(".room-form-cancel");
  const formSaveBtn = modal.querySelector(".room-form-save");
  const roomCountBadge = document.getElementById("room-count-badge");
  
  // Lưu trữ dữ liệu các loại phòng
  let roomTypesData = [];
  
  // Khởi tạo dữ liệu từ server nếu có
  if (roomList) {
    const existingRooms = roomList.querySelectorAll(".hotel-room-item");
    existingRooms.forEach((item, index) => {
      const roomData = {
        name: item.querySelector("h3")?.textContent?.trim() || "",
        maxGuests: parseInt(item.querySelector(".hotel-room-item-summary p")?.textContent?.match(/Số khách: (\d+)/)?.[1]) || 2,
        basePrice: parseInt(item.querySelector(".hotel-room-item-summary p")?.textContent?.match(/Giá từ: ([\d,]+)/)?.[1]?.replace(/,/g, '')) || 0,
        description: "",
        sizeM2: parseInt(item.querySelector(".hotel-room-item-summary p:nth-of-type(2)")?.textContent?.match(/Diện tích: (\d+)/)?.[1]) || null,
        bedInfo: item.querySelector(".hotel-room-item-summary p:nth-of-type(3)")?.textContent?.replace("Giường: ", "") || "",
        view: "",
        smokingPolicy: "",
        bathroomAmenities: [],
        roomAmenities: [],
        images: []
      };
      roomTypesData.push(roomData);
    });
  }
  
  // Mở modal
  manageBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Opening modal...", modal);
    modal.style.setProperty("display", "flex", "important");
    updateRoomList();
  });
  
  // Đóng modal
  function closeModal() {
    modal.style.setProperty("display", "none", "important");
    resetForm();
  }
  
  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }
  
  if (modalOverlay) {
    modalOverlay.addEventListener("click", closeModal);
  }
  
  // Hủy form
  if (formCancelBtns) {
    formCancelBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        roomForm.style.display = "none";
        resetForm();
      });
    });
  }
  
  // Hiển thị form thêm mới
  if (addNewBtn) {
    addNewBtn.addEventListener("click", () => {
      document.getElementById("room-form-title").textContent = "Thêm loại phòng mới";
      roomForm.dataset.editIndex = "";
      resetForm();
      roomForm.style.display = "block";
      addNewBtn.style.display = "none";
    });
  }
  
  // Reset form
  function resetForm() {
    const form = roomForm;
    if (!form) return;
    
    form.querySelector("#room-name").value = "";
    form.querySelector("#room-max-guests").value = "2";
    form.querySelector("#room-base-price").value = "";
    form.querySelector("#room-description").value = "";
    form.querySelector("#room-size").value = "";
    form.querySelector("#room-bed-info").value = "";
    form.querySelector("#room-view").value = "";
    form.querySelector("#room-smoking").value = "";
    form.querySelector("#room-bathroom-amenities").value = "";
    form.querySelector("#room-amenities").value = "";
    form.querySelector("#room-images").value = "";
    const preview = form.querySelector("#room-images-preview");
    if (preview) preview.innerHTML = "";
  }
  
  // Lưu phòng
  if (formSaveBtn) {
    formSaveBtn.addEventListener("click", () => {
      const form = roomForm;
      if (!form) return;
      
      const name = form.querySelector("#room-name").value.trim();
      const maxGuests = parseInt(form.querySelector("#room-max-guests").value) || 2;
      const basePrice = parseInt(form.querySelector("#room-base-price").value) || 0;
      const description = form.querySelector("#room-description").value.trim();
      const sizeM2 = parseInt(form.querySelector("#room-size").value) || null;
      const bedInfo = form.querySelector("#room-bed-info").value.trim();
      const view = form.querySelector("#room-view").value.trim();
      const smokingPolicy = form.querySelector("#room-smoking").value.trim();
      const bathroomAmenitiesText = form.querySelector("#room-bathroom-amenities").value.trim();
      const roomAmenitiesText = form.querySelector("#room-amenities").value.trim();
      const imageFiles = form.querySelector("#room-images").files;
      
      if (!name) {
        alert("Vui lòng nhập tên loại phòng");
        return;
      }
      
      const bathroomAmenities = bathroomAmenitiesText.split("\n").map(s => s.trim()).filter(Boolean);
      const roomAmenities = roomAmenitiesText.split("\n").map(s => s.trim()).filter(Boolean);
      
      const roomData = {
        name,
        maxGuests,
        basePrice,
        description,
        sizeM2,
        bedInfo,
        view,
        smokingPolicy,
        bathroomAmenities,
        roomAmenities,
        images: Array.from(imageFiles).map(f => URL.createObjectURL(f)) // Preview URLs
      };
      
      const editIndex = form.dataset.editIndex;
      if (editIndex !== undefined && editIndex !== "") {
        // Cập nhật phòng hiện có
        roomTypesData[parseInt(editIndex)] = roomData;
      } else {
        // Thêm phòng mới
        roomTypesData.push(roomData);
      }
      
      updateRoomList();
      updateRoomCount();
      roomForm.style.display = "none";
      if (addNewBtn) addNewBtn.style.display = "block";
      resetForm();
    });
  }
  
  // Cập nhật danh sách phòng
  function updateRoomList() {
    if (!roomList) return;
    
    roomList.innerHTML = "";
    
    if (roomTypesData.length === 0) {
      roomList.innerHTML = '<div class="hotel-room-empty"><p>Chưa có loại phòng nào. Hãy thêm loại phòng đầu tiên.</p></div>';
      return;
    }
    
    roomTypesData.forEach((room, index) => {
      const item = document.createElement("div");
      item.className = "hotel-room-item";
      item.dataset.roomIndex = index;
      
      let summaryHtml = `<p>Số khách: ${room.maxGuests} | Giá từ: ${room.basePrice.toLocaleString('vi-VN')} VND</p>`;
      if (room.sizeM2) {
        summaryHtml += `<p>Diện tích: ${room.sizeM2} m²</p>`;
      }
      if (room.bedInfo) {
        summaryHtml += `<p>Giường: ${room.bedInfo}</p>`;
      }
      
      item.innerHTML = `
        <div class="hotel-room-item-header">
          <h3>${room.name}</h3>
          <div class="hotel-room-item-actions">
            <button class="room-edit-btn" type="button" data-room-index="${index}">Chỉnh sửa</button>
            <button class="room-remove-btn" type="button" data-room-index="${index}">Xóa</button>
          </div>
        </div>
        <div class="hotel-room-item-summary">
          ${summaryHtml}
        </div>
      `;
      
      // Gắn handler cho nút chỉnh sửa
      const editBtn = item.querySelector(".room-edit-btn");
      if (editBtn) {
        editBtn.addEventListener("click", () => {
          editRoom(index);
        });
      }
      
      // Gắn handler cho nút xóa
      const removeBtn = item.querySelector(".room-remove-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          if (confirm("Bạn có chắc chắn muốn xóa loại phòng này?")) {
            roomTypesData.splice(index, 1);
            updateRoomList();
            updateRoomCount();
          }
        });
      }
      
      roomList.appendChild(item);
    });
  }
  
  // Chỉnh sửa phòng
  function editRoom(index) {
    const room = roomTypesData[index];
    if (!room) return;
    
    const form = roomForm;
    form.querySelector("#room-name").value = room.name || "";
    form.querySelector("#room-max-guests").value = room.maxGuests || 2;
    form.querySelector("#room-base-price").value = room.basePrice || "";
    form.querySelector("#room-description").value = room.description || "";
    form.querySelector("#room-size").value = room.sizeM2 || "";
    form.querySelector("#room-bed-info").value = room.bedInfo || "";
    form.querySelector("#room-view").value = room.view || "";
    form.querySelector("#room-smoking").value = room.smokingPolicy || "";
    form.querySelector("#room-bathroom-amenities").value = room.bathroomAmenities?.join("\n") || "";
    form.querySelector("#room-amenities").value = room.roomAmenities?.join("\n") || "";
    
    // Preview ảnh nếu có
    const preview = form.querySelector("#room-images-preview");
    if (preview) {
      preview.innerHTML = "";
      if (room.images && room.images.length > 0) {
        room.images.forEach(imgUrl => {
          const img = document.createElement("img");
          img.src = imgUrl;
          img.style.cssText = "max-width: 100px; max-height: 100px; object-fit: cover; margin: 5px; border-radius: 4px;";
          preview.appendChild(img);
        });
      }
    }
    
    document.getElementById("room-form-title").textContent = "Chỉnh sửa loại phòng";
    form.dataset.editIndex = index;
    form.style.display = "block";
    if (addNewBtn) addNewBtn.style.display = "none";
  }
  
  // Cập nhật số lượng phòng
  function updateRoomCount() {
    if (roomCountBadge) {
      roomCountBadge.textContent = roomTypesData.length;
      roomCountBadge.dataset.count = roomTypesData.length;
    }
  }
  
  // Preview ảnh khi chọn
  const roomImagesInput = document.getElementById("room-images");
  if (roomImagesInput) {
    roomImagesInput.addEventListener("change", function(e) {
      const preview = document.getElementById("room-images-preview");
      if (!preview) return;
      
      preview.innerHTML = "";
      const files = Array.from(e.target.files);
      
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
          const img = document.createElement("img");
          img.src = e.target.result;
          img.style.cssText = "max-width: 100px; max-height: 100px; object-fit: cover; margin: 5px; border-radius: 4px;";
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }
  
      // Cập nhật dữ liệu khi submit form chính
      const hotelCreateForm = document.getElementById("hotel-create-form");
      const hotelEditForm = document.getElementById("hotel-edit-form");
      const mainForm = hotelCreateForm || hotelEditForm;
      
      if (mainForm) {
        // Lưu reference để có thể truy cập từ form submission handler
        window.roomTypesDataForSubmit = roomTypesData;
        
        // Nếu form submit qua fetch (như hotel create/edit), cần intercept
        const originalSubmit = mainForm.onsubmit;
        mainForm.addEventListener("submit", function(e) {
          // Nếu form submit qua fetch, dữ liệu sẽ được thêm vào FormData trong handler fetch
          // Nếu form submit thông thường, thêm hidden inputs
          if (!e.defaultPrevented) {
            roomTypesData.forEach((room) => {
              const nameInput = document.createElement("input");
              nameInput.type = "hidden";
              nameInput.name = "roomTypeNames";
              nameInput.value = room.name;
              mainForm.appendChild(nameInput);
              
              const maxGuestsInput = document.createElement("input");
              maxGuestsInput.type = "hidden";
              maxGuestsInput.name = "roomTypeMaxGuests";
              maxGuestsInput.value = room.maxGuests;
              mainForm.appendChild(maxGuestsInput);
              
              const basePriceInput = document.createElement("input");
              basePriceInput.type = "hidden";
              basePriceInput.name = "roomTypeBasePrices";
              basePriceInput.value = room.basePrice;
              mainForm.appendChild(basePriceInput);
              
              const descInput = document.createElement("input");
              descInput.type = "hidden";
              descInput.name = "roomTypeDescriptions";
              descInput.value = room.description;
              mainForm.appendChild(descInput);
              
              const sizeInput = document.createElement("input");
              sizeInput.type = "hidden";
              sizeInput.name = "roomTypeSizes";
              sizeInput.value = room.sizeM2 || "";
              mainForm.appendChild(sizeInput);
              
              const bedInfoInput = document.createElement("input");
              bedInfoInput.type = "hidden";
              bedInfoInput.name = "roomTypeBedInfos";
              bedInfoInput.value = room.bedInfo;
              mainForm.appendChild(bedInfoInput);
              
              const viewInput = document.createElement("input");
              viewInput.type = "hidden";
              viewInput.name = "roomTypeViews";
              viewInput.value = room.view;
              mainForm.appendChild(viewInput);
              
              const smokingInput = document.createElement("input");
              smokingInput.type = "hidden";
              smokingInput.name = "roomTypeSmokingPolicies";
              smokingInput.value = room.smokingPolicy;
              mainForm.appendChild(smokingInput);
              
              // Amenities - gửi kèm index để phân biệt
              room.bathroomAmenities.forEach(amenity => {
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = "roomTypeBathroomAmenities";
                input.value = amenity;
                mainForm.appendChild(input);
              });
              
              room.roomAmenities.forEach(amenity => {
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = "roomTypeRoomAmenities";
                input.value = amenity;
                mainForm.appendChild(input);
              });
            });
          }
        });
      }
  
  // Khởi tạo
  updateRoomCount();
});

// End Add New Hotel Room

// Hotel Room Detail Edit Form
const hotelRoomDetailForm = document.querySelector("#hotel-room-detail-form");
if (hotelRoomDetailForm) {
  hotelRoomDetailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    // Thu thập dữ liệu từ form
    const formData = new FormData(hotelRoomDetailForm);
    const data = Object.fromEntries(formData);
    
    // Thu thập bathroom amenities từ các textarea riêng
    const bathroomAmenities = [];
    hotelRoomDetailForm.querySelectorAll('.room-bathroom-amenities-list .amenity-input').forEach(textarea => {
      const value = textarea.value.trim();
      if (value) bathroomAmenities.push(value);
    });
    
    // Thu thập room amenities từ các textarea riêng
    const roomAmenities = [];
    hotelRoomDetailForm.querySelectorAll('.room-room-amenities-list .amenity-input').forEach(textarea => {
      const value = textarea.value.trim();
      if (value) roomAmenities.push(value);
    });
    
    // Thu thập special features từ các input riêng
    const specialFeatures = [];
    hotelRoomDetailForm.querySelectorAll('.room-special-features-list .feature-input').forEach(input => {
      const value = input.value.trim();
      if (value) specialFeatures.push(value);
    });
    
    // Xử lý checkbox values
    data.isRecommended = hotelRoomDetailForm.querySelector('input[name="isRecommended"]')?.checked || false;
    data.soloTravelerFavorite = hotelRoomDetailForm.querySelector('input[name="soloTravelerFavorite"]')?.checked || false;
    data.breakfastIncluded = hotelRoomDetailForm.querySelector('input[name="breakfastIncluded"]')?.checked || false;
    
    // Xử lý số (rating)
    if (data.rating) {
      data.rating = parseFloat(data.rating) || 0;
    }
    
    // Gửi amenities dưới dạng array thay vì string với \n
    // Controller sẽ xử lý array này
    data.bathroomAmenities = bathroomAmenities;
    data.roomAmenities = roomAmenities;
    data.specialFeatures = specialFeatures;
    
    // Xử lý upload ảnh (nếu có FilePond)
    const formDataToSend = new FormData();
    Object.keys(data).forEach(key => {
      if (key !== 'roomImages') {
        if (Array.isArray(data[key])) {
          data[key].forEach(item => formDataToSend.append(key, item));
        } else {
          formDataToSend.append(key, data[key]);
        }
      }
    });
    
    // Upload ảnh từ FilePond nếu có
    const roomImagesFilePond = filePondMulti['roomImages'];
    const allImageUrls = []; // Lưu tất cả URL ảnh (cả mới và cũ)
    
    if (roomImagesFilePond) {
      // Lấy tất cả file từ FilePond
      const files = roomImagesFilePond.getFiles();
      files.forEach((fileItem) => {
        // Kiểm tra xem file đã được upload lên server chưa (có serverId)
        if (fileItem.serverId) {
          // File đã upload, lấy URL từ serverId
          allImageUrls.push(String(fileItem.serverId));
        } else if (fileItem.file) {
          // File mới chưa upload, lấy file gốc để upload
          formDataToSend.append('roomImages', fileItem.file);
        } else if (fileItem.source) {
          // File đã có từ trước (preview), lấy URL
          // Kiểm tra xem source có phải là string không
          const sourceUrl = typeof fileItem.source === 'string' ? fileItem.source : String(fileItem.source);
          if (sourceUrl) {
            allImageUrls.push(sourceUrl);
          }
        }
      });
      
      // Gửi tất cả URL ảnh đã có qua formData
      if (allImageUrls.length > 0) {
        allImageUrls.forEach(url => {
          formDataToSend.append('roomImagesUrls', url);
        });
      }
    } else {
      // Fallback: thử lấy từ input gốc nếu FilePond chưa khởi tạo
      const roomImagesInput = hotelRoomDetailForm.querySelector('input[name="roomImages"]');
      if (roomImagesInput && roomImagesInput.files && roomImagesInput.files.length > 0) {
        Array.from(roomImagesInput.files).forEach(file => {
          formDataToSend.append('roomImages', file);
        });
      }
    }
    
    const action = hotelRoomDetailForm.action;
    
    try {
      const response = await fetch(action, {
        method: "POST",
        body: formDataToSend
      });
      
      const result = await response.json();
      
      if (result.code === "success") {
        notify.success(result.message);
        // Không reload trang, giữ nguyên để người dùng tiếp tục chỉnh sửa
      } else {
        notify.error(result.message || "Có lỗi xảy ra!");
      }
    } catch (error) {
      console.error("Error submitting hotel room form:", error);
      notify.error("Có lỗi xảy ra khi lưu thông tin phòng!");
    }
  });
}
// End Hotel Room Detail Edit Form


