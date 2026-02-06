// amadeusClient.js
const Amadeus = require("amadeus");

const amadeus = new Amadeus({
  clientId: process.env.AMADEUS_CLIENT_ID,
  clientSecret: process.env.AMADEUS_CLIENT_SECRET,
  // mặc định là environment "test" → đủ dùng cho dev
});

module.exports = amadeus;
