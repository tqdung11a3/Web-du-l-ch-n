// controllers/client/news.controller.js
const News = require("../../models/news.model");
const moment = require("moment");

/**
 * GET: Danh sách tin tức
 */
module.exports.list = async (req, res) => {
  try {
    const filter = {
      deleted: { $ne: true },
      status: "active",
    };

    // Search
    if (req.query.keyword) {
      const regex = new RegExp(req.query.keyword, "i");
      filter.$or = [{ title: regex }, { shortDescription: regex }, { content: regex }];
    }

    // Phân trang
    const limitItems = 12;
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

    // Format dates
    newsList.forEach((news) => {
      news.publishedAtFormat = moment(news.publishedAt).format("DD/MM/YYYY");
    });

    res.render("client/pages/news-list", {
      pageTitle: "Tin Tức",
      newsList,
      pagination,
      keyword: req.query.keyword || "",
    });
  } catch (error) {
    console.error("Client - News List Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * GET: Chi tiết tin tức
 */
module.exports.detail = async (req, res) => {
  try {
    const slug = req.params.slug;

    const news = await News.findOne({
      slug: slug,
      deleted: { $ne: true },
      status: "active",
    }).lean();

    if (!news) {
      return res.redirect("/news");
    }

    // Tăng lượt xem
    await News.updateOne({ _id: news._id }, { $inc: { views: 1 } });
    news.views = (news.views || 0) + 1;

    // Format dates
    news.publishedAtFormat = moment(news.publishedAt).format("DD/MM/YYYY");

    // Lấy tin tức liên quan (4 tin mới nhất, không bao gồm tin hiện tại)
    const relatedNews = await News.find({
      deleted: { $ne: true },
      status: "active",
      _id: { $ne: news._id },
    })
      .sort({ publishedAt: -1 })
      .limit(4)
      .select("title slug avatar shortDescription publishedAt")
      .lean();

    relatedNews.forEach((item) => {
      item.publishedAtFormat = moment(item.publishedAt).format("DD/MM/YYYY");
    });

    res.render("client/pages/news-detail", {
      pageTitle: news.title,
      news,
      relatedNews,
    });
  } catch (error) {
    console.error("Client - News Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

