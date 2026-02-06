const mongoose = require("mongoose");
const Review = require("../../models/review.model");

async function attachRatings(tours) {
  if (!Array.isArray(tours) || tours.length === 0) return tours;
  const ids = tours
    .map((t) => t._id || t.id)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const stats = await Review.aggregate([
    { $match: { deleted: false, tourId: { $in: ids } } },
    {
      $group: { _id: "$tourId", count: { $sum: 1 }, avg: { $avg: "$rating" } },
    },
  ]);

  const map = Object.fromEntries(
    stats.map((s) => [String(s._id), { count: s.count, avg: s.avg }])
  );

  return tours.map((t) => {
    const k = String(t._id || t.id);
    const st = map[k];
    return {
      ...t,
      ratingAvg: st ? st.avg : 0,
      ratingCount: st ? st.count : 0,
    };
  });
}

module.exports = { attachRatings };
