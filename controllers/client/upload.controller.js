module.exports.imagesPost = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.json({ success: false, message: "Không có file nào được upload" });
    }

    const urls = req.files.map((f) => f.path);

    return res.json({ success: true, urls });
  } catch (err) {
    console.error("upload.imagesPost error:", err);
    return res.json({ success: false, message: "Lỗi upload" });
  }
};
