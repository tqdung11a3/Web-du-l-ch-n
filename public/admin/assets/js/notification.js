// public/admin/assets/js/notification.js
// ==================== NOTIFICATION SYSTEM ====================

(function() {
  const notificationBell = document.getElementById('notificationBell');
  const notificationModal = document.getElementById('notificationModal');
  
  if (!notificationBell || !notificationModal) return;
  
  const modalOverlay = notificationModal.querySelector('.notification-modal-overlay');
  const modalClose = notificationModal.querySelector('.notification-modal-close');
  const notificationList = notificationModal.querySelector('.notification-list');
  
  // Mở modal
  notificationBell.addEventListener('click', function(e) {
    e.stopPropagation();
    notificationModal.style.display = 'flex';
    loadNotifications();
  });
  
  // Đóng modal
  function closeModal() {
    notificationModal.style.display = 'none';
  }
  
  if (modalOverlay) modalOverlay.addEventListener('click', closeModal);
  if (modalClose) modalClose.addEventListener('click', closeModal);
  
  // Load notifications
  async function loadNotifications() {
    try {
      notificationList.innerHTML = `
        <div class="loading-notifications">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>Đang tải...</span>
        </div>
      `;
      
      const response = await fetch(`/${pathAdmin}/notifications/list`);
      const result = await response.json();
      
      if (result.code === 'success') {
        renderNotifications(result.notifications);
      } else {
        notificationList.innerHTML = `
          <div class="empty-notifications">
            <i class="fa-regular fa-bell-slash"></i>
            <p>Không có thông báo nào</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      notificationList.innerHTML = `
        <div class="empty-notifications">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <p>Có lỗi xảy ra khi tải thông báo</p>
        </div>
      `;
    }
  }
  
  // Render notifications
  function renderNotifications(notifications) {
    if (!notifications || notifications.length === 0) {
      notificationList.innerHTML = `
        <div class="empty-notifications">
          <i class="fa-regular fa-bell-slash"></i>
          <p>Không có thông báo nào</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    
    // Nút đánh dấu tất cả đã đọc
    const hasUnread = notifications.some(n => !n.isRead);
    if (hasUnread) {
      html += `
        <div class="notification-actions">
          <button class="btn-mark-all-read" onclick="markAllAsRead()">
            <i class="fa-solid fa-check-double"></i>
            Đánh dấu tất cả đã đọc
          </button>
        </div>
      `;
    }
    
    notifications.forEach(notification => {
      const unreadClass = notification.isRead ? '' : 'unread';
      const metadata = notification.metadata || {};
      
      // Format nội dung chi tiết
      let detailHtml = '';
      if (metadata.checkIn && metadata.checkOut) {
        const checkIn = new Date(metadata.checkIn).toLocaleDateString('vi-VN');
        const checkOut = new Date(metadata.checkOut).toLocaleDateString('vi-VN');
        detailHtml += `<div class="notification-detail">Check-in: ${checkIn} → Check-out: ${checkOut}</div>`;
      }
      if (metadata.paymentMethod) {
        detailHtml += `<div class="notification-detail">Thanh toán: ${metadata.paymentMethod}</div>`;
      }
      if (metadata.amount) {
        const amount = metadata.amount.toLocaleString('vi-VN');
        detailHtml += `<div class="notification-detail">Tổng tiền: ${amount} VND</div>`;
      }
      
      html += `
        <div class="notification-item ${unreadClass}" data-notification-id="${notification._id}">
          <div class="notification-icon" style="background-color: ${notification.iconColor}20;">
            <i class="fa-solid ${notification.icon}" style="color: ${notification.iconColor};"></i>
          </div>
          <div class="notification-content">
            <div class="notification-header">
              <h4 class="notification-title">${notification.title}</h4>
              <span class="notification-time">${notification.timeAgo}</span>
            </div>
            <p class="notification-text">${notification.content}</p>
            ${detailHtml}
            ${notification.link ? `
              <a href="${notification.link}" class="notification-link">
                Xem chi tiết <i class="fa-solid fa-arrow-right"></i>
              </a>
            ` : ''}
          </div>
          ${!notification.isRead ? `
            <button class="btn-mark-read" onclick="markAsRead('${notification._id}', event)">
              <i class="fa-solid fa-check"></i>
            </button>
          ` : ''}
        </div>
      `;
    });
    
    notificationList.innerHTML = html;
  }
  
  // Đánh dấu đã đọc
  window.markAsRead = async function(notificationId, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    
    try {
      const response = await fetch(`/${pathAdmin}/notifications/mark-as-read/${notificationId}`, {
        method: 'POST',
      });
      const result = await response.json();
      
      if (result.code === 'success') {
        // Update UI
        const notificationItem = document.querySelector(`[data-notification-id="${notificationId}"]`);
        if (notificationItem) {
          notificationItem.classList.remove('unread');
          const markReadBtn = notificationItem.querySelector('.btn-mark-read');
          if (markReadBtn) markReadBtn.remove();
        }
        
        // Update badge
        updateNotificationBadge(result.unreadCount);
      }
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };
  
  // Đánh dấu tất cả đã đọc
  window.markAllAsRead = async function() {
    try {
      const response = await fetch(`/${pathAdmin}/notifications/mark-all-as-read`, {
        method: 'POST',
      });
      const result = await response.json();
      
      if (result.code === 'success') {
        // Reload notifications
        loadNotifications();
        
        // Update badge
        updateNotificationBadge(0);
        
        if (typeof notify !== 'undefined') {
          notify.success('Đã đánh dấu tất cả đã đọc!');
        }
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };
  
  // Update notification badge
  function updateNotificationBadge(count) {
    const badge = notificationBell.querySelector('.notification-badge');
    if (count > 0) {
      if (badge) {
        badge.textContent = count;
      } else {
        const newBadge = document.createElement('span');
        newBadge.className = 'notification-badge';
        newBadge.textContent = count;
        notificationBell.appendChild(newBadge);
      }
    } else {
      if (badge) {
        badge.remove();
      }
    }
  }
})();

