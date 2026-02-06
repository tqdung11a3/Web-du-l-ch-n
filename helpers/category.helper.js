const Category = require("../models/category.model");

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

// getCategoryChild
const getCategoryChild = async (parentId) => {
  const result = [];

  const childList = await Category.find({
    parent: parentId,
    deleted: false,
    status: "active",
  });

  for (const item of childList) {
    result.push({
      id: item.id,
      name: item.name,
    });
    await getCategoryChild(item.id);
  }

  return result;
};
module.exports.getCategoryChild = getCategoryChild;
// End getCategoryChild

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