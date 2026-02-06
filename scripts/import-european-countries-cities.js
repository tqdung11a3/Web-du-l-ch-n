// scripts/import-european-countries-cities.js
require("dotenv").config();
const mongoose = require("mongoose");
const Country = require("../models/country.model");
const City = require("../models/city.model");

// Dữ liệu các quốc gia Châu Âu và thành phố
const europeanData = [
  {
    country: {
      name: "Pháp",
      nameEn: "France",
      code: "FR",
      continent: "Europe",
    },
    cities: [
      "Paris",
      "Lyon",
      "Marseille",
      "Nice",
      "Bordeaux",
      "Strasbourg",
      "Toulouse",
      "Lille",
      "Nantes",
      "Cannes",
      "Avignon",
      "Versailles",
      "Montpellier",
      "Reims",
      "Dijon",
    ],
  },
  {
    country: {
      name: "Đức",
      nameEn: "Germany",
      code: "DE",
      continent: "Europe",
    },
    cities: [
      "Berlin",
      "Munich",
      "Hamburg",
      "Frankfurt",
      "Cologne",
      "Stuttgart",
      "Dresden",
      "Düsseldorf",
      "Nuremberg",
      "Heidelberg",
      "Rothenburg",
      "Bremen",
      "Hannover",
      "Leipzig",
      "Dortmund",
    ],
  },
  {
    country: {
      name: "Ý",
      nameEn: "Italy",
      code: "IT",
      continent: "Europe",
    },
    cities: [
      "Rome",
      "Milan",
      "Venice",
      "Florence",
      "Naples",
      "Turin",
      "Bologna",
      "Pisa",
      "Verona",
      "Genoa",
      "Palermo",
      "Siena",
      "Capri",
      "Amalfi",
      "Cinque Terre",
    ],
  },
  {
    country: {
      name: "Tây Ban Nha",
      nameEn: "Spain",
      code: "ES",
      continent: "Europe",
    },
    cities: [
      "Madrid",
      "Barcelona",
      "Valencia",
      "Seville",
      "Granada",
      "Bilbao",
      "Córdoba",
      "Toledo",
      "Salamanca",
      "Santiago de Compostela",
      "Málaga",
      "Ibiza",
      "Mallorca",
      "Tenerife",
      "San Sebastián",
    ],
  },
  {
    country: {
      name: "Anh",
      nameEn: "United Kingdom",
      code: "GB",
      continent: "Europe",
    },
    cities: [
      "London",
      "Edinburgh",
      "Manchester",
      "Liverpool",
      "Birmingham",
      "Bath",
      "Oxford",
      "Cambridge",
      "York",
      "Brighton",
      "Bristol",
      "Glasgow",
      "Cardiff",
      "Belfast",
      "Canterbury",
    ],
  },
  {
    country: {
      name: "Thụy Sĩ",
      nameEn: "Switzerland",
      code: "CH",
      continent: "Europe",
    },
    cities: [
      "Zurich",
      "Geneva",
      "Bern",
      "Basel",
      "Lausanne",
      "Lucerne",
      "Interlaken",
      "Zermatt",
      "St. Moritz",
      "Montreux",
      "Lugano",
      "Grindelwald",
      "Jungfrau",
      "Matterhorn",
      "Lake Geneva",
    ],
  },
  {
    country: {
      name: "Áo",
      nameEn: "Austria",
      code: "AT",
      continent: "Europe",
    },
    cities: [
      "Vienna",
      "Salzburg",
      "Innsbruck",
      "Graz",
      "Linz",
      "Hallstatt",
      "Klagenfurt",
      "Bregenz",
      "Bad Gastein",
      "Zell am See",
      "Kitzbühel",
      "St. Anton",
      "Wachau",
      "Salzkammergut",
      "Tyrol",
    ],
  },
  {
    country: {
      name: "Hà Lan",
      nameEn: "Netherlands",
      code: "NL",
      continent: "Europe",
    },
    cities: [
      "Amsterdam",
      "Rotterdam",
      "The Hague",
      "Utrecht",
      "Eindhoven",
      "Groningen",
      "Maastricht",
      "Haarlem",
      "Delft",
      "Leiden",
      "Gouda",
      "Alkmaar",
      "Volendam",
      "Zaanse Schans",
      "Keukenhof",
    ],
  },
  {
    country: {
      name: "Bỉ",
      nameEn: "Belgium",
      code: "BE",
      continent: "Europe",
    },
    cities: [
      "Brussels",
      "Bruges",
      "Antwerp",
      "Ghent",
      "Liège",
      "Namur",
      "Leuven",
      "Mechelen",
      "Ostend",
      "Ypres",
      "Dinant",
      "Durbuy",
      "Spa",
      "Waterloo",
      "Knokke",
    ],
  },
  {
    country: {
      name: "Bồ Đào Nha",
      nameEn: "Portugal",
      code: "PT",
      continent: "Europe",
    },
    cities: [
      "Lisbon",
      "Porto",
      "Sintra",
      "Coimbra",
      "Évora",
      "Faro",
      "Braga",
      "Aveiro",
      "Cascais",
      "Albufeira",
      "Lagos",
      "Madeira",
      "Azores",
      "Nazaré",
      "Óbidos",
    ],
  },
  {
    country: {
      name: "Hy Lạp",
      nameEn: "Greece",
      code: "GR",
      continent: "Europe",
    },
    cities: [
      "Athens",
      "Santorini",
      "Mykonos",
      "Crete",
      "Rhodes",
      "Thessaloniki",
      "Corfu",
      "Zakynthos",
      "Paros",
      "Naxos",
      "Delphi",
      "Olympia",
      "Meteora",
      "Mycenae",
      "Epidaurus",
    ],
  },
  {
    country: {
      name: "Thụy Điển",
      nameEn: "Sweden",
      code: "SE",
      continent: "Europe",
    },
    cities: [
      "Stockholm",
      "Gothenburg",
      "Malmö",
      "Uppsala",
      "Kiruna",
      "Luleå",
      "Örebro",
      "Linköping",
      "Västerås",
      "Jönköping",
      "Helsingborg",
      "Lund",
      "Visby",
      "Abisko",
      "Lapland",
    ],
  },
  {
    country: {
      name: "Na Uy",
      nameEn: "Norway",
      code: "NO",
      continent: "Europe",
    },
    cities: [
      "Oslo",
      "Bergen",
      "Tromsø",
      "Trondheim",
      "Stavanger",
      "Ålesund",
      "Bodø",
      "Lofoten",
      "Geiranger",
      "Flam",
      "Sognefjord",
      "Nordkapp",
      "Trolltunga",
      "Preikestolen",
      "Lillehammer",
    ],
  },
  {
    country: {
      name: "Đan Mạch",
      nameEn: "Denmark",
      code: "DK",
      continent: "Europe",
    },
    cities: [
      "Copenhagen",
      "Aarhus",
      "Odense",
      "Aalborg",
      "Roskilde",
      "Helsingør",
      "Billund",
      "Skagen",
      "Ribe",
      "Esbjerg",
      "Kolding",
      "Vejle",
      "Herning",
      "Sønderborg",
      "Bornholm",
    ],
  },
  {
    country: {
      name: "Phần Lan",
      nameEn: "Finland",
      code: "FI",
      continent: "Europe",
    },
    cities: [
      "Helsinki",
      "Tampere",
      "Turku",
      "Oulu",
      "Rovaniemi",
      "Lapland",
      "Porvoo",
      "Savonlinna",
      "Kuopio",
      "Jyväskylä",
      "Vaasa",
      "Lappeenranta",
      "Kemi",
      "Kemi SnowCastle",
      "Santa Claus Village",
    ],
  },
  {
    country: {
      name: "Cộng hòa Séc",
      nameEn: "Czech Republic",
      code: "CZ",
      continent: "Europe",
    },
    cities: [
      "Prague",
      "Brno",
      "Český Krumlov",
      "Karlovy Vary",
      "Plzeň",
      "Olomouc",
      "Kutná Hora",
      "Telč",
      "České Budějovice",
      "Liberec",
      "Hradec Králové",
      "Pardubice",
      "Znojmo",
      "Třeboň",
      "Mariánské Lázně",
    ],
  },
  {
    country: {
      name: "Hungary",
      nameEn: "Hungary",
      code: "HU",
      continent: "Europe",
    },
    cities: [
      "Budapest",
      "Debrecen",
      "Szeged",
      "Pécs",
      "Győr",
      "Eger",
      "Sopron",
      "Keszthely",
      "Székesfehérvár",
      "Veszprém",
      "Tata",
      "Hévíz",
      "Siófok",
      "Balatonfüred",
      "Hollókő",
    ],
  },
  {
    country: {
      name: "Ba Lan",
      nameEn: "Poland",
      code: "PL",
      continent: "Europe",
    },
    cities: [
      "Warsaw",
      "Kraków",
      "Gdańsk",
      "Wrocław",
      "Poznań",
      "Łódź",
      "Lublin",
      "Zakopane",
      "Toruń",
      "Malbork",
      "Białystok",
      "Katowice",
      "Szczecin",
      "Bydgoszcz",
      "Częstochowa",
    ],
  },
  {
    country: {
      name: "Croatia",
      nameEn: "Croatia",
      code: "HR",
      continent: "Europe",
    },
    cities: [
      "Zagreb",
      "Dubrovnik",
      "Split",
      "Zadar",
      "Rijeka",
      "Pula",
      "Trogir",
      "Plitvice",
      "Hvar",
      "Korčula",
      "Rovinj",
      "Šibenik",
      "Osijek",
      "Makarska",
      "Opatija",
    ],
  },
  {
    country: {
      name: "Iceland",
      nameEn: "Iceland",
      code: "IS",
      continent: "Europe",
    },
    cities: [
      "Reykjavik",
      "Akureyri",
      "Vík",
      "Húsavík",
      "Golden Circle",
      "Blue Lagoon",
      "Jökulsárlón",
      "Thingvellir",
      "Geysir",
      "Gullfoss",
      "Seljalandsfoss",
      "Skógafoss",
      "Dettifoss",
      "Mývatn",
      "Snaefellsnes",
    ],
  },
];

// Kết nối MongoDB
async function connectMongo() {
  const uri =
    process.env.DATABASE ||
    process.env.MONGO_URL ||
    "mongodb://127.0.0.1:27017/web-du-lich-fixed-dev";

  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB:", uri);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

// Import dữ liệu
async function importData() {
  try {
    console.log("\n🚀 Bắt đầu import dữ liệu các quốc gia và thành phố Châu Âu...\n");

    let totalCountries = 0;
    let totalCities = 0;

    for (const item of europeanData) {
      const { country: countryData, cities: cityNames } = item;

      // Tạo hoặc cập nhật quốc gia
      let country = await Country.findOne({
        $or: [
          { name: countryData.name },
          { code: countryData.code },
        ],
      });

      if (!country) {
        country = await Country.create({
          name: countryData.name,
          nameEn: countryData.nameEn,
          code: countryData.code,
          continent: countryData.continent,
          status: "active",
          position: 0,
        });
        console.log(`✅ Đã tạo quốc gia: ${country.name} (${country.code})`);
        totalCountries++;
      } else {
        // Cập nhật thông tin nếu thiếu
        if (!country.nameEn && countryData.nameEn) {
          country.nameEn = countryData.nameEn;
        }
        if (!country.code && countryData.code) {
          country.code = countryData.code;
        }
        if (!country.continent && countryData.continent) {
          country.continent = countryData.continent;
        }
        await country.save();
        console.log(`ℹ️  Quốc gia đã tồn tại: ${country.name}`);
      }

      // Tạo các thành phố
      for (let i = 0; i < cityNames.length; i++) {
        const cityName = cityNames[i];
        
        let city = await City.findOne({
          name: cityName,
          countryId: country._id,
        });

        if (!city) {
          city = await City.create({
            name: cityName,
            nameEn: cityName, // Mặc định tên tiếng Anh giống tên tiếng Việt
            countryId: country._id,
            countryName: country.name,
            status: "active",
            position: i + 1,
          });
          totalCities++;
        } else {
          // Cập nhật thông tin nếu thiếu
          if (!city.countryId) {
            city.countryId = country._id;
          }
          if (!city.countryName) {
            city.countryName = country.name;
          }
          await city.save();
        }
      }

      console.log(`   └─ Đã xử lý ${cityNames.length} thành phố cho ${country.name}\n`);
    }

    console.log("\n✅ Hoàn thành import dữ liệu!");
    console.log(`📊 Tổng số quốc gia: ${totalCountries} (mới tạo)`);
    console.log(`📊 Tổng số thành phố: ${totalCities} (mới tạo)`);
    console.log(`📊 Tổng số quốc gia trong database: ${await Country.countDocuments({ continent: "Europe" })}`);
    console.log(`📊 Tổng số thành phố trong database: ${await City.countDocuments({ countryName: { $exists: true } })}`);

  } catch (error) {
    console.error("❌ Lỗi khi import dữ liệu:", error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    await connectMongo();
    await importData();
    console.log("\n✅ Script hoàn thành!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Script thất bại:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Đã ngắt kết nối MongoDB");
  }
}

// Chạy script
if (require.main === module) {
  main();
}

module.exports = { importData, connectMongo };

