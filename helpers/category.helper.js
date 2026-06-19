const Category = require("../models/category.model");
const AccountAdmin = require("../models/account-admin.model");

const buildCategoryTree = (categories, parentId = "") => {
  // Tạo một mảng để lưu các danh mục con
  const tree = [];

  // Lặp qua từng danh mục trong mảng
  categories.forEach((item) => {
    // Nếu parent của danh mục hiện tại khớp với parentId
    if (item.parent === parentId) {
      // Đệ quy tìm các danh mục con của danh mục hiện tại
      const children = buildCategoryTree(categories, item.id);

      // Thêm danh mục hiện tại vào cây cùng với danh mục con
      tree.push({
        id: item.id,
        name: item.name,
        slug: item.slug,
        children: children, // Gắn mảng children (có thể rỗng)
      });
    }
  });

  // Trả về cây danh mục
  return tree;
};

// Xuất hàm qua module.exports
module.exports.buildCategoryTree = buildCategoryTree;

// End buildCategoryTree

// getCategoryChild — tất cả danh mục con (đệ quy, active)
const getCategoryChild = async (parentId) => {
  const result = [];
  const parentKey = String(parentId || "");
  if (!parentKey) return result;

  const childList = await Category.find({
    parent: parentKey,
    deleted: false,
    status: "active",
  }).lean();

  for (const item of childList) {
    const id = String(item._id || item.id);
    result.push({ id, name: item.name });
    const nested = await getCategoryChild(id);
    result.push(...nested);
  }

  return result;
};
module.exports.getCategoryChild = getCategoryChild;
// End getCategoryChild

/** ID tất cả tổ tiên (cha, ông, …) của một danh mục — không gồm chính nó. */
const getCategoryAncestorIds = async (categoryId) => {
  const result = [];
  let currentId = String(categoryId || "");
  if (!currentId) return result;

  for (let depth = 0; depth < 20; depth++) {
    const cat = await Category.findOne({
      _id: currentId,
      deleted: false,
    })
      .select("parent")
      .lean();
    if (!cat || !cat.parent) break;
    const parentId = String(cat.parent);
    result.push(parentId);
    currentId = parentId;
  }

  return result;
};
module.exports.getCategoryAncestorIds = getCategoryAncestorIds;

/** ID tất cả hậu duệ (con, cháu, …) — không gồm chính nó. */
const getCategoryDescendantIds = async (categoryId) => {
  const children = await getCategoryChild(categoryId);
  return children.map((c) => c.id);
};
module.exports.getCategoryDescendantIds = getCategoryDescendantIds;

/**
 * Các category ID mà tour phải gán (trực tiếp) để hiển thị trên trang danh mục `pageCategoryId`.
 * Gồm: chính trang + tổ tiên (gán cha → hiện ở con) + hậu duệ (gán con → hiện ở cha).
 */
const getCategoryIdsMatchingTourOnPage = async (pageCategoryId) => {
  const pageId = String(pageCategoryId || "");
  if (!pageId) return [];
  const ancestors = await getCategoryAncestorIds(pageId);
  const descendants = await getCategoryDescendantIds(pageId);
  return [...new Set([pageId, ...ancestors, ...descendants])];
};
module.exports.getCategoryIdsMatchingTourOnPage =
  getCategoryIdsMatchingTourOnPage;

/**
 * Điều kiện MongoDB: tour khớp khi ít nhất một danh mục đã gán nằm trong `matchCategoryIds`.
 * Hỗ trợ đơn cũ chỉ có field `category`.
 */
function buildTourCategoryMatchFilter(matchCategoryIds) {
  const ids = [...new Set((matchCategoryIds || []).map(String).filter(Boolean))];
  if (!ids.length) return null;
  return {
    $or: [
      { categories: { $in: ids } },
      {
        category: { $in: ids },
        $or: [
          { categories: { $exists: false } },
          { categories: null },
          { categories: { $size: 0 } },
        ],
      },
    ],
  };
}
module.exports.buildTourCategoryMatchFilter = buildTourCategoryMatchFilter;

/** Chuẩn hóa danh sách category từ document tour. */
function getTourAssignedCategoryIds(tour) {
  if (!tour) return [];
  const fromArr = Array.isArray(tour.categories) ? tour.categories : [];
  const ids = fromArr.map(String).filter(Boolean);
  if (ids.length) return [...new Set(ids)];
  if (tour.category) return [String(tour.category)];
  return [];
}
module.exports.getTourAssignedCategoryIds = getTourAssignedCategoryIds;

/**
 * Parse & dedupe category IDs từ body form (categories[] + category legacy).
 */
function parseTourCategoriesFromBody(body) {
  const raw = body || {};
  let ids = [];
  if (Array.isArray(raw.categories)) {
    ids = raw.categories.map((x) => String(x || "").trim()).filter(Boolean);
  } else if (raw.categories) {
    ids = [String(raw.categories).trim()].filter(Boolean);
  }
  const legacy = String(raw.category || "").trim();
  if (legacy && !ids.includes(legacy)) {
    ids.unshift(legacy);
  }
  return [...new Set(ids)];
}
module.exports.parseTourCategoriesFromBody = parseTourCategoriesFromBody;

function applyTourCategoryFields(body, categoryIds) {
  const ids = [...new Set((categoryIds || []).map(String).filter(Boolean))];
  body.categories = ids;
  body.category = ids[0] || "";
  return body;
}
module.exports.applyTourCategoryFields = applyTourCategoryFields;

/** Filter MongoDB cho trang client của một danh mục (cascade cha ↔ con). */
async function buildTourCategoryPageFilter(pageCategoryId) {
  const matchIds = await getCategoryIdsMatchingTourOnPage(pageCategoryId);
  return buildTourCategoryMatchFilter(matchIds);
}
module.exports.buildTourCategoryPageFilter = buildTourCategoryPageFilter;

// getCategoryParent
const getCategoryParent = async (parentId) => {
  const result = [];

  const categoryParent = await Category.findOne({
    _id: parentId,
    deleted: false,
  });

  if (categoryParent) {
    result.unshift({
      id: categoryParent.id,
      name: categoryParent.name,
      avatar: categoryParent.avatar,
      slug: categoryParent.slug,
    });
    if (categoryParent.parent) {
      const resultParent = await getCategoryParent(categoryParent.parent);
      if (resultParent.length > 0) {
        result.unshift(resultParent[0]);
      }
    }
  }

  return result;
};
module.exports.getCategoryParent = getCategoryParent;
// End getCategoryParent

// list - Tạo cấu trúc cây danh mục cho dropdown
const list = (categories, parentId = "") => {
  const result = [];

  categories.forEach((item) => {
    // So sánh parent_id (hoặc parent) với parentId
    const itemParentId = item.parent_id || item.parent || "";
    
    if (itemParentId == parentId) {
      const newItem = {
        id: item._id || item.id,
        name: item.name,
        slug: item.slug,
        children: list(categories, item._id || item.id),
      };
      result.push(newItem);
    }
  });

  return result;
};
module.exports.list = list;
// End list

/**
 * Danh mục cho form tạo/sửa tour (company admin): trạng thái active, do tài khoản super admin tạo
 * (cùng nguồn với /admin/super-admin/category).
 * @param {{ includeCategoryId?: string, includeCategoryIds?: string[] }} options
 */
const getCategoriesForCompanyTourSelect = async (options = {}) => {
  const includeSet = new Set();
  const rawInc = options.includeCategoryId;
  if (rawInc) {
    includeSet.add(
      String(
        typeof rawInc === "object" && rawInc !== null && rawInc._id
          ? rawInc._id
          : rawInc
      )
    );
  }
  if (Array.isArray(options.includeCategoryIds)) {
    options.includeCategoryIds.forEach((id) => {
      if (id) includeSet.add(String(id));
    });
  }

  const superAdmins = await AccountAdmin.find({
    isSuperAdmin: true,
    deleted: { $ne: true },
  })
    .select("_id")
    .lean();

  const createdByIn = superAdmins.map((a) => String(a._id));
  if (!createdByIn.length) {
    return [];
  }

  const filter = {
    deleted: { $ne: true },
    status: "active",
    createdBy: { $in: createdByIn },
  };

  let categoryList = await Category.find(filter);

  for (const includeCategoryId of includeSet) {
    if (!includeCategoryId) continue;
    const has = categoryList.some((c) => String(c._id) === includeCategoryId);
    if (!has) {
      const extra = await Category.findOne({
        _id: includeCategoryId,
        deleted: { $ne: true },
      });
      if (extra) {
        categoryList = [...categoryList, extra];
      }
    }
  }

  return categoryList;
};
module.exports.getCategoriesForCompanyTourSelect =
  getCategoriesForCompanyTourSelect;