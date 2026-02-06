// models/amadeus-activity.model.js
const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    amadeusId: { type: String, unique: true, index: true }, // id từ Amadeus
    name: String,
    shortDescription: String,
    latitude: Number,
    longitude: Number,
    cityName: String, // để map với City.name của bạn
    rating: Number,
    priceAmount: Number,
    priceCurrency: String,
    pictureUrl: String,
    bookingLink: String,
    lastSyncedAt: Date,
  },
  {
    timestamps: true,
  }
);

const AmadeusActivity = mongoose.model(
  "AmadeusActivity",
  schema,
  "amadeus_activities" // tên collection trong Mongo
);

module.exports = AmadeusActivity;
