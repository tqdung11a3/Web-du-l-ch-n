// models/news.model.js
const mongoose = require("mongoose");
const slug = require("mongoose-slug-updater");
mongoose.plugin(slug);

const newsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      slug: "title",
      unique: true,
    },
    avatar: {
      type: String,
      default: "",
    },
    images: {
      type: [String],
      default: [],
    },
    shortDescription: {
      type: String,
      default: "",
    },
    content: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
    views: {
      type: Number,
      default: 0,
    },
    createdBy: String,
    updatedBy: String,
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    deletedBy: String,
  },
  {
    timestamps: true,
  }
);

const News = mongoose.model("News", newsSchema, "news");

module.exports = News;

