const Category = require("../../../models/category.model");
const AccountAdmin = require("../../../models/account-admin.model");
const categoryHelper = require("../../../helpers/category.helper");
const moment = require("moment");
const slugify = require("slugify");

module.exports.list = async (req, res) => {
  const find = {
    deleted: false,
  };

  // Lọc theo Trạng thái
  if (req.query.status) {
    find.status = req.query.status;
  }
  // Hết Lọc theo Trạng thái

  // Lọc theo Người tạo
  if (req.query.createdBy) {
    find.createdBy = req.query.createdBy;
  }
  // Hết Lọc theo Người tạo

  // Lọc theo Ngày tạo
  const filterDate = {};
  if (req.query.startDate) {
    const startDate = moment(req.query.startDate).toDate();
    filterDate.$gte = startDate;
    find.createdAt = filterDate;
  }
  if (req.query.endDate) {
    const endDate = moment(req.query.endDate).toDate();
    filterDate.$lte = endDate;
    find.createdAt = filterDate;
  }
  // Hết Lọc theo Ngày tạo

  // Tìm kiếm
  if (req.query.keyword) {
    const keyword = slugify(req.query.keyword);
    const keywordRegex = new RegExp(keyword, "i");
    find.slug = keywordRegex;
  }
  // Hết Tìm kiếm

  // Phân trang
  const limitItems = 4;
  let page = 1;
  if (req.query.page && parseInt(req.query.page) > 0) {
    page = parseInt(req.query.page);
  }
  const skip = (page - 1) * limitItems;
  const totalRecord = await Category.countDocuments(find);
  const totalPage = Math.ceil(totalRecord / limitItems);
  const pagination = {
    skip: skip,
    totalRecord: totalRecord,
    totalPage: totalPage,
  };
  // Hết Phân trang

  const categoryList = await Category.find(find)
    .sort({
      position: "asc",
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

    if (item.updatedBy) {
      const infoAccount = await AccountAdmin.findOne({
        _id: item.updatedBy,
      });
      if (infoAccount) {
        item.updatedByFullName = infoAccount.fullName;
      }
    }

    item.createdAtFormat = moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
    item.updatedAtFormat = moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
  }

  // Danh sách tài khoản admin
  const accountAdminList = await AccountAdmin.find({});
  // Hết Danh sách tài khoản admin

  res.render("admin/pages/super-admin/category-list", {
    pageTitle: "Quản lý danh mục",
    categoryList: categoryList,
    accountAdminList: accountAdminList,
    pagination: pagination,
  });
};

module.exports.create = async (req, res) => {
  const categoryList = await Category.find({});

  const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");

  res.render("admin/pages/super-admin/category-create", {
    pageTitle: "Tạo danh mục",
    categoryList: categoryTree,
  });
};

module.exports.createPost = async (req, res) => {
  if (req.body.position) {
    req.body.position = parseInt(req.body.position);
  } else {
    const totalRecord = await Category.countDocuments({});
    req.body.position = totalRecord + 1;
  }

  req.body.createdBy = req.account.id;
  req.body.updatedBy = req.account.id;
  req.body.avatar = req.file ? req.file.path : "";

  const newRecord = new Category(req.body);
  await newRecord.save();

  res.json({
    code: "success",
    message: "Tạo danh mục thành công!",
  });
};

module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;

    const categoryDetail = await Category.findOne({
      _id: id,
      deleted: false,
    });

    if (!categoryDetail) {
      res.redirect(`/${pathAdmin}/super-admin/category/list`);
      return;
    }

    const categoryList = await Category.find({});

    const categoryTree = categoryHelper.buildCategoryTree(categoryList, "");

    res.render("admin/pages/super-admin/category-edit", {
      pageTitle: "Chỉnh sửa danh mục",
      categoryList: categoryTree,
      categoryDetail: categoryDetail,
    });
  } catch (error) {
    res.redirect(`/${pathAdmin}/super-admin/category/list`);
  }
};

module.exports.editPatch = async (req, res) => {
  try {
    const id = req.params.id;

    if (req.body.position) {
      req.body.position = parseInt(req.body.position);
    } else {
      const totalRecord = await Category.countDocuments({});
      req.body.position = totalRecord + 1;
    }

    req.body.updatedBy = req.account.id;
    if (req.file) {
      req.body.avatar = req.file.path;
    } else {
      delete req.body.avatar;
    }

    await Category.updateOne(
      {
        _id: id,
        deleted: false,
      },
      req.body
    );

    res.json({
      code: "success",
      message: "Cập nhật thành công!",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.deletePatch = async (req, res) => {
  try {
    const id = req.params.id;

    await Category.updateOne(
      {
        _id: id,
      },
      {
        deleted: true,
        deletedAt: Date.now(),
        deletedBy: req.account.id,
      }
    );

    res.json({
      code: "success",
      message: "Xóa danh mục thành công!",
    });
  } catch (error) {
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

module.exports.changeMultiPatch = async (req, res) => {
  try {
    const { value, ids } = req.body;

    switch (value) {
      case "active":
      case "inactive":
        await Category.updateMany(
          {
            _id: { $in: ids },
          },
          {
            status: value,
          }
        );
        res.json({
          code: "success",
          message: "Đổi trạng thái thành công!",
        });
        break;
      case "delete":
        await Category.updateMany(
          {
            _id: { $in: ids },
          },
          {
            deleted: true,
            deletedAt: Date.now(),
            deletedBy: req.account.id,
          }
        );
        res.json({
          code: "success",
          message: "Đã xóa thành công!",
        });
        break;
      default:
        res.json({
          code: "error",
          message: "Dữ liệu không hợp lệ!",
        });
        break;
    }
  } catch (error) {
    res.json({
      code: "error",
      message: "Dữ liệu không hợp lệ!",
    });
  }
};

// Chi tiết danh mục
module.exports.detail = async (req, res) => {
  try {
    const category = await Category.findOne({
      _id: req.params.id,
      deleted: false,
    }).lean();

    if (!category) {
      return res.redirect(`/${pathAdmin}/super-admin/category`);
    }

    // Lấy thông tin người tạo
    if (category.createdBy) {
      const admin = await AccountAdmin.findById(category.createdBy).lean();
      if (admin) {
        category.createdByName = admin.fullName;
      }
    }

    // Lấy thông tin người cập nhật
    if (category.updatedBy) {
      const admin = await AccountAdmin.findById(category.updatedBy).lean();
      if (admin) {
        category.updatedByName = admin.fullName;
      }
    }

    category.createdAtFormat = moment(category.createdAt).format("DD/MM/YYYY HH:mm");
    category.updatedAtFormat = moment(category.updatedAt).format("DD/MM/YYYY HH:mm");

    res.render("admin/pages/super-admin/category-detail", {
      pageTitle: `Danh mục: ${category.name}`,
      category,
    });
  } catch (error) {
    console.error("Super Admin - Category Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

// Thay đổi trạng thái
module.exports.changeStatus = async (req, res) => {
  try {
    const { id, status } = req.body;

    await Category.updateOne(
      { _id: id, deleted: false },
      { status, updatedBy: req.account.id }
    );

    res.json({
      code: "success",
      message: "Đổi trạng thái thành công!",
    });
  } catch (error) {
    console.error("Change Category Status Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

// Thay đổi vị trí
module.exports.changePosition = async (req, res) => {
  try {
    const { id, position } = req.body;

    await Category.updateOne(
      { _id: id, deleted: false },
      { position: parseInt(position), updatedBy: req.account.id }
    );

    res.json({
      code: "success",
      message: "Đổi vị trí thành công!",
    });
  } catch (error) {
    console.error("Change Category Position Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

// Xóa danh mục (soft delete)
module.exports.deleteItem = async (req, res) => {
  try {
    await Category.updateOne(
      { _id: req.params.id, deleted: false },
      {
        deleted: true,
        deletedBy: req.account.id,
        deletedAt: new Date(),
      }
    );

    res.json({
      code: "success",
      message: "Xóa danh mục thành công!",
    });
  } catch (error) {
    console.error("Delete Category Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};