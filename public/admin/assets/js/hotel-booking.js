// ==================== HOTEL BOOKING - ROOM MANAGEMENT ====================

(function() {
  // Chỉ chạy trên trang room management
  const roomManagementPage = document.querySelector('.room-management-page');
  if (!roomManagementPage) return;

  // ========== XEM CHI TIẾT BOOKINGS CỦA PHÒNG ==========
  const viewBookingsButtons = document.querySelectorAll('.btn-view-bookings');
  
  viewBookingsButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const roomNumber = this.dataset.roomNumber;
      const bookingsData = JSON.parse(this.dataset.bookings || '[]');
      
      showBookingsDetailModal(roomNumber, bookingsData);
    });
  });
  
  // Helper function để map status sang text và badge class
  function getStatusDisplay(status) {
    const statusMap = {
      'pending':     { text: 'Chờ xác nhận',  class: 'badge-yellow' },
      'confirmed':   { text: 'Đã xác nhận',   class: 'badge-blue'   },
      'checked_in':  { text: 'Đã nhận phòng', class: 'badge-green'  },
      'checked_out': { text: 'Đã trả phòng',  class: 'badge-gray'   },
      'cancelled':   { text: 'Đã hủy',        class: 'badge-red'    },
    };
    return statusMap[status] || { text: 'Chờ xác nhận', class: 'badge-yellow' };
  }
  
  function showBookingsDetailModal(roomNumber, bookings) {
    const modalHtml = `
      <div class="bookings-detail-modal active" id="bookingsDetailModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Bookings - Phòng ${roomNumber}</h3>
            <button class="modal-close" type="button">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            ${bookings.length > 0 ? `
              <div class="bookings-list">
                ${bookings.map(booking => {
                  const isTourHold    = booking.isTourHold;
                  const tourAssigned  = booking.tourAssigned;
                  // Nếu tour hold chưa gán khách → luôn hiển thị "confirmed" bất kể DB
                  const effectiveStatus = (isTourHold && !tourAssigned) ? 'confirmed' : booking.status;
                  const statusDisplay = getStatusDisplay(effectiveStatus);

                  // Badge tour hold
                  const tourBadge = isTourHold
                    ? tourAssigned
                      ? `<span class="booking-status-badge badge-green" style="margin-left:6px">
                           <i class="fa-solid fa-person-shelter"></i> Tour – Đã phân công
                         </span>`
                      : `<span class="booking-status-badge badge-purple" style="margin-left:6px">
                           <i class="fa-solid fa-lock"></i> Tour – Chưa phân công
                         </span>`
                    : '';

                  // Nút huỷ xếp phòng: booking thường, chưa nhận/trả phòng
                  const canUnassign = !isTourHold
                    && booking.bookingId
                    && effectiveStatus !== 'checked_in'
                    && effectiveStatus !== 'checked_out'
                    && effectiveStatus !== 'cancelled';

                  // Nút xóa booking: chỉ khi đã trả phòng hoặc đã hủy
                  const canDelete = !isTourHold
                    && booking.bookingId
                    && (effectiveStatus === 'checked_out' || effectiveStatus === 'cancelled');

                  return `
                    <div class="booking-detail-card${isTourHold ? ' booking-detail-card--tour' : ''}${canDelete ? ' booking-detail-card--finished' : ''}">
                      <div class="booking-detail-header">
                        <span class="booking-code">${booking.code}</span>
                        <span class="booking-status-badge ${statusDisplay.class}">${statusDisplay.text}</span>
                        ${tourBadge}
                        ${canUnassign ? `<button class="btn-unassign-room" data-booking-id="${booking.bookingId}" onclick="unassignRoom(this)" title="Huỷ xếp phòng này"><i class="fa-solid fa-rotate-left"></i> Huỷ xếp phòng</button>` : ''}
                        ${canDelete ? `<button class="btn-delete-room-booking" data-booking-id="${booking.bookingId}" data-booking-code="${booking.code}" title="Xóa booking này"><i class="fa-regular fa-trash-can"></i> Xóa</button>` : ''}
                      </div>
                      <div class="booking-detail-body">
                        <div class="detail-row">
                          <i class="fa-solid fa-user"></i>
                          <span><strong>${isTourHold ? 'Khách tour:' : 'Khách hàng:'}</strong> ${
                            isTourHold && !tourAssigned
                              ? '<em style="color:#9ca3af">Chưa phân công</em>'
                              : booking.customerName
                          }</span>
                        </div>
                        ${booking.customerPhone && tourAssigned ? `
                          <div class="detail-row">
                            <i class="fa-solid fa-phone"></i>
                            <span><strong>SĐT:</strong> ${booking.customerPhone}</span>
                          </div>
                        ` : ''}
                        <div class="detail-row">
                          <i class="fa-solid fa-calendar-check"></i>
                          <span><strong>Check-in:</strong> ${booking.checkIn}</span>
                        </div>
                        <div class="detail-row">
                          <i class="fa-solid fa-calendar-xmark"></i>
                          <span><strong>Check-out:</strong> ${booking.checkOut}</span>
                        </div>
                        ${booking.rooms > 0 && !isTourHold ? `
                          <div class="detail-row">
                            <i class="fa-solid fa-bed"></i>
                            <span><strong>Số phòng:</strong> ${booking.rooms}</span>
                          </div>
                        ` : ''}
                        ${isTourHold && booking.tourName ? `
                          <div class="detail-row" style="margin-top:4px">
                            <i class="fa-solid fa-route" style="color:#7c3aed"></i>
                            <span><strong>Tour:</strong> ${booking.tourName}</span>
                          </div>
                        ` : ''}
                        ${isTourHold && booking.tourDeparture ? `
                          <div class="detail-row" style="color:#6b7280;font-size:13px">
                            <i class="fa-solid fa-plane-departure"></i>
                            <span>${booking.tourDeparture}${booking.tourEndDate ? ' → ' + booking.tourEndDate : ''}</span>
                          </div>
                        ` : ''}
                        ${booking.roomsDetails && booking.roomsDetails.length > 0 && !isTourHold ? `
                          <div class="detail-row">
                            <i class="fa-solid fa-users"></i>
                            <span><strong>Chi tiết từng phòng:</strong></span>
                          </div>
                          <div class="rooms-details-list" style="margin-left: 24px; margin-top: 8px;">
                            ${booking.roomsDetails.map(detail => `
                              <div class="room-detail-item" style="margin-bottom: 8px; font-size: 14px; color: #555;">
                                <strong>Phòng ${detail.roomIndex}:</strong> ${detail.adults} người lớn, ${detail.children} trẻ em${detail.children > 0 ? ` (${detail.childrenAges})` : ''}
                              </div>
                            `).join('')}
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : '<p class="empty-message">Không có booking nào</p>'}
          </div>
          <div class="modal-footer">
            <button class="btn-modal btn-cancel" type="button">Đóng</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const modal = document.getElementById('bookingsDetailModal');
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.btn-cancel');
    
    const closeModal = () => modal.remove();
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });

    // Xóa booking đã trả phòng / đã hủy trực tiếp trong modal
    modal.addEventListener('click', async function(e) {
      const btn = e.target.closest('.btn-delete-room-booking');
      if (!btn) return;

      const bookingId   = btn.dataset.bookingId;
      const bookingCode = btn.dataset.bookingCode || bookingId;
      if (!confirm(`Xóa booking ${bookingCode}?\nHành động này không thể hoàn tác!`)) return;

      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

      try {
        const res  = await fetch(`/${pathAdmin}/hotel/booking/delete`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ bookingId }),
        });
        const data = await res.json();
        if (data.code === 'success') {
          const card = btn.closest('.booking-detail-card');
          if (card) card.remove();
          const remaining = modal.querySelectorAll('.booking-detail-card');
          if (remaining.length === 0) {
            const list = modal.querySelector('.bookings-list');
            if (list) list.innerHTML = '<p class="empty-message">Không có booking nào</p>';
          }
        } else {
          throw new Error(data.message || 'Có lỗi xảy ra!');
        }
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-regular fa-trash-can"></i> Xóa';
        alert(err.message || 'Không thể xóa booking!');
      }
    });
  }

  // ========== XẾP PHÒNG ==========
  // Lấy tất cả nút "Xếp phòng"
  const assignButtons = document.querySelectorAll('.btn-assign-room');
  
  assignButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const bookingId  = this.dataset.bookingId;
      const roomTypeId = this.dataset.roomTypeId;
      const bookingCheckIn  = this.dataset.checkIn  || '';  // "YYYY-MM-DD"
      const bookingCheckOut = this.dataset.checkOut || '';  // "YYYY-MM-DD"
      
      // Lấy thông tin booking từ card
      const bookingCard = this.closest('.pending-booking-card');
      const bookingCode    = bookingCard.querySelector('.booking-code').textContent;
      const bookingDetails = bookingCard.querySelector('.booking-details').textContent;
      const bookingDates   = bookingCard.querySelector('.booking-dates').textContent;
      
      // Lấy số lượng phòng cần đặt
      const roomCountText = bookingDetails.match(/×\s*(\d+)\s*phòng/);
      const roomCount = roomCountText ? parseInt(roomCountText[1]) : 1;

      // Helper: parse "DD/MM/YYYY" → Date (midnight UTC)
      function parseDMY(str) {
        if (!str) return null;
        const [d, m, y] = str.split('/');
        if (!d || !m || !y) return null;
        return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
      }

      // Kiểm tra hai khoảng [a,b) và [c,d) có overlap không
      function overlapsHalfOpen(aStr, bStr, cStr, dStr) {
        const a = aStr ? new Date(aStr) : null;
        const b = bStr ? new Date(bStr) : null;
        const c = parseDMY(cStr);
        const d = parseDMY(dStr);
        if (!a || !b || !c || !d) return false;
        return a < d && c < b;
      }

      // Lọc chỉ những phòng cùng loại VÀ không có booking overlap với khoảng booking này
      const allRooms = Array.from(document.querySelectorAll('.room-row'))
        .filter(row => row.dataset.roomTypeId === roomTypeId);

      const availableRooms = allRooms.filter(row => {
        if (!bookingCheckIn || !bookingCheckOut) return true; // nếu không có ngày, hiện tất cả
        // Lấy bookings của phòng từ nút "Xem chi tiết" (data-bookings là JSON)
        const viewBtn = row.querySelector('[data-bookings]');
        if (!viewBtn) return true;
        let bookings = [];
        try { bookings = JSON.parse(viewBtn.dataset.bookings); } catch(e) { return true; }
        // Nếu không có booking nào overlap → phòng trống → hiển thị
        return !bookings.some(b => overlapsHalfOpen(bookingCheckIn, bookingCheckOut, b.checkIn, b.checkOut));
      });
      
      if (availableRooms.length === 0) {
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({ duration: 4000, position: { x: 'right', y: 'top' } });
          notyf.error('Không còn phòng trống nào cho khoảng thời gian này!');
        } else {
          alert('Không còn phòng trống nào cho khoảng thời gian này!');
        }
        return;
      }
      
      if (availableRooms.length < roomCount) {
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({ duration: 4000, position: { x: 'right', y: 'top' } });
          notyf.error(`Chỉ còn ${availableRooms.length} phòng trống, booking cần ${roomCount} phòng!`);
        } else {
          alert(`Chỉ còn ${availableRooms.length} phòng trống, booking cần ${roomCount} phòng!`);
        }
        return;
      }
      
      showAssignRoomModal(bookingId, bookingCode, bookingDetails, bookingDates, availableRooms, roomCount);
    });
  });
  
  function showAssignRoomModal(bookingId, bookingCode, bookingDetails, bookingDates, availableRooms, roomCount) {
    const isMultipleRooms = roomCount > 1;
    const inputType = isMultipleRooms ? 'checkbox' : 'radio';
    const inputName = isMultipleRooms ? 'selectedRooms' : 'selectedRoom';
    
    // Tạo modal HTML
    const modalHtml = `
      <div class="assign-room-modal active" id="assignRoomModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Xếp phòng</h3>
            <button class="modal-close" type="button">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <div class="booking-summary">
              <p><strong>Booking:</strong> ${bookingCode}</p>
              <p><strong>Loại phòng:</strong> ${bookingDetails}</p>
              <p><strong>Thời gian:</strong> ${bookingDates}</p>
              ${isMultipleRooms ? `<p style="color: #D97706; font-weight: 600;">Vui lòng chọn đúng ${roomCount} phòng</p>` : ''}
            </div>
            <h4 style="margin: 0 0 12px 0; font-size: 16px; color: #202224;">Chọn phòng:</h4>
            <div class="available-rooms-list">
              ${availableRooms.map(room => {
                const roomNumber = room.querySelector('.room-number').textContent;
                const roomType = room.querySelector('.room-type').textContent;
                const roomId = room.dataset.roomId;
                return `
                  <label class="room-option">
                    <input type="${inputType}" name="${inputName}" value="${roomId}" class="room-input">
                    <div class="room-option-info">
                      <div class="room-option-number">Phòng ${roomNumber}</div>
                      <div class="room-option-type">${roomType}</div>
                    </div>
                  </label>
                `;
              }).join('')}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-modal btn-cancel" type="button">Hủy</button>
            <button class="btn-modal btn-confirm" type="button" disabled data-room-count="${roomCount}">Xác nhận</button>
          </div>
        </div>
      </div>
    `;
    
    // Thêm modal vào body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const modal = document.getElementById('assignRoomModal');
    const closeBtn = modal.querySelector('.modal-close');
    const cancelBtn = modal.querySelector('.btn-cancel');
    const confirmBtn = modal.querySelector('.btn-confirm');
    const roomInputs = modal.querySelectorAll('.room-input');
    // Số phòng cần chọn chính là roomCount (đã truyền vào)
    const requiredCount = roomCount;
    
    // Function để kiểm tra và enable/disable nút confirm
    function updateConfirmButton() {
      if (isMultipleRooms) {
        const checkedCount = modal.querySelectorAll('.room-input:checked').length;
        confirmBtn.disabled = checkedCount !== requiredCount;
      } else {
        const hasSelection = modal.querySelector('.room-input:checked') !== null;
        confirmBtn.disabled = !hasSelection;
      }
    }
    
    // Enable confirm button khi chọn phòng
    roomInputs.forEach(input => {
      input.addEventListener('change', updateConfirmButton);
    });
    
    // Close modal
    const closeModal = () => {
      modal.remove();
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    // Click outside modal to close
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeModal();
      }
    });
    
    // Confirm assign room
    confirmBtn.addEventListener('click', async function() {
      // Thu thập roomIds đã chọn
      let selectedRoomIds;
      if (isMultipleRooms) {
        selectedRoomIds = Array.from(modal.querySelectorAll('.room-input:checked'))
          .map(input => input.value);
      } else {
        const singleRoom = modal.querySelector('.room-input:checked')?.value;
        selectedRoomIds = singleRoom ? [singleRoom] : [];
      }
      
      if (selectedRoomIds.length === 0) {
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } });
          notyf.error('Vui lòng chọn phòng!');
        } else {
          alert('Vui lòng chọn phòng!');
        }
        return;
      }
      
      if (selectedRoomIds.length !== requiredCount) {
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } });
          notyf.error(`Vui lòng chọn đúng ${requiredCount} phòng!`);
        } else {
          alert(`Vui lòng chọn đúng ${requiredCount} phòng!`);
        }
        return;
      }
      
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...';
      
      try {
        const response = await fetch('/admin/hotel/booking/assign-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId, roomIds: selectedRoomIds }),
        });
        
        const data = await response.json();
        
        if (data.code === 'success') {
          // Đóng modal chọn phòng
          modal.remove();

          // Đánh dấu card này đã xếp xong
          const assignedCard = document.querySelector(
            `.pending-booking-card[data-booking-id="${bookingId}"]`
          );
          if (assignedCard) {
            const assignBtn = assignedCard.querySelector('.btn-assign-room');
            if (assignBtn) {
              assignBtn.disabled = true;
              assignBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Đã xếp';
              assignBtn.style.cssText = 'background:#16a34a;cursor:not-allowed;opacity:.85;';
            }
            assignedCard.style.opacity = '0.55';
          }

          // Tìm nhóm đang mở trong modal
          const currentContent = Array.from(
            document.querySelectorAll('.pending-detail-content')
          ).find(el => el.style.display !== 'none' && el.style.display !== '');

          const allCards = currentContent
            ? Array.from(currentContent.querySelectorAll('.pending-booking-card'))
            : [];

          const remainingCards = allCards.filter(card => {
            const btn = card.querySelector('.btn-assign-room');
            return btn && !btn.disabled;
          });

          if (allCards.length > 0 && remainingCards.length === 0) {
            // Tất cả phòng đã được xếp → thông báo thành công + reload
            if (typeof Notyf !== 'undefined') {
              const notyf = new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } });
              notyf.success('Đã xếp phòng thành công cho tất cả phòng trong đơn!');
            } else {
              alert('Đã xếp phòng thành công!');
            }
            setTimeout(() => { window.location.reload(); }, 1200);
          } else {
            // Vẫn còn phòng chưa xếp → thông báo nhỏ, không reload
            const remaining = remainingCards.length;
            if (typeof Notyf !== 'undefined') {
              const notyf = new Notyf({ duration: 2500, position: { x: 'right', y: 'top' } });
              notyf.success(
                remaining === 1
                  ? 'Đã xếp phòng! Còn 1 phòng cần xếp.'
                  : `Đã xếp phòng! Còn ${remaining} phòng cần xếp.`
              );
            }
          }
        } else {
          throw new Error(data.message || 'Có lỗi xảy ra');
        }
      } catch (error) {
        console.error('Error assigning room:', error);
        
        if (typeof Notyf !== 'undefined') {
          const notyf = new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } });
          notyf.error(error.message || 'Không thể xếp phòng!');
        } else {
          alert(error.message || 'Không thể xếp phòng!');
        }
        
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Xác nhận';
      }
    });
  }
})();

// ==================== EDIT BOOKING STATUS ====================
(function() {
  // Chỉ chạy trên trang booking list
  const bookingListPage = document.querySelector('.booking-list-page');
  if (!bookingListPage) return;

  const modal = document.getElementById('editBookingStatusModal');
  if (!modal) return;

  const form = document.getElementById('editBookingStatusForm');
  const closeBtn = modal.querySelector('.modal-close');
  const cancelBtn = modal.querySelector('.btn-cancel');
  const editButtons = document.querySelectorAll('.edit-btn');

  // Mở modal khi click nút edit
  editButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const bookingId = this.dataset.bookingId;
      const status = this.dataset.status || 'pending';
      const paymentStatus = this.dataset.paymentStatus || 'unpaid';

      // Set giá trị form
      document.getElementById('editBookingId').value = bookingId;
      document.getElementById('editStatus').value = status;
      document.getElementById('editPaymentStatus').value = paymentStatus;

      // Hiển thị modal
      modal.style.display = 'flex';
    });
  });

  // Đóng modal
  function closeModal() {
    modal.style.display = 'none';
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Click overlay để đóng
  modal.querySelector('.modal-overlay')?.addEventListener('click', closeModal);

  // Submit form
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();

      const bookingId = document.getElementById('editBookingId').value;
      const status = document.getElementById('editStatus').value;
      const paymentStatus = document.getElementById('editPaymentStatus').value;

      try {
        const response = await fetch(`/${pathAdmin}/hotel/booking/update-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            bookingId,
            status,
            paymentStatus
          })
        });

        const result = await response.json();

        if (result.code === 'success') {
          // Hiển thị thông báo thành công
          if (typeof notify !== 'undefined') {
            notify.success('Cập nhật trạng thái thành công!');
          }
          
          // Reload trang sau 1 giây
          setTimeout(() => {
            location.reload();
          }, 1000);
        } else {
          if (typeof notify !== 'undefined') {
            notify.error(result.message || 'Có lỗi xảy ra!');
          } else {
            alert(result.message || 'Có lỗi xảy ra!');
          }
        }
      } catch (error) {
        console.error('Error updating booking status:', error);
        if (typeof notify !== 'undefined') {
          notify.error('Có lỗi xảy ra khi cập nhật!');
        } else {
          alert('Có lỗi xảy ra khi cập nhật!');
        }
      }
    });
  }
})();

// ==================== UNASSIGN ROOM ====================
window.unassignRoom = async function(btn) {
  const bookingId = btn.dataset.bookingId;
  if (!bookingId) return;

  if (!confirm('Huỷ xếp phòng này? Booking sẽ trở về danh sách cần xếp phòng.')) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...';

  try {
    const res  = await fetch('/admin/hotel/booking/unassign-room', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bookingId }),
    });
    const data = await res.json();

    if (data.code === 'success') {
      if (typeof Notyf !== 'undefined') {
        new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } }).success(data.message || 'Đã huỷ xếp phòng!');
      } else {
        alert(data.message || 'Đã huỷ xếp phòng!');
      }
      setTimeout(() => window.location.reload(), 1000);
    } else {
      throw new Error(data.message || 'Có lỗi xảy ra!');
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Huỷ xếp phòng';
    if (typeof Notyf !== 'undefined') {
      new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } }).error(err.message || 'Không thể huỷ xếp phòng!');
    } else {
      alert(err.message || 'Không thể huỷ xếp phòng!');
    }
  }
};

// ==================== BOOKING LIST - SEARCH ====================

(function() {
  // Chỉ chạy trên trang booking list
  const bookingListPage = document.querySelector('.booking-list-page');
  if (!bookingListPage) return;

  const searchInput = document.getElementById('bookingSearchInput');
  const searchBtn = document.getElementById('searchBtn');
  
  if (!searchInput) return;

  // Hàm thực hiện search
  function performSearch() {
    const searchValue = searchInput.value.trim();
    const urlParams = new URLSearchParams(window.location.search);
    
    if (searchValue) {
      urlParams.set('search', searchValue);
    } else {
      urlParams.delete('search');
    }
    
    // Giữ nguyên hotelId
    const hotelId = urlParams.get('hotelId');
    if (hotelId) {
      urlParams.set('hotelId', hotelId);
    }
    
    // Redirect với search params mới
    window.location.href = window.location.pathname + '?' + urlParams.toString();
  }

  // Xử lý khi nhấn nút search
  if (searchBtn) {
    searchBtn.addEventListener('click', performSearch);
  }

  // Xử lý khi nhấn Enter trong input
  searchInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
  });

  // Xử lý clear search khi input trống và blur
  searchInput.addEventListener('input', function(e) {
    if (!e.target.value.trim()) {
      // Nếu input trống, có thể thêm nút clear ở đây
      // Hoặc tự động search khi xóa hết
    }
  });
})();

// ==================== DELETE BOOKING ====================
(function() {
  const bookingListPage = document.querySelector('.booking-list-page');
  if (!bookingListPage) return;

  document.addEventListener('click', async function(e) {
    const btn = e.target.closest('.delete-booking-btn');
    if (!btn) return;

    const bookingId   = btn.dataset.bookingId;
    const bookingCode = btn.dataset.bookingCode || bookingId;

    if (!confirm(`Bạn có chắc muốn xóa đơn đặt phòng ${bookingCode}?\nHành động này không thể hoàn tác!`)) return;

    btn.disabled = true;
    const icon = btn.querySelector('i');
    if (icon) { icon.className = 'fa-solid fa-spinner fa-spin'; }

    try {
      const res  = await fetch(`/${pathAdmin}/hotel/booking/delete`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingId }),
      });
      const data = await res.json();

      if (data.code === 'success') {
        if (typeof Notyf !== 'undefined') {
          new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } }).success(data.message || 'Đã xóa đơn đặt phòng!');
        } else {
          alert(data.message || 'Đã xóa đơn đặt phòng!');
        }
        // Xóa hàng khỏi bảng mà không cần reload
        const row = btn.closest('tr');
        if (row) row.remove();
      } else {
        throw new Error(data.message || 'Có lỗi xảy ra!');
      }
    } catch (err) {
      btn.disabled = false;
      if (icon) { icon.className = 'fa-regular fa-trash-can'; }
      if (typeof Notyf !== 'undefined') {
        new Notyf({ duration: 3000, position: { x: 'right', y: 'top' } }).error(err.message || 'Không thể xóa đơn đặt phòng!');
      } else {
        alert(err.message || 'Không thể xóa đơn đặt phòng!');
      }
    }
  });
})();

