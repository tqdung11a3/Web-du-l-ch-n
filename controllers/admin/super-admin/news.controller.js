// controllers/admin/super-admin/news.controller.js
const News = require("../../../models/news.model");
const AccountAdmin = require("../../../models/account-admin.model");
const moment = require("moment");

/**
 * GET: Danh sách tin tức
 */
module.exports.list = async (req, res) => {
  try {
    const filter = { deleted: { $ne: true } };

    // Search
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.$or = [{ title: regex }, { shortDescription: regex }];
    }

    // Filter by status
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Phân trang
    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page) > 0) {
      page = parseInt(req.query.page);
    }
    const skip = (page - 1) * limitItems;

    const totalRecord = await News.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems);
    const pagination = {
      currentPage: page,
      skip: skip,
      totalRecord: totalRecord,
      totalPage: totalPage,
    };

    const newsList = await News.find(filter)
      .sort({ publishedAt: -1 })
      .limit(limitItems)
      .skip(skip)
      .lean();

    // Lấy thông tin người tạo
    for (const news of newsList) {
      if (news.createdBy) {
        const admin = await AccountAdmin.findById(news.createdBy).lean();
        if (admin) {
          news.createdByName = admin.fullName;
        }
      }
      news.publishedAtFormat = moment(news.publishedAt).format("DD/MM/YYYY");
    }

    res.render("admin/pages/super-admin/news-list", {
      pageTitle: "Quản lý Tin tức",
      newsList,
      pagination,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin - News List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET: Trang tạo tin tức mới
 */
module.exports.create = async (req, res) => {
  res.render("admin/pages/super-admin/news-create", {
    pageTitle: "Tạo tin tức mới",
  });
};

/**
 * POST: Tạo tin tức mới
 */
module.exports.createPost = async (req, res) => {
  try {
    const { title, shortDescription, content, status, isFeatured, publishedAt } = req.body;

    const newsData = {
      title,
      shortDescription: shortDescription || "",
      content: content || "",
      status: status || "active",
      isFeatured: isFeatured === "true" || isFeatured === true,
      publishedAt: publishedAt || Date.now(),
      createdBy: req.account.id,
      updatedBy: req.account.id,
    };

    // Xử lý avatar
    if (req.file) {
      newsData.avatar = req.file.path;
    }

    const newNews = new News(newsData);
    await newNews.save();

    res.json({
      code: "success",
      message: "Tạo tin tức thành công!",
    });
  } catch (error) {
    console.error("Create News Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * GET: Trang chỉnh sửa tin tức
 */
module.exports.edit = async (req, res) => {
  try {
    const news = await News.findOne({
      _id: req.params.id,
      deleted: { $ne: true },
    }).lean();

    if (!news) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/news`);
    }

    // Format date cho input type="date"
    if (news.publishedAt) {
      news.publishedAtFormat = moment(news.publishedAt).format("YYYY-MM-DD");
    }

    res.render("admin/pages/super-admin/news-edit", {
      pageTitle: "Chỉnh sửa tin tức",
      news,
    });
  } catch (error) {
    console.error("Edit News Get Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH: Cập nhật tin tức
 */
module.exports.editPatch = async (req, res) => {
  try {
    const { title, shortDescription, content, status, isFeatured, publishedAt } = req.body;

    const updateData = {
      title,
      shortDescription: shortDescription || "",
      content: content || "",
      status: status || "active",
      isFeatured: isFeatured === "true" || isFeatured === true,
      publishedAt: publishedAt || Date.now(),
      updatedBy: req.account.id,
    };

    // Xử lý avatar nếu có
    if (req.file) {
      updateData.avatar = req.file.path;
    }

    await News.updateOne(
      { _id: req.params.id, deleted: { $ne: true } },
      updateData
    );

    res.json({
      code: "success",
      message: "Cập nhật tin tức thành công!",
    });
  } catch (error) {
    console.error("Edit News Patch Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * GET: Chi tiết tin tức
 */
module.exports.detail = async (req, res) => {
  try {
    const news = await News.findOne({
      _id: req.params.id,
      deleted: { $ne: true },
    }).lean();

    if (!news) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/news`);
    }

    // Lấy thông tin người tạo và cập nhật
    if (news.createdBy) {
      const admin = await AccountAdmin.findById(news.createdBy).lean();
      if (admin) {
        news.createdByName = admin.fullName;
      }
    }
    if (news.updatedBy) {
      const admin = await AccountAdmin.findById(news.updatedBy).lean();
      if (admin) {
        news.updatedByName = admin.fullName;
      }
    }

    news.publishedAtFormat = moment(news.publishedAt).format("DD/MM/YYYY HH:mm");
    news.createdAtFormat = moment(news.createdAt).format("DD/MM/YYYY HH:mm");
    news.updatedAtFormat = moment(news.updatedAt).format("DD/MM/YYYY HH:mm");

    res.render("admin/pages/super-admin/news-detail", {
      pageTitle: `Tin tức: ${news.title}`,
      news,
    });
  } catch (error) {
    console.error("Super Admin - News Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * PATCH: Thay đổi trạng thái
 */
module.exports.changeStatus = async (req, res) => {
  try {
    const { id, status } = req.body;

    await News.updateOne(
      { _id: id, deleted: { $ne: true } },
      { status, updatedBy: req.account.id }
    );

    res.json({
      code: "success",
      message: "Đổi trạng thái thành công!",
    });
  } catch (error) {
    console.error("Change News Status Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

/**
 * DELETE: Xóa tin tức (soft delete)
 */
module.exports.deleteItem = async (req, res) => {
  try {
    await News.updateOne(
      { _id: req.params.id, deleted: { $ne: true } },
      {
        deleted: true,
        deletedBy: req.account.id,
        deletedAt: new Date(),
      }
    );

    res.json({
      code: "success",
      message: "Xóa tin tức thành công!",
    });
  } catch (error) {
    console.error("Delete News Error:", error);
    res.json({
      code: "error",
      message: "Có lỗi xảy ra!",
    });
  }
};

