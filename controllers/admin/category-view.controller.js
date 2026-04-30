// controllers/admin/category-view.controller.js
const Category = require("../../models/category.model");
const AccountAdmin = require("../../models/account-admin.model");
const categoryHelper = require("../../helpers/category.helper");
const moment = require("moment");
const slugify = require("slugify");

/**
 * GET: Xem danh sách danh mục (Company Admin - Read Only)
 */
module.exports.view = async (req, res) => {
  const keyword =
    typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
  const statusFilter =
    typeof req.query.status === "string" ? req.query.status.trim() : "";

  const find = {
    deleted: false,
  };

  // Lọc theo Trạng thái
  if (statusFilter) {
    find.status = statusFilter;
  }

  // Tìm kiếm
  if (keyword) {
    const keywordSlug = slugify(keyword);
    const keywordRegex = new RegExp(keywordSlug, "i");
    find.slug = keywordRegex;
  }

  // Phân trang
  const limitItems = 10;
  let page = 1;
  if (req.query.page && parseInt(req.query.page) > 0) {
    page = parseInt(req.query.page);
  }
  const skip = (page - 1) * limitItems;
  const totalRecord = await Category.countDocuments(find);
  const totalPage = Math.ceil(totalRecord / limitItems);
  const pagination = {
    currentPage: page,
    skip: skip,
    totalRecord: totalRecord,
    totalPage: totalPage,
  };

  const categoryList = await Category.find(find)
    .sort({
      position: "desc",
    })
    .limit(limitItems)
    .skip(skip);

  for (const item of categoryList) {
    if (item.createdBy) {
      const infoAccount = await AccountAdmin.findOne({
        _id: item.createdBy,
      });
      if (infoAccount) {
        item.createdByFullName = infoAccount.fullName;
      }
    }

    item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
  }

  res.render("admin/pages/category-view", {
    pageTitle: "Xem danh mục",
    categoryList: categoryList,
    pagination: pagination,
    keyword,
    statusFilter,
  });
};

/**
 * GET: Chi tiết danh mục (Read Only)
 */
module.exports.detail = async (req, res) => {
  const id = req.params.id;

  const category = await Category.findOne({
    _id: id,
    deleted: false,
  });

  if (!category) {
    return res.redirect(`/${req.app.locals.pathAdmin}/category/view`);
  }

  // Lấy thông tin danh mục cha nếu có
  if (category.parent) {
    const parentCategory = await Category.findOne({
      _id: category.parent,
      deleted: false,
    });
    if (parentCategory) {
      category.parentName = parentCategory.name;
    }
  }

  if (category.createdBy) {
    const infoAccount = await AccountAdmin.findOne({
      _id: category.createdBy,
    });
    if (infoAccount) {
      category.createdByFullName = infoAccount.fullName;
    }
  }

  category.createdAtFormat = moment(category.createdAt).format(
    "HH:mm - DD/MM/YYYY"
  );

  res.render("admin/pages/category-view-detail", {
    pageTitle: "Chi tiết danh mục",
    category: category,
  });
};

