// public/assets/js/hotel-cart.js

// Helper function để hiển thị thông báo
function showDateRequiredMessage() {
  console.log('showDateRequiredMessage called');
  const message = 'Vui lòng chọn ngày nhận phòng và ngày trả phòng trước khi tiếp tục!';
  
  // Dùng notify global (đã được khởi tạo trong notify.js)
  if (typeof notify !== 'undefined' && notify && typeof notify.error === 'function') {
    console.log('Using notify global');
    notify.error(message);
  } else if (typeof Notyf !== 'undefined') {
    console.log('Using Notyf directly');
    // Fallback: tạo Notyf mới nếu notify chưa có
    const notyf = new Notyf({
      duration: 4000,
      position: { x: 'right', y: 'top' }
    });
    notyf.error(message);
  } else {
    console.log('Using alert fallback');
    alert(message);
  }
  
  // Scroll đến top bar để người dùng thấy nút "Sửa tìm kiếm"
  setTimeout(() => {
    const topBar = document.querySelector('.detail-top');
    if (topBar) {
      topBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight top bar
      const originalBg = topBar.style.backgroundColor;
      topBar.style.transition = 'background-color 0.3s';
      topBar.style.backgroundColor = '#fff3cd';
      setTimeout(() => {
        topBar.style.backgroundColor = originalBg;
      }, 2000);
    }
  }, 100);
}

// ==================== ADD TO CART ====================
(function() {
  function initAddToCart() {
    // Kiểm tra xem đã attach listener chưa
    if (window.hotelCartAddAttached) {
      return;
    }
    window.hotelCartAddAttached = true;
    
    // Dùng event delegation để bắt tất cả clicks, kể cả disabled buttons
    const roomActionsContainer = document.querySelector('.rooms');
    if (!roomActionsContainer) {
      console.log('No .rooms container found for add-to-cart');
      return;
    }
    
    console.log('Attaching event delegation for add-to-cart buttons');
    
    // Tìm tất cả buttons (cả enabled và disabled)
    const allAddToCartButtons = roomActionsContainer.querySelectorAll('.room-add-to-cart');
    console.log('Found', allAddToCartButtons.length, 'add-to-cart buttons');
    
    // Attach listener trực tiếp lên từng button với capture: true
    allAddToCartButtons.forEach((btn, index) => {
      console.log(`Attaching listener to button ${index + 1}, disabled:`, btn.disabled, 'has class:', btn.classList.contains('room-button-disabled'));
      
      // Dùng capture phase để bắt event trước khi bị chặn
      btn.addEventListener('click', async function(e) {
        console.log('Add to cart button clicked directly, disabled:', this.disabled, 'has class:', this.classList.contains('room-button-disabled'));
        
        e.preventDefault();
        e.stopPropagation();
        
        // Kiểm tra nếu button có class disabled hoặc data-no-dates
        if (this.classList.contains('room-button-disabled') || this.dataset.noDates === 'true') {
          console.log('Button requires dates, calling showDateRequiredMessage');
          showDateRequiredMessage();
          return;
        }
        
        const btn = this;
        
      console.log('Add to cart button clicked - button is enabled');
      
      const hotelId = btn.dataset.hotelId;
      const roomTypeId = btn.dataset.roomTypeId;
      const checkInDate = btn.dataset.checkInDate;
      const checkOutDate = btn.dataset.checkOutDate;
      const rooms = btn.dataset.rooms || 1;
      const adults = btn.dataset.adults || 1;
      const children = btn.dataset.children || 0;
      const roomsData = btn.dataset.roomsData || '';
      const maxAvailable = parseInt(btn.dataset.maxAvailable) || 1;
      
      // Validate dates - kiểm tra kỹ hơn
      if (!checkInDate || !checkOutDate || checkInDate === 'null' || checkOutDate === 'null' || checkInDate === 'undefined' || checkOutDate === 'undefined') {
        showDateRequiredMessage();
        return;
      }
      
      console.log('Cart data:', { hotelId, roomTypeId, checkInDate, checkOutDate, rooms, adults, children });
      
      // Disable button
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang thêm...';
      
      try {
        const response = await fetch('/hotel-cart/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            hotelId,
            roomTypeId,
            quantity: 1, // Mặc định thêm 1 phòng
            checkInDate,
            checkOutDate,
            roomsData,
            adults,
            children,
            rooms
          })
        });
        
        const data = await response.json();
        console.log('Add to cart response:', data);
        
        if (data.code === 'success') {
          if (typeof Notyf !== 'undefined') {
            const notyf = new Notyf({
              duration: 3000,
              position: { x: 'right', y: 'top' }
            });
            notyf.success(data.message || 'Đã thêm vào giỏ hàng');
          } else {
            alert(data.message || 'Đã thêm vào giỏ hàng');
          }
          updateCartCount();
        } else {
          // Hiển thị thông báo lỗi — kéo dài hơn nếu phòng đang bị khách khác giữ
          const errMsg = data.message || 'Có lỗi xảy ra';
          const isHeldByOther = data.type === 'room_held_by_other';
          if (typeof Notyf !== 'undefined') {
            const notyf = new Notyf({
              duration: isHeldByOther ? 6000 : 4000,
              position: { x: 'right', y: 'top' },
              dismissible: true,
            });
            notyf.error(errMsg);
          } else {
            alert(errMsg);
          }
        }
      } catch (error) {
        console.error('Error adding to cart:', error);
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({
            duration: 4000,
            position: { x: 'right', y: 'top' }
          });
          notyf.error(error.message || 'Có lỗi xảy ra khi kết nối. Vui lòng thử lại.');
        } else {
          alert(error.message || 'Có lỗi xảy ra khi kết nối. Vui lòng thử lại.');
        }
      } finally {
        // Re-enable button
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
      }, true); // capture: true - bắt event ở capture phase
    });
  }
  
  // Chờ DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAddToCart);
  } else {
    initAddToCart();
  }
})();

// ==================== UPDATE QUANTITY ====================
// NOTE: Đã DISABLE tính năng thay đổi số lượng phòng trong giỏ hàng.
// Khách hàng chỉ có thể chọn số lượng phòng từ trang chi tiết khách sạn.
/*
(function() {
  function initQuantityControls() {
    // Không check global flag nữa, vì có thể cần init lại khi tab được switch
    const decreaseBtns = document.querySelectorAll('.btn-qty-decrease');
    const increaseBtns = document.querySelectorAll('.btn-qty-increase');
    const qtyInputs = document.querySelectorAll('.qty-input');
    
    // Remove existing listeners để tránh duplicate
    decreaseBtns.forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
    });
    increaseBtns.forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
    });
    
    // Re-query sau khi clone
    const decreaseBtnsNew = document.querySelectorAll('.btn-qty-decrease');
    const increaseBtnsNew = document.querySelectorAll('.btn-qty-increase');
    const qtyInputsNew = document.querySelectorAll('.qty-input');
  
    // Decrease quantity
    decreaseBtnsNew.forEach(btn => {
      btn.addEventListener('click', async function() {
        const roomTypeId = this.dataset.roomTypeId;
        const input = document.querySelector(`.qty-input[data-room-type-id="${roomTypeId}"]`);
        const currentQty = parseInt(input.value);
        
        if (currentQty > 1) {
          await updateQuantity(roomTypeId, currentQty - 1);
        }
      });
    });
    
    // Increase quantity
    increaseBtnsNew.forEach(btn => {
      btn.addEventListener('click', async function() {
        const roomTypeId = this.dataset.roomTypeId;
        const maxAvailable = parseInt(this.dataset.max);
        const input = document.querySelector(`.qty-input[data-room-type-id="${roomTypeId}"]`);
        const currentQty = parseInt(input.value);
        
        if (currentQty < maxAvailable) {
          await updateQuantity(roomTypeId, currentQty + 1);
        } else {
          if (window.Notyf) {
            const notyf = new Notyf({
              duration: 3000,
              position: { x: 'right', y: 'top' }
            });
            notyf.error(`Chỉ còn ${maxAvailable} phòng trống`);
          } else {
            alert(`Chỉ còn ${maxAvailable} phòng trống`);
          }
        }
      });
    });
    
    // Manual input change
    qtyInputsNew.forEach(input => {
      input.addEventListener('change', async function() {
        const roomTypeId = this.dataset.roomTypeId;
        const maxAvailable = parseInt(this.max);
        let newQty = parseInt(this.value);
        
        if (newQty < 1) newQty = 1;
        if (newQty > maxAvailable) {
          newQty = maxAvailable;
          if (window.Notyf) {
            const notyf = new Notyf({
              duration: 3000,
              position: { x: 'right', y: 'top' }
            });
            notyf.error(`Chỉ còn ${maxAvailable} phòng trống`);
          }
        }
        
        this.value = newQty;
        await updateQuantity(roomTypeId, newQty);
      });
    });
  }
  
  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQuantityControls);
  } else {
    initQuantityControls();
  }
  
  // Re-init khi tab hotel được switch (cho cart-unified)
  document.addEventListener('hotelCartTabActivated', initQuantityControls);
  
  async function updateQuantity(roomTypeId, quantity) {
    try {
      const response = await fetch('/hotel-cart/update-quantity', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          roomTypeId,
          quantity
        })
      });
      
      const data = await response.json();
      
      if (data.code === 'success') {
        // Cập nhật lại UI mà không reload trang
        const hotelCartTab = document.getElementById('hotelCartTab') || document;

        // 1. Cập nhật lại tổng tiền từng phòng
        const cartItem = hotelCartTab.querySelector(`.cart-item[data-room-type-id="${roomTypeId}"]`);
        if (cartItem) {
          // Cập nhật lại ô số lượng phòng
          const qtyInput = cartItem.querySelector('.qty-input');
          if (qtyInput) {
            qtyInput.value = String(quantity);
          }

          const nightsEl = cartItem.querySelector('.item-meta p:nth-child(2)');
          const pricePerNightEl = cartItem.querySelector('.item-price-per-night');
          const itemSubtotalEl = cartItem.querySelector('.item-subtotal strong');

          const nightsMatch = nightsEl && nightsEl.textContent.match(/\d+/);
          const nights = nightsMatch ? parseInt(nightsMatch[0], 10) || 1 : 1;

          // Helper parse price từ text (ví dụ: "1.200.000 VND / đêm")
          const parsePrice = (text) => {
            const m = text && text.match(/[\d.,]+/);
            if (!m) return 0;
            return parseFloat(m[0].replace(/[.,]/g, '')) || 0;
          };

          const pricePerNight = pricePerNightEl ? parsePrice(pricePerNightEl.textContent) : 0;
          const itemTotal = pricePerNight * nights * quantity;

          if (itemSubtotalEl) {
            itemSubtotalEl.textContent = itemTotal.toLocaleString('vi-VN') + ' VND';
          }
        }

        // 2. Cập nhật lại summary (tạm tính, thuế, phí, tổng)
        if (typeof data.subtotal === 'number' &&
            typeof data.tax === 'number' &&
            typeof data.fee === 'number' &&
            typeof data.total === 'number') {
          const rows = hotelCartTab.querySelectorAll('.cart-summary .summary-row span:last-child');
          if (rows[0]) rows[0].textContent = data.subtotal.toLocaleString('vi-VN') + ' VND';
          if (rows[1]) rows[1].textContent = data.tax.toLocaleString('vi-VN') + ' VND';
          if (rows[2]) rows[2].textContent = data.fee.toLocaleString('vi-VN') + ' VND';

          const totalEl = hotelCartTab.querySelector('#cartTotalPrice');
          if (totalEl) {
            totalEl.textContent = data.total.toLocaleString('vi-VN') + ' VND';
          }
        }

        // 3. Thông báo & cho các module khác biết giỏ hàng hotel đã update
        if (window.Notyf) {
          const notyf = new Notyf({
            duration: 2000,
            position: { x: 'right', y: 'top' }
          });
          notyf.success(data.message || 'Đã cập nhật số lượng phòng');
        }

        const evt = new CustomEvent('hotelCartUpdated');
        document.dispatchEvent(evt);
        
        // Trigger recalculation of total with services
        const recalcEvt = new CustomEvent('hotelCartQuantityChanged');
        document.dispatchEvent(recalcEvt);
      } else {
        throw new Error(data.message || 'Có lỗi xảy ra');
      }
    } catch (error) {
      console.error('Error updating quantity:', error);
      if (window.Notyf) {
        const notyf = new Notyf({
          duration: 3000,
          position: { x: 'right', y: 'top' }
        });
        notyf.error(error.message || 'Có lỗi xảy ra');
      } else {
        alert(error.message || 'Có lỗi xảy ra');
      }
    }
  }
})();
*/

// ==================== REMOVE ITEM ====================
(function() {
  function initRemoveButtons() {
    const removeBtns = document.querySelectorAll('.btn-remove');
    
    removeBtns.forEach(btn => {
      // Clone để remove existing listeners
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
    });
    
    // Re-query sau khi clone
    const removeBtnsNew = document.querySelectorAll('.btn-remove');
    
    removeBtnsNew.forEach(btn => {
      btn.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const roomTypeId = this.dataset.roomTypeId;
      
      if (!confirm('Bạn có chắc muốn xóa phòng này khỏi giỏ hàng?')) {
        return;
      }
      
      try {
        const response = await fetch('/hotel-cart/remove', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            roomTypeId
          })
        });
        
        const data = await response.json();
        
        if (data.code === 'success') {
          if (typeof Notyf !== 'undefined') {
            const notyf = new Notyf({
              duration: 3000,
              position: { x: 'right', y: 'top' }
            });
            notyf.success(data.message || 'Đã xóa khỏi giỏ hàng');
          }
          
          // Reload page
          setTimeout(() => {
            location.reload();
          }, 500);
        } else {
          throw new Error(data.message || 'Có lỗi xảy ra');
        }
      } catch (error) {
        console.error('Error removing item:', error);
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({
            duration: 3000,
            position: { x: 'right', y: 'top' }
          });
          notyf.error(error.message || 'Có lỗi xảy ra');
        } else {
          alert(error.message || 'Có lỗi xảy ra');
        }
      }
    });
  });
  }
  
  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRemoveButtons);
  } else {
    initRemoveButtons();
  }
  
  // Re-init khi tab hotel được switch (cho cart-unified)
  document.addEventListener('hotelCartTabActivated', initRemoveButtons);
})();

// ==================== ADDITIONAL SERVICES ====================
(function() {
  function initAdditionalServices() {
    const hotelCartTab = document.getElementById('hotelCartTab');
    if (!hotelCartTab) return; // Chưa có tab hotel
    
    function parsePrice(text) {
      const match = text.match(/[\d.,]+/);
      if (match) {
        return parseFloat(match[0].replace(/[,.]/g, '')) || 0;
      }
      return 0;
    }
    
    // Tính tổng tiền với dịch vụ thêm
    function calculateTotalWithServices() {
      // Lấy base total từ DOM mỗi lần tính (để có giá mới sau khi update quantity)
      let baseTotal = 0;
      
      // Lấy tất cả các summary-row KHÔNG phải summary-total và KHÔNG phải summary-section
      const summaryRows = hotelCartTab.querySelectorAll('.summary-rows > .summary-row:not(.summary-total)');
      summaryRows.forEach(row => {
        const priceSpan = row.querySelector('span:last-child');
        if (priceSpan) {
          baseTotal += parsePrice(priceSpan.textContent);
        }
      });
      
      let servicesTotal = 0;
      
      // Checkboxes (chỉ trong tab hotel)
      hotelCartTab.querySelectorAll('.service-checkbox:checked').forEach(cb => {
        servicesTotal += parseFloat(cb.dataset.price || 0);
      });
      
    // Quantities - dịch vụ chung (trong summary)
    hotelCartTab.querySelectorAll('.summary-section .service-quantity').forEach(input => {
      const qty = parseInt(input.value || 0);
      const price = parseFloat(input.dataset.price || 0);
      const nights = parseInt(input.dataset.nights || '1', 10) || 1;
      servicesTotal += qty * price * nights;
    });
    
    // Quantities - dịch vụ theo từng item (trong .cart-item)
    hotelCartTab.querySelectorAll('.cart-item .service-quantity-input').forEach(input => {
      const qty = parseInt(input.value || 0);
      const price = parseFloat(input.dataset.price || 0);
      const nights = parseInt(input.dataset.nights || '1', 10) || 1;
      servicesTotal += qty * price * nights;
    });
      
      const total = baseTotal + servicesTotal;
      const totalElement = hotelCartTab.querySelector('#cartTotalPrice');
      if (totalElement) {
        totalElement.textContent = total.toLocaleString('vi-VN') + ' VND';
      }
    }
    
    // Service checkbox handlers (chỉ trong tab hotel)
    hotelCartTab.querySelectorAll('.service-checkbox').forEach(cb => {
      // Remove existing listener nếu có
      const newCb = cb.cloneNode(true);
      cb.parentNode.replaceChild(newCb, cb);
      newCb.addEventListener('change', calculateTotalWithServices);
    });
    
    // Service quantity handlers - dịch vụ chung (trong summary)
    hotelCartTab.querySelectorAll('.summary-section .service-btn-plus').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', function() {
        const serviceId = this.dataset.serviceId;
        const max = parseInt(this.dataset.max || 999);
        const input = hotelCartTab.querySelector(`.summary-section .service-quantity[data-service-id="${serviceId}"]`);
        const current = parseInt(input.value || 0);
        if (current < max) {
          input.value = current + 1;
          calculateTotalWithServices();
        }
      });
    });
    
    hotelCartTab.querySelectorAll('.summary-section .service-btn-minus').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', function() {
        const serviceId = this.dataset.serviceId;
        const input = hotelCartTab.querySelector(`.summary-section .service-quantity[data-service-id="${serviceId}"]`);
        const current = parseInt(input.value || 0);
        if (current > 0) {
          input.value = current - 1;
          calculateTotalWithServices();
        }
      });
    });
    
    // Service quantity handlers - dịch vụ theo từng item (trong .cart-item)
    hotelCartTab.querySelectorAll('.cart-item .service-btn-plus').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', function() {
        const serviceId = this.dataset.serviceId;
        const itemIndex = this.dataset.itemIndex;
        const max = parseInt(this.dataset.max || 999);
        const input = hotelCartTab.querySelector(`.service-quantity-input[data-service-id="${serviceId}"][data-item-index="${itemIndex}"]`);
        const current = parseInt(input.value || 0);
        if (current < max) {
          input.value = current + 1;
          calculateTotalWithServices();
        }
      });
    });
    
    hotelCartTab.querySelectorAll('.cart-item .service-btn-minus').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', function() {
        const serviceId = this.dataset.serviceId;
        const itemIndex = this.dataset.itemIndex;
        const input = hotelCartTab.querySelector(`.service-quantity-input[data-service-id="${serviceId}"][data-item-index="${itemIndex}"]`);
        const current = parseInt(input.value || 0);
        if (current > 0) {
          input.value = current - 1;
          calculateTotalWithServices();
        }
      });
    });
    
    // Listen for quantity changes to recalculate total
    document.addEventListener('hotelCartQuantityChanged', calculateTotalWithServices);
  }
  
  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdditionalServices);
  } else {
    initAdditionalServices();
  }
  
  // Re-init khi tab hotel được switch (cho cart-unified)
  document.addEventListener('hotelCartTabActivated', initAdditionalServices);
})();

// ==================== CHECKOUT FORM ====================
(function() {
  // Flag để ngăn submit nhiều lần
  let isSubmitting = false;
  
  // Function để handle booking submit (định nghĩa ở scope cao hơn)
  async function handleBookingSubmit(bookingForm) {
    // Ngăn submit nhiều lần
    if (isSubmitting) {
      console.log('Booking submission already in progress...');
      return;
    }
    
    const hotelCartTab = document.getElementById('hotelCartTab');
    const formContainer = hotelCartTab || document;
    
    const fullNameInput = formContainer.querySelector('#hotel-fullname-input');
    const phoneInput = formContainer.querySelector('#hotel-phone-input');
    const emailInput = formContainer.querySelector('#hotel-email-input');
    const noteInput = formContainer.querySelector('#hotel-note-input');
    
    const fullName = fullNameInput ? fullNameInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const note = noteInput ? noteInput.value.trim() : '';
    const paymentMethod = bookingForm.querySelector('input[name="paymentMethod"]:checked')?.value || 'money';

    // Thu thập dịch vụ thêm - cấu trúc mới: theo từng item + dịch vụ chung
    const additionalServices = {
      global: {}, // Dịch vụ chung (early checkin, late checkout, airport transfer)
      perItem: {}  // Dịch vụ theo từng loại phòng
    };
    
    // Dịch vụ chung - Early checkin
    const earlyCheckinCheckbox = formContainer.querySelector('.service-checkbox[data-service-id="early_checkin"]');
    if (earlyCheckinCheckbox && earlyCheckinCheckbox.checked) {
      additionalServices.global.early_checkin = 'true';
    }

    // Dịch vụ chung - Late checkout
    const lateCheckoutCheckbox = formContainer.querySelector('.service-checkbox[data-service-id="late_checkout"]');
    if (lateCheckoutCheckbox && lateCheckoutCheckbox.checked) {
      additionalServices.global.late_checkout = 'true';
    }

    // Dịch vụ chung - Quantity-based (trong summary)
    formContainer.querySelectorAll('.summary-section .service-quantity').forEach(input => {
      const qty = parseInt(input.value || 0);
      if (qty > 0) {
        additionalServices.global[`service_${input.dataset.serviceId}`] = qty.toString();
      }
    });
    
    // Dịch vụ theo từng item (trong .cart-item)
    formContainer.querySelectorAll('.cart-item .service-quantity-input').forEach(input => {
      const qty = parseInt(input.value || 0);
      if (qty > 0) {
        const itemIndex = input.dataset.itemIndex;
        const serviceId = input.dataset.serviceId;
        
        if (!additionalServices.perItem[itemIndex]) {
          additionalServices.perItem[itemIndex] = {};
        }
        
        additionalServices.perItem[itemIndex][serviceId] = qty.toString();
      }
    });

    // Upload CCCD images nếu có
    let cccdImages = [];
    const hotelCccdInput = formContainer.querySelector('#hotel-cccd-file-input');
    if (hotelCccdInput && hotelCccdInput.files && hotelCccdInput.files.length > 0) {
      const formData = new FormData();
      for (let i = 0; i < hotelCccdInput.files.length; i++) {
        formData.append('files', hotelCccdInput.files[i]);
      }
      try {
        const uploadRes = await fetch('/upload/images', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();
        if (uploadData.success) cccdImages = uploadData.urls;
      } catch (e) {
        alert('Lỗi upload ảnh CCCD!');
        isSubmitting = false;
        return;
      }
    }

    const dataFinal = {
      fullName,
      phone,
      email,
      cccdImages,
      note,
      paymentMethod,
      additionalServices,
    };

    // Bắt đầu submit - disable nút và set flag
    isSubmitting = true;
    const submitBtn = bookingForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...';
    }

    try {
      const response = await fetch('/hotel-booking/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataFinal),
      });

      const data = await response.json();

      if (data.code === 'error') {
        // Reset flag và nút khi có lỗi
        isSubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
        }
        
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({
            duration: 3000,
            position: { x: 'right', y: 'top' }
          });
          notyf.error(data.message || 'Có lỗi xảy ra');
        } else {
          alert(data.message || 'Có lỗi xảy ra');
        }
        return;
      }

      if (data.code === 'success') {
        const bookingCode = data.bookingCode;
        const respPhone = data.phone;

        // Update cart count
        updateCartCount();

        // Giữ nút disabled và flag = true khi redirect (không reset)
        // Redirect đến trang pending để hiển thị countdown timer
        // User có thể thanh toán ngay hoặc để sau (trong vòng 15 phút)
        window.location.href = `/hotel-booking/pending?bookingCode=${bookingCode}&phone=${respPhone}`;
      }
    } catch (error) {
      // Reset flag và nút khi có lỗi
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
      
      console.error('Error creating booking:', error);
      if (typeof Notyf !== 'undefined') {
        const notyf = new Notyf({
          duration: 3000,
          position: { x: 'right', y: 'top' }
        });
        notyf.error('Không thể tạo đơn đặt phòng!');
      } else {
        alert('Không thể tạo đơn đặt phòng!');
      }
    }
  }

  function initCheckoutForm() {
    // Tìm form trong tab hotel (có thể trong cart-unified hoặc hotel-cart page)
    const hotelCartTab = document.getElementById('hotelCartTab');
    const bookingForm = hotelCartTab 
      ? hotelCartTab.querySelector('#hotelCheckoutForm')
      : document.querySelector('#hotelCheckoutForm') || document.querySelector('#hotel-booking-form');
    
    if (!bookingForm) {
      return; // Không có form checkout trên trang này
    }

    // Validation với JustValidate (nếu có)
    if (typeof JustValidate !== 'undefined') {
      const validator = new JustValidate(bookingForm);

      validator
        .addField("#hotel-fullname-input", [
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
        .addField("#hotel-phone-input", [
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
        .addField("#hotel-email-input", [
          {
            rule: "email",
            errorMessage: "Email không đúng định dạng!",
          },
        ])
        .onSuccess((event) => {
          event.preventDefault();
          handleBookingSubmit(bookingForm);
        });
    } else {
      // Fallback: dùng HTML5 validation
      bookingForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (this.checkValidity()) {
          handleBookingSubmit(bookingForm);
        } else {
          this.reportValidity();
        }
      });
    }

    // Toggle bank info
    const listInputMethod = bookingForm.querySelectorAll(`input[name="paymentMethod"]`);
    const innerInfoBank = bookingForm.querySelector(".inner-info-bank");

    if (listInputMethod && innerInfoBank) {
      listInputMethod.forEach((input) => {
        input.addEventListener("change", () => {
          if (input.value == "bank") {
            innerInfoBank.classList.add("active");
          } else {
            innerInfoBank.classList.remove("active");
          }
        });
      });
    }
  }
  
  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCheckoutForm);
  } else {
    initCheckoutForm();
  }
  
  // Re-init khi tab hotel được switch (cho cart-unified)
  document.addEventListener('hotelCartTabActivated', function() {
    setTimeout(initCheckoutForm, 100); // Delay một chút để đảm bảo DOM đã render
  });
})();

// ==================== UPDATE CART COUNT IN HEADER ====================
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

// ==================== HANDLE "ĐẶT NGAY" BUTTON ====================
(function() {
  function initBookNowButtons() {
    // Dùng event delegation để bắt tất cả clicks, kể cả disabled buttons
    const roomActionsContainer = document.querySelector('.rooms');
    if (!roomActionsContainer) {
      return;
    }
    
    console.log('Attaching event delegation for book-now buttons');
    
    // Tìm tất cả buttons (cả enabled và disabled)
    const allBookNowButtons = roomActionsContainer.querySelectorAll('.room-cta');
    console.log('Found', allBookNowButtons.length, 'book-now buttons');
    
    // Attach listener trực tiếp lên từng button với capture: true
    allBookNowButtons.forEach((btn, index) => {
      console.log(`Attaching listener to book-now button ${index + 1}, disabled:`, btn.disabled, 'has class:', btn.classList.contains('room-button-disabled'));
      
      // Dùng capture phase để bắt event trước khi bị chặn
      btn.addEventListener('click', function(e) {
        console.log('Book now button clicked directly, disabled:', this.disabled, 'has class:', this.classList.contains('room-button-disabled'));
        
        e.preventDefault();
        e.stopPropagation();
        
        // Kiểm tra nếu button có class disabled hoặc data-no-dates
        if (this.classList.contains('room-button-disabled') || this.dataset.noDates === 'true') {
          console.log('Button requires dates, showing message');
          showDateRequiredMessage();
          return false;
        }
        
        // Với button enabled, kiểm tra URL có dates không
        const href = this.getAttribute('href');
        if (!href || !href.includes('checkInDate') || !href.includes('checkOutDate')) {
          console.log('Button enabled but no dates in URL');
          showDateRequiredMessage();
          return false;
        }
      }, true); // capture: true
    });
  }
  
  // Chờ DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBookNowButtons);
  } else {
    initBookNowButtons();
  }
})();

// ==================== AUTO CLEAR CART ON LEAVE ====================
(function() {
  // Chỉ chạy trên trang cart
  const isCartPage = window.location.pathname === '/cart' || window.location.href.includes('/cart?');
  
  // Clear flag khi vào trang pending hoặc success (để reset cho lần booking sau)
  if (window.location.pathname.includes('/hotel-booking/pending') || window.location.pathname.includes('/hotel-booking/success')) {
    sessionStorage.removeItem('hotel_checkout_in_progress');
    return;
  }
  
  if (!isCartPage) return;
  
  let isCheckingOut = false;
  
  // Đánh dấu khi đang checkout để không clear cart
  const checkoutForm = document.getElementById('hotelCheckoutForm');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', function() {
      isCheckingOut = true;
      // Lưu flag vào sessionStorage để tránh clear khi redirect
      sessionStorage.setItem('hotel_checkout_in_progress', 'true');
    });
  }
  
  // Clear cart khi rời khỏi trang (trừ khi đang checkout)
  window.addEventListener('beforeunload', function(e) {
    // Không clear nếu đang checkout
    if (isCheckingOut || sessionStorage.getItem('hotel_checkout_in_progress') === 'true') {
      return;
    }
    
    // Clear cart bằng beacon API (không block navigation)
    const clearUrl = '/hotel-cart/clear';
    
    // Sử dụng sendBeacon để gửi request mà không chặn navigation
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
      navigator.sendBeacon(clearUrl, blob);
    } else {
      // Fallback: sử dụng fetch với keepalive
      fetch(clearUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        keepalive: true
      }).catch(err => console.log('Clear cart error:', err));
    }
  });
})();

