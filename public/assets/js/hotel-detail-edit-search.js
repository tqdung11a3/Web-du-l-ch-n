// public/assets/js/hotel-detail-edit-search.js

(function() {
  'use strict';
  
  // Kiểm tra xem đã attach listener chưa
  if (window.hotelDetailEditSearchAttached) {
    return;
  }
  window.hotelDetailEditSearchAttached = true;
  
  const editBtn = document.getElementById('editSearchBtn');
  const modal = document.getElementById('editSearchModal');
  const closeBtn = modal?.querySelector('.edit-search-modal__close');
  const overlay = modal?.querySelector('.edit-search-modal__overlay');
  const form = document.getElementById('editSearchForm');
  const guestBtn = document.getElementById('editGuestBtn');
  const guestsPopup = document.getElementById('editGuestsPopup');
  const roomsContainer = document.getElementById('editRoomsContainer');
  const addRoomBtn = document.getElementById('editAddRoomBtn');
  const guestsDoneBtn = document.getElementById('editGuestsDoneBtn');
  const guestText = document.getElementById('editGuestText');
  const roomsInput = document.getElementById('editRoomsInput');
  const adultsInput = document.getElementById('editAdultsInput');
  const childrenInput = document.getElementById('editChildrenInput');
  const roomsDataInput = document.getElementById('editRoomsDataInput');
  
  if (!editBtn || !modal || !form) return;
  
  // ==================== MODAL OPEN/CLOSE ====================
  editBtn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    // Parse roomsData từ URL hoặc hidden input
    parseRoomsDataFromURL();
  });
  
  function closeModal() {
    modal.style.display = 'none';
    document.body.style.overflow = '';
    guestsPopup.setAttribute('aria-hidden', 'true');
    guestBtn.setAttribute('aria-expanded', 'false');
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }
  
  if (overlay) {
    overlay.addEventListener('click', closeModal);
  }
  
  // ==================== CANCEL BUTTON (RESET SEARCH) ====================
  const cancelBtn = modal?.querySelector('.btn-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      // Reset: redirect về URL hotel detail mà không có query parameters
      const currentUrl = window.location.pathname;
      // Chỉ giữ lại hotel ID, xóa tất cả query parameters
      window.location.href = currentUrl;
    });
  }
  
  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.style.display === 'block') {
      closeModal();
    }
  });
  
  // ==================== GUESTS POPUP ====================
  let roomsData = [];
  
  function parseRoomsDataFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomsDataStr = urlParams.get('roomsData');
    
    if (roomsDataStr) {
      try {
        roomsData = JSON.parse(decodeURIComponent(roomsDataStr));
      } catch (e) {
        console.warn('Failed to parse roomsData:', e);
        roomsData = [];
      }
    } else {
      // Fallback: parse từ rooms, adults, children
      const rooms = parseInt(urlParams.get('rooms') || roomsInput.value || '1', 10);
      const adults = parseInt(urlParams.get('adults') || adultsInput.value || '1', 10);
      const children = parseInt(urlParams.get('children') || childrenInput.value || '0', 10);
      
      roomsData = [{
        adults: adults,
        children: Array(children).fill(0).map(() => ({ age: 0 }))
      }];
    }
    
    if (roomsData.length === 0) {
      roomsData = [{ adults: 1, children: [] }];
    }
    
    renderRooms();
    updateSummary();
  }
  
  function renderRooms() {
    if (!roomsContainer) return;
    
    roomsContainer.innerHTML = '';
    
    roomsData.forEach((room, roomIndex) => {
      const roomDiv = document.createElement('div');
      roomDiv.className = 'edit-guests-room';
      roomDiv.innerHTML = `
        <div class="edit-guests-room__header">
          <span>Phòng ${roomIndex + 1}</span>
          ${roomIndex > 0 ? '<button type="button" class="edit-guests-room__remove" data-room-index="' + roomIndex + '">Xóa</button>' : ''}
        </div>
        <div class="edit-guests-room__controls">
          <div class="edit-guests-room__control">
            <label>Người lớn</label>
            <div class="edit-guests-room__counter">
              <button type="button" class="edit-guests-room__btn" data-action="decrease-adults" data-room="${roomIndex}">-</button>
              <span class="edit-guests-room__value" data-room="${roomIndex}" data-type="adults">${room.adults || 1}</span>
              <button type="button" class="edit-guests-room__btn" data-action="increase-adults" data-room="${roomIndex}">+</button>
            </div>
          </div>
          <div class="edit-guests-room__control">
            <label>Trẻ em</label>
            <div class="edit-guests-room__counter">
              <button type="button" class="edit-guests-room__btn" data-action="decrease-children" data-room="${roomIndex}">-</button>
              <span class="edit-guests-room__value" data-room="${roomIndex}" data-type="children">${room.children?.length || 0}</span>
              <button type="button" class="edit-guests-room__btn" data-action="increase-children" data-room="${roomIndex}">+</button>
            </div>
          </div>
        </div>
        ${(room.children && room.children.length > 0) ? `
          <div class="edit-guests-room__ages">
            ${room.children.map((child, childIndex) => `
              <div class="edit-guests-room__age-item">
                <label>Trẻ em ${childIndex + 1}: <span class="age-label-text">tuổi</span></label>
                <select class="edit-guests-room__age-select" data-room="${roomIndex}" data-child="${childIndex}">
                  ${Array.from({ length: 18 }, (_, i) => `
                    <option value="${i}" ${child.age === i ? 'selected' : ''}>${i === 0 ? 'Dưới 1' : i}</option>
                  `).join('')}
                </select>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `;
      roomsContainer.appendChild(roomDiv);
    });
    
    // Attach event listeners
    attachRoomEventListeners();
  }
  
  function attachRoomEventListeners() {
    // Remove room
    roomsContainer.querySelectorAll('.edit-guests-room__remove').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const roomIndex = parseInt(this.dataset.roomIndex, 10);
        roomsData.splice(roomIndex, 1);
        renderRooms();
        updateSummary();
      });
    });
    
    // Increase/decrease adults
    roomsContainer.querySelectorAll('[data-action="increase-adults"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const roomIndex = parseInt(this.dataset.room, 10);
        if (!roomsData[roomIndex]) roomsData[roomIndex] = { adults: 1, children: [] };
        roomsData[roomIndex].adults = (roomsData[roomIndex].adults || 1) + 1;
        renderRooms();
        updateSummary();
      });
    });
    
    roomsContainer.querySelectorAll('[data-action="decrease-adults"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const roomIndex = parseInt(this.dataset.room, 10);
        if (roomsData[roomIndex] && roomsData[roomIndex].adults > 1) {
          roomsData[roomIndex].adults--;
          renderRooms();
          updateSummary();
        }
      });
    });
    
    // Increase/decrease children
    roomsContainer.querySelectorAll('[data-action="increase-children"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const roomIndex = parseInt(this.dataset.room, 10);
        if (!roomsData[roomIndex]) roomsData[roomIndex] = { adults: 1, children: [] };
        if (!roomsData[roomIndex].children) roomsData[roomIndex].children = [];
        roomsData[roomIndex].children.push({ age: 0 });
        renderRooms();
        updateSummary();
      });
    });
    
    roomsContainer.querySelectorAll('[data-action="decrease-children"]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const roomIndex = parseInt(this.dataset.room, 10);
        if (roomsData[roomIndex] && roomsData[roomIndex].children && roomsData[roomIndex].children.length > 0) {
          roomsData[roomIndex].children.pop();
          renderRooms();
          updateSummary();
        }
      });
    });
    
    // Age select
    roomsContainer.querySelectorAll('.edit-guests-room__age-select').forEach(select => {
      select.addEventListener('change', function(e) {
        e.stopPropagation();
        const roomIndex = parseInt(this.dataset.room, 10);
        const childIndex = parseInt(this.dataset.child, 10);
        if (roomsData[roomIndex] && roomsData[roomIndex].children && roomsData[roomIndex].children[childIndex]) {
          roomsData[roomIndex].children[childIndex].age = parseInt(this.value, 10);
          updateSummary();
        }
      });
    });
  }
  
  function updateSummary() {
    const totalRooms = roomsData.length;
    const totalAdults = roomsData.reduce((sum, r) => sum + (r.adults || 1), 0);
    const totalChildren = roomsData.reduce((sum, r) => sum + (r.children?.length || 0), 0);
    
    if (guestText) {
      guestText.textContent = `${totalRooms} phòng - ${totalAdults} người lớn${totalChildren > 0 ? `, ${totalChildren} trẻ em` : ''}`;
    }
    
    if (roomsInput) roomsInput.value = totalRooms;
    if (adultsInput) adultsInput.value = totalAdults;
    if (childrenInput) childrenInput.value = totalChildren;
    if (roomsDataInput) roomsDataInput.value = encodeURIComponent(JSON.stringify(roomsData));
  }
  
  // Toggle guests popup
  if (guestBtn && guestsPopup) {
    guestBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !isExpanded);
      guestsPopup.setAttribute('aria-hidden', isExpanded);
    });
    
    // Close popup when clicking outside
    document.addEventListener('click', function(e) {
      if (!guestsPopup.contains(e.target) && !guestBtn.contains(e.target)) {
        guestsPopup.setAttribute('aria-hidden', 'true');
        guestBtn.setAttribute('aria-expanded', 'false');
      }
    });
    
    // Prevent popup from closing when clicking inside
    guestsPopup.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  }
  
  // Add room
  if (addRoomBtn) {
    addRoomBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      roomsData.push({ adults: 1, children: [] });
      renderRooms();
      updateSummary();
    });
  }

  // Close guests popup via Done button
  if (guestsDoneBtn) {
    guestsDoneBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      guestsPopup.setAttribute('aria-hidden', 'true');
      guestBtn.setAttribute('aria-expanded', 'false');
    });
  }
  
  // ==================== FORM SUBMIT ====================
  // kiểm tra nếu form có action thì thêm action vào form
  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const formData = new FormData(form);
      const params = new URLSearchParams();
      
      // Add dates
      const checkInDate = formData.get('checkInDate');
      const checkOutDate = formData.get('checkOutDate');
      if (checkInDate) params.set('checkInDate', checkInDate);
      if (checkOutDate) params.set('checkOutDate', checkOutDate);
      
      // Add rooms data
      const roomsDataStr = roomsDataInput.value;
      if (roomsDataStr) params.set('roomsData', roomsDataStr);
      
      // Add rooms, adults, children (for backward compatibility)
      params.set('rooms', roomsInput.value || '1');
      params.set('adults', adultsInput.value || '1');
      params.set('children', childrenInput.value || '0');
      
      // Lưu vị trí cuộn hiện tại để khôi phục sau khi reload
      try {
        sessionStorage.setItem('hotelDetailScrollY', String(window.scrollY || window.pageYOffset || 0));
      } catch (e) { /* ignore */ }

      // Reload page with new params
      const currentUrl = window.location.pathname;
      const newUrl = currentUrl + (params.toString() ? '?' + params.toString() : '');
      window.location.href = newUrl;
    });
  }
  
  // Khôi phục vị trí cuộn sau khi reload (nếu có lưu)
  (function restoreScrollPosition() {
    try {
      const savedY = sessionStorage.getItem('hotelDetailScrollY');
      if (savedY === null) return;
      sessionStorage.removeItem('hotelDetailScrollY');
      const targetY = parseInt(savedY, 10);
      if (!targetY) return;

      // Chờ DOM và ảnh render xong rồi mới scroll
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          window.scrollTo({ top: targetY, behavior: 'instant' });
        });
      } else {
        // requestAnimationFrame để scroll sau khi browser paint lần đầu
        requestAnimationFrame(function() {
          window.scrollTo({ top: targetY, behavior: 'instant' });
        });
      }
    } catch (e) { /* ignore */ }
  })();

  // Initialize on page load
  parseRoomsDataFromURL();
})();

