function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameContainsTokens(q) {
  const raw = String(q || "").trim();
  if (!raw) return null;

  // tách theo dấu gạch ngang và khoảng trắng
  const tokens = raw
    .split(/\s*-\s*|\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tokens.length) return null;

  // $and: tên phải chứa lần lượt mọi token (không phân biệt hoa thường)
  return {
    $and: tokens.map((t) => ({
      name: { $regex: escapeRegex(t), $options: "i" },
    })),
  };
}
