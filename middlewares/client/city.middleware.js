const City = require("../../models/city.model");

module.exports.list = async (req, res, next) => {
  const cityList = await City.find({}).sort({
    name: "asc",
  });

  res.locals.cityList = cityList;

  next();
};
