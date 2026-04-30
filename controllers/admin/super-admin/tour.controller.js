// controllers/admin/super-admin/tour.controller.js
const mongoose = require("mongoose");
const moment = require("moment");
const Tour = require("../../../models/tour.model");
const Company = require("../../../models/company.model");
const Category = require("../../../models/category.model");
const City = require("../../../models/city.model");
const Country = require("../../../models/country.model");
const categoryHelper = require("../../../helpers/category.helper");

/**
 * Bước 1: Danh sách công ty (vào từ /super-admin/tours)
 */
module.exports.companyList = async (req, res) => {
  try {
    const find = { deleted: { $ne: true } };
    if (req.query.keyword) {
      find.name = new RegExp(req.query.keyword.trim(), "i");
    }
    if (req.query.status) {
      find.status = req.query.status;
    }

    const companies = await Company.find(find)
      .select("name logo status email hotline")
      .sort({ name: 1 })
      .lean();

    const tourCounts = await Tour.aggregate([
      { $match: { deleted: { $ne: true } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(
      tourCounts.map((r) => [String(r._id), r.count || 0])
    );

    for (const c of companies) {
      c.tourCount = countMap.get(String(c._id)) || 0;
    }

    res.render("admin/pages/super-admin/tour-companies", {
      pageTitle: "Tours theo công ty",
      companies,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
    });
  } catch (error) {
    console.error("Super Admin - Tour Companies Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Bước 2: Danh sách tour của một công ty
 */
module.exports.listByCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/tours`);
    }

    const company = await Company.findOne({
      _id: companyId,
      deleted: { $ne: true },
    })
      .select("name logo status")
      .lean();

    if (!company) {
      return res.redirect(`/${req.app.locals.pathAdmin}/super-admin/tours`);
    }

    const filter = {
      deleted: { $ne: true },
      companyId: new mongoose.Types.ObjectId(companyId),
    };

    if (req.query.keyword) {
      filter.name = new RegExp(req.query.keyword, "i");
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const limitItems = 10;
    let page = 1;
    if (req.query.page && parseInt(req.query.page, 10) > 0) {
      page = parseInt(req.query.page, 10);
    }
    const skip = (page - 1) * limitItems;
    const totalRecord = await Tour.countDocuments(filter);
    const totalPage = Math.ceil(totalRecord / limitItems) || 1;
    const pagination = {
      currentPage: page,
      skip,
      totalRecord,
      totalPage,
    };

    let tours = await Tour.find(filter).populate("companyId", "name logo").lean();

    tours.sort((a, b) => {
      const priceA = a.priceNewAdult || a.priceAdult || 0;
      const priceB = b.priceNewAdult || b.priceAdult || 0;
      return priceB - priceA;
    });

    tours = tours.slice(skip, skip + limitItems);

    res.render("admin/pages/super-admin/tour-list", {
      pageTitle: `Tour — ${company.name}`,
      tours,
      companies: [],
      companyContext: company,
      pagination,
      keyword: req.query.keyword || "",
      statusFilter: req.query.status || "",
      companyFilter: "",
    });
  } catch (error) {
    console.error("Super Admin - Tour List By Company Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};

/**
 * Xem chi tiết tour (read-only, dùng lại cấu trúc giao diện của /admin/tour/edit)
 */
module.exports.detail = async (req, res) => {
  try {
    const pathAdmin = req.app.locals.pathAdmin || global.pathAdmin;
    const id = req.params.id;

    const tourDoc = await Tour.findOne({
      _id: id,
      deleted: { $ne: true },
    }).populate("companyId", "name logo hotline email");

    if (!tourDoc) {
      return res.redirect(`/${pathAdmin}/super-admin/tours`);
    }

    const tourDetail = tourDoc.toObject();
    tourDetail.id = tourDoc._id.toString();

    // departureCity -> string id
    if (tourDetail.departureCity) {
      tourDetail.departureCity = String(tourDetail.departureCity);
    }

    // locationBlocks cho form
    const locs = Array.isArray(tourDetail.locations) ? tourDetail.locations : [];
    tourDetail.locationBlocks = locs.map((loc) => {
      if (
        !loc ||
        typeof loc === "string" ||
        mongoose.Types.ObjectId.isValid(String(loc))
      ) {
        return { city: String(loc), spots: [] };
      }
      const cityId = loc.city ? String(loc.city) : "";
      let spots = [];
      if (Array.isArray(loc.spots)) spots = loc.spots;
      else if (typeof loc.spots === "string" && loc.spots.trim()) {
        spots = loc.spots
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return { city: cityId, spots };
    });

    if (tourDetail.departureDate) {
      tourDetail.departureDateFormat = moment(tourDetail.departureDate).format(
        "YYYY-MM-DD"
      );
    }

    // departuresBlocks
    const departuresArr =
      Array.isArray(tourDetail.departures) && tourDetail.departures.length > 0
        ? tourDetail.departures
        : tourDetail.departureDate
        ? [{ departureDate: tourDetail.departureDate, endDate: null }]
        : [];
    tourDetail.departuresBlocks = departuresArr.map((d) => ({
      departureDateFormat: d.departureDate
        ? moment(d.departureDate).format("YYYY-MM-DD")
        : "",
      endDateFormat: d.endDate ? moment(d.endDate).format("YYYY-MM-DD") : "",
      seatsTotal: d.seatsTotal != null ? d.seatsTotal : 0,
      seatsRemaining: d.seatsRemaining != null ? d.seatsRemaining : 0,
    }));

    // Khuyến mãi
    tourDetail.discountFromInput = tourDetail.discountFrom
      ? moment(tourDetail.discountFrom).format("YYYY-MM-DD")
      : "";
    tourDetail.discountToInput = tourDetail.discountTo
      ? moment(tourDetail.discountTo).format("YYYY-MM-DD")
      : "";

    // Quy tắc bậc em bé -> JSON
    tourDetail.babyPricingRulesJson = JSON.stringify(
      tourDetail.babyPricingRules || []
    );

    // Category list (dùng tất cả category active, kể cả của super admin hoặc company,
    // để hiển thị đúng lựa chọn hiện tại — view read-only nên không ảnh hưởng)
    const allCategories = await Category.find({
      deleted: { $ne: true },
    })
      .select("_id title name parent slug status")
      .sort({ position: 1, name: 1 })
      .lean();

    const categoryListFlat = allCategories.map((c) => ({
      id: String(c._id),
      _id: String(c._id),
      title: c.title || c.name || "",
      name: c.name || c.title || "",
      parent: c.parent ? String(c.parent) : "",
      slug: c.slug || "",
      status: c.status || "active",
    }));
    const categoryTree = categoryHelper.buildCategoryTree(
      categoryListFlat,
      ""
    );

    // cityList (Việt Nam)
    const vietnamCities = await City.find({
      $or: [
        { countryId: null },
        { countryName: { $exists: false } },
        { countryName: "" },
      ],
      deleted: { $ne: true },
    })
      .sort({ name: 1 })
      .lean();

    // europeanCountries
    const europeanCountriesRaw = await Country.find({
      continent: "Europe",
      deleted: { $ne: true },
      status: "active",
    })
      .sort({ name: 1 })
      .lean();
    const europeanCountries = europeanCountriesRaw.map((country) => ({
      _id: String(country._id),
      id: String(country._id),
      name: country.name || "",
      nameEn: country.nameEn || "",
      code: country.code || "",
    }));

    // europeanCities
    const europeanCitiesRaw = await City.find({
      countryId: { $exists: true, $ne: null },
      deleted: { $ne: true },
    })
      .populate("countryId", "name code")
      .sort({ countryName: 1, name: 1 })
      .lean();
    const europeanCities = europeanCitiesRaw.map((city) => {
      let countryIdStr = null;
      if (city.countryId) {
        if (typeof city.countryId === "object" && city.countryId._id) {
          countryIdStr = String(city.countryId._id);
        } else {
          countryIdStr = String(city.countryId);
        }
      }
      return {
        _id: String(city._id),
        id: String(city._id),
        name: city.name || "",
        nameEn: city.nameEn || "",
        countryId: countryIdStr,
        countryName: city.countryName || "",
      };
    });

    // Xác định tour trong nước / nước ngoài
    let isInternationalTour = false;
    if (tourDetail.category) {
      const category = await Category.findById(tourDetail.category);
      if (category && category.parent) {
        const parentCategory = await Category.findById(category.parent);
        if (parentCategory) {
          const parentName = (parentCategory.name || "").toLowerCase();
          const parentSlug = (parentCategory.slug || "").toLowerCase();
          isInternationalTour =
            parentName.includes("nước ngoài") ||
            parentSlug.includes("nuoc-ngoai") ||
            parentName.includes("international") ||
            parentSlug.includes("international");
        }
      }
    }

    // Group location theo quốc gia (nước ngoài)
    let tourCountries = [];
    let locationsByCountry = {};
    if (
      isInternationalTour &&
      tourDetail.locationBlocks &&
      tourDetail.locationBlocks.length > 0
    ) {
      const cityIds = tourDetail.locationBlocks
        .map((loc) => loc.city)
        .filter(Boolean);
      if (cityIds.length > 0) {
        const citiesWithCountry = await City.find({
          _id: { $in: cityIds },
          countryId: { $exists: true, $ne: null },
        })
          .populate("countryId")
          .lean();

        const cityToCountry = {};
        citiesWithCountry.forEach((city) => {
          if (city.countryId) {
            const countryId = String(
              city.countryId._id || city.countryId
            );
            cityToCountry[String(city._id)] = countryId;
            if (!tourCountries.includes(countryId)) {
              tourCountries.push(countryId);
            }
          }
        });

        tourDetail.locationBlocks.forEach((loc) => {
          const countryId = cityToCountry[loc.city];
          if (countryId) {
            if (!locationsByCountry[countryId]) {
              locationsByCountry[countryId] = [];
            }
            locationsByCountry[countryId].push(loc);
          }
        });
      }
    }
    tourDetail.tourCountries = tourCountries;
    tourDetail.locationsByCountry = locationsByCountry;

    const toursListBackUrl =
      tourDetail.companyId && tourDetail.companyId._id
        ? `/${pathAdmin}/super-admin/tours/company/${tourDetail.companyId._id}`
        : `/${pathAdmin}/super-admin/tours`;

    // Link "Chỉnh sửa với tư cách công ty này" cho Super Admin
    const overrideCompanyId =
      tourDetail.companyId && tourDetail.companyId._id
        ? String(tourDetail.companyId._id)
        : null;
    const superAdminOverrideEditUrl = overrideCompanyId
      ? `/${pathAdmin}/super-admin/as-company/${overrideCompanyId}/tours/${tourDetail.id}`
      : null;

    return res.render("admin/pages/super-admin/tour-detail", {
      pageTitle: `Tour: ${tourDetail.name}`,
      categoryList: categoryTree,
      tourDetail,
      cityList: vietnamCities,
      europeanCountries,
      europeanCities,
      isInternationalTour,
      pathAdmin,
      toursListBackUrl,
      superAdminOverrideEditUrl,
    });
  } catch (error) {
    console.error("Super Admin - Tour Detail Error:", error);
    res.status(500).send("Có lỗi xảy ra!");
  }
};
