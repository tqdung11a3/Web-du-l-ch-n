/**
 * HTML email khi admin cập nhật đơn tour / đặt phòng / phân công lưu trú.
 */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOrderUpdateEmailHtml({
  customerName,
  orderLabel,
  introLine,
  changes = [],
  absoluteLink,
}) {
  const name = escapeHtml(customerName || "Quý khách");
  const label = escapeHtml(orderLabel || "đơn hàng");
  const intro = escapeHtml(
    introLine || "Đơn hàng của bạn đã được cập nhật bởi nhân viên quản trị."
  );

  const changesHtml =
    changes.length > 0
      ? `<ul style="margin:12px 0;padding-left:20px;">${changes
          .map((c) => {
            const hasFrom = c.from != null && c.from !== "" && c.from !== "—";
            const hasTo   = c.to   != null && c.to   !== "" && c.to   !== "—";
            const valueHtml = hasFrom
              ? `${escapeHtml(c.from)} → ${escapeHtml(c.to || "—")}`
              : escapeHtml(c.to || "—");
            return `<li><strong>${escapeHtml(c.label)}:</strong> ${valueHtml}</li>`;
          })
          .join("")}</ul>`
      : "";

  const btnHref = escapeHtml(absoluteLink || "/account/profile");
  const btnBlock = absoluteLink
    ? `<p style="margin:24px 0;">
        <a href="${btnHref}" style="display:inline-block;padding:12px 24px;background:#2f54eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Xem đơn hàng
        </a>
      </p>`
    : "";

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:560px;">
      <p>Chào ${name},</p>
      <p>${intro}</p>
      <p><strong>${label}</strong></p>
      ${changesHtml}
      ${btnBlock}
      <p style="color:#888;font-size:12px;margin-top:24px;">
        Đây là email tự động, vui lòng không trả lời trực tiếp email này.
      </p>
    </div>`;
}

module.exports = { buildOrderUpdateEmailHtml, escapeHtml };
