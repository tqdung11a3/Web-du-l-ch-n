// public/assets/js/cart-unified.js
// JavaScript cho trang giỏ hàng thống nhất

(function() {
  'use strict';
  
  // ==================== TAB SWITCHING ====================
  const tabs = document.querySelectorAll('.cart-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', function() {
      const targetTab = this.dataset.tab;
      
      // Remove active class from all tabs and panes
      tabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      
      // Add active class to clicked tab
      this.classList.add('active');
      
      // Show corresponding pane
      const targetPane = document.getElementById(targetTab + 'CartTab');
      if (targetPane) {
        targetPane.classList.add('active');
      }
      
      // Dispatch event khi tab hotel được activate
      if (targetTab === 'hotel') {
        const event = new CustomEvent('hotelCartTabActivated');
        document.dispatchEvent(event);
      }

      // Cập nhật query param ?tab=... vào URL để khi reload vẫn giữ đúng tab
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', targetTab);
        window.history.replaceState({}, '', url.toString());
      } catch (e) {
        // ignore nếu URL không parse được
      }
    });
  });
  
  // ==================== UPDATE CART BADGES ====================
  function updateCartBadges() {
    // Tour cart badge (from sessionStorage)
    updateTourCartBadge();
    
    // Hotel cart badge (from server)
    updateHotelCartBadge();
  }
  
  function updateTourCartBadge() {
    try {
      const cartData = sessionStorage.getItem('cart') || '[]';
      const cart = JSON.parse(cartData);
      const count = Array.isArray(cart) ? cart.length : 0;
      
      const badge = document.getElementById('tourCartBadge');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
    } catch (error) {
      console.error('Error updating tour cart badge:', error);
    }
  }
  
  async function updateHotelCartBadge() {
    try {
      const response = await fetch('/hotel-cart/count');
      const data = await response.json();
      
      const badge = document.getElementById('hotelCartBadge');
      if (badge && data.code === 'success') {
        const count = data.count || 0;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
      }
    } catch (error) {
      console.error('Error updating hotel cart badge:', error);
    }
  }
  
  // Update badges on page load
  updateCartBadges();
  
  // ==================== HANDLE QUERY PARAMETER ====================
  // Nếu có ?tab=hotel trong URL, tự động chuyển sang tab hotel
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam === 'hotel') {
    const hotelTab = document.querySelector('.cart-tab[data-tab="hotel"]');
    if (hotelTab) {
      hotelTab.click();
      // Dispatch event sau khi click
      setTimeout(() => {
        const event = new CustomEvent('hotelCartTabActivated');
        document.dispatchEvent(event);
      }, 100);
    }
  }
  
  // Listen for cart updates from tour cart
  window.addEventListener('storage', function(e) {
    if (e.key === 'cart') {
      updateTourCartBadge();
    }
  });
  
  // Listen for custom events
  document.addEventListener('tourCartUpdated', updateTourCartBadge);
  document.addEventListener('hotelCartUpdated', updateHotelCartBadge);

  // ==================== HOTEL AVAILABILITY CHECK ====================
  async function checkHotelCartAvailability() {
    const warningEl = document.getElementById('hotelAvailabilityWarning');
    if (!warningEl) return;

    try {
      const res  = await fetch('/hotel-cart/check-availability');
      const data = await res.json();
      if (data.code !== 'success') return;

      if (data.allOk) {
        warningEl.style.display = 'none';
        warningEl.innerHTML = '';
        return;
      }

      // Tạo cảnh báo cho từng item bị thiếu phòng
      const unavailableItems = data.items.filter(i => !i.ok);
      const html = `
        <div class="hotel-avail-warning">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <div>
            <strong>Một số phòng trong giỏ hàng của bạn vừa hết:</strong>
            <ul>
              ${unavailableItems.map(i => `
                <li>
                  <b>${i.roomTypeName}</b>:
                  bạn yêu cầu ${i.requested} phòng,
                  ${i.available > 0
                    ? `chỉ còn <b>${i.available}</b> phòng trống.`
                    : '<b>đã hết phòng</b>.'}
                </li>`).join('')}
            </ul>
            <span>Vui lòng điều chỉnh số lượng hoặc chọn ngày khác.</span>
          </div>
        </div>`;
      warningEl.innerHTML = html;
      warningEl.style.display = 'block';
    } catch (err) {
      console.error('checkHotelCartAvailability error:', err);
    }
  }

  // Kiểm tra khi tab hotel được mở
  document.addEventListener('hotelCartTabActivated', checkHotelCartAvailability);

  // Kiểm tra ngay nếu đang ở tab hotel (URL có ?tab=hotel)
  if (new URLSearchParams(window.location.search).get('tab') === 'hotel') {
    setTimeout(checkHotelCartAvailability, 300);
  }
})();

