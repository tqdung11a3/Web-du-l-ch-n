const Category = require("../../models/category.model");
const categoryHelper = require("../../helpers/category.helper");

module.exports.list = async (req, res, next) => {
  const categoryList = await Category.find({
    deleted: false,
    status: "active",
  });

  const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");

  // Ẩn "Tour Nước Ngoài" khỏi menu header
  const normalizedHide = "tour nước ngoài";
  res.locals.categoryList = categoryTree.filter(
    (item) => (item.name || "").toLowerCase().trim() !== normalizedHide
  );

  next();
};
