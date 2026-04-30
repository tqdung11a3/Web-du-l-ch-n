/**
 * Chuyển metadata audit log thành các dòng { label, value } tiếng Việt
 * để hiển thị thay cho JSON thô trên UI.
 */

const KEY_LABELS_VI = {
  reason: "Lý do",
  prevStatus: "Trạng thái trước",
  note: "Ghi chú",
  responseNote: "Nội dung phản hồi",
  email: "Email",
  companyId: "ID công ty",
  name: "Tên",
  status: "Trạng thái",
  fields: "Các trường cập nhật",
  groupSize: "Số bản ghi trong nhóm",
  requestedRooms: "Số dòng yêu cầu phòng",
  phone: "Điện thoại",
  count: "Số lượng",
  target: "Phạm vi gửi",
  title: "Tiêu đề",
};

const LINK_REQ_STATUS_VI = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  partially_approved: "Duyệt một phần",
  rejected: "Từ chối",
  cancelled: "Đã huỷ",
};

function formatPrimitive(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (typeof v === "number" && !Number.isNaN(v)) return String(v);
  if (typeof v === "string") return v.trim() || "—";
  return String(v);
}

function formatMetadataValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim() || "—";
  if (value instanceof Date) {
    try {
      return value.toISOString ? value.toISOString() : String(value);
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) {
    if (key === "fields" || value.every((x) => x == null || typeof x !== "object")) {
      const parts = value.map((x) => formatPrimitive(x)).filter((s) => s !== "—");
      return parts.length ? parts.join(", ") : "—";
    }
    return value
      .map((x) =>
        typeof x === "object" && x !== null ? JSON.stringify(x) : formatPrimitive(x)
      )
      .join("; ");
  }
  if (typeof value === "object") {
    try {
      const entries = Object.entries(value);
      if (!entries.length) return "—";
      if (entries.length <= 6) {
        return entries
          .map(([k, v]) => `${k}: ${formatPrimitive(v)}`)
          .join("; ");
      }
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  return String(value);
}

function labelForKey(key) {
  return KEY_LABELS_VI[key] || key.replace(/_/g, " ");
}

/**
 * @param {string} action
 * @param {Record<string, unknown>|null|undefined} metadata
 * @returns {{ label: string, value: string }[]}
 */
function metadataToHumanLines(action, metadata) {
  if (!metadata || typeof metadata !== "object") return [];
  const keys = Object.keys(metadata);
  if (!keys.length) return [];

  const lines = [];

  if (action === "review.hide") {
    const r = String(metadata.reason ?? "").trim();
    lines.push({
      label: "Lý do ẩn",
      value: r || "(không ghi)",
    });
    return lines;
  }

  if (action === "review.unhide") {
    const r = String(metadata.reason ?? "").trim();
    lines.push({
      label: "Ghi chú",
      value:
        r ||
        "Bỏ ẩn đánh giá — không có lý do kèm theo trong nhật ký (thao tác bỏ ẩn thường không bắt buộc nhập lý do).",
    });
    return lines;
  }

  if (action === "hotel-link-request.force-cancel") {
    const prev = metadata.prevStatus;
    const reason = String(metadata.reason ?? "").trim();
    lines.push({
      label: "Trạng thái yêu cầu trước khi huỷ",
      value:
        typeof prev === "string" && LINK_REQ_STATUS_VI[prev]
          ? `${LINK_REQ_STATUS_VI[prev]} (${prev})`
          : formatPrimitive(prev),
    });
    lines.push({
      label: "Lý do huỷ cưỡng chế",
      value: reason || "—",
    });
    return lines;
  }

  if (action === "setting.website-info.update" && Array.isArray(metadata.fields)) {
    lines.push({
      label: "Các trường form đã gửi",
      value: metadata.fields.length
        ? metadata.fields.join(", ")
        : "(danh sách rỗng)",
    });
    return lines;
  }

  if (action === "notification.broadcast") {
    if (metadata.count != null) {
      lines.push({
        label: "Số thông báo đã tạo",
        value: String(metadata.count),
      });
    }
    if (metadata.target != null && String(metadata.target).trim()) {
      const t = String(metadata.target);
      const map = { all: "Tất cả công ty", selected: "Công ty được chọn" };
      lines.push({
        label: "Phạm vi",
        value: map[t] || t,
      });
    }
    if (metadata.title != null && String(metadata.title).trim()) {
      lines.push({
        label: "Tiêu đề",
        value: String(metadata.title).trim(),
      });
    }
    if (lines.length) return lines;
  }

  for (const k of keys) {
    const v = metadata[k];
    if (v === undefined) continue;
    lines.push({
      label: labelForKey(k),
      value: formatMetadataValue(k, v),
    });
  }

  return lines;
}

module.exports = {
  metadataToHumanLines,
};
