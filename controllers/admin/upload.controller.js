module.exports.imagePost = async (req, res) => {
  res.json({
    location: req.file && req.file.path ? req.file.path : "",
  });
};
