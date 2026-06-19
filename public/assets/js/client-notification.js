(function () {
  const bell = document.getElementById("clientNotificationBell");
  const modal = document.getElementById("clientNotificationModal");
  if (!bell || !modal) return;

  const overlay = modal.querySelector(".client-notification-overlay");
  const closeBtn = modal.querySelector(".client-notification-close");
  const listEl = modal.querySelector(".client-notification-list");
  const badgeEl = document.getElementById("clientNotificationBadge");

  function openModal() {
    modal.classList.add("is-open");
    loadNotifications();
  }

  function closeModal() {
    modal.classList.remove("is-open");
  }

  bell.addEventListener("click", function (e) {
    e.stopPropagation();
    openModal();
  });
  if (overlay) overlay.addEventListener("click", closeModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  async function refreshBadge() {
    try {
      const res = await fetch("/notifications/api/unread-count");
      const data = await res.json();
      const count = data.count || 0;
      if (badgeEl) {
        if (count > 0) {
          badgeEl.textContent = count > 99 ? "99+" : count;
          badgeEl.style.display = "";
        } else {
          badgeEl.style.display = "none";
        }
      }
    } catch (e) {
      console.error("refreshBadge", e);
    }
  }

  async function loadNotifications() {
    listEl.innerHTML =
      '<div class="client-notification-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</div>';
    try {
      const res = await fetch("/notifications/api/list?limit=15");
      const data = await res.json();
      if (data.code !== "success" || !data.notifications?.length) {
        listEl.innerHTML =
          '<div class="client-notification-empty"><i class="fa-regular fa-bell-slash"></i><p>Chưa có thông báo</p></div>';
        return;
      }
      renderList(data.notifications, listEl);
    } catch (e) {
      listEl.innerHTML =
        '<div class="client-notification-empty"><p>Không tải được thông báo</p></div>';
    }
  }

  function renderList(notifications, container) {
    const hasUnread = notifications.some((n) => !n.isRead);
    let html = "";
    if (hasUnread) {
      html += `<div class="client-notification-actions">
        <button type="button" id="clientMarkAllReadBtn"><i class="fa-solid fa-check-double"></i> Đánh dấu tất cả đã đọc</button>
      </div>`;
    }
    notifications.forEach((n) => {
      const unread = n.isRead ? "" : " unread";
      html += `<div class="client-notification-item${unread}" data-id="${n._id}" data-link="${escapeAttr(n.link || "")}">
        <div class="client-notification-icon" style="background:${n.iconColor}20;color:${n.iconColor}">
          <i class="fa-solid ${n.icon}"></i>
        </div>
        <div class="client-notification-body">
          <p class="client-notification-title">${escapeHtml(n.title)}</p>
          <p class="client-notification-text">${escapeHtml(n.content)}</p>
          <span class="client-notification-time">${escapeHtml(n.timeAgo)}</span>
        </div>
      </div>`;
    });
    container.innerHTML = html;

    const markAll = document.getElementById("clientMarkAllReadBtn");
    if (markAll) {
      markAll.addEventListener("click", async (e) => {
        e.stopPropagation();
        await markRead({ all: true });
        await loadNotifications();
        await refreshBadge();
      });
    }

    container.querySelectorAll(".client-notification-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const id = el.dataset.id;
        const link = el.dataset.link;
        if (id) await markRead({ id });
        closeModal();
        await refreshBadge();
        if (link) window.location.href = link;
      });
    });
  }

  async function markRead(body) {
    try {
      await fetch("/notifications/api/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("markRead", e);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s || "").replace(/"/g, "&quot;");
  }

  window.clientNotificationRefreshBadge = refreshBadge;
  refreshBadge();
})();
