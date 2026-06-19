// scripts/test-tour-hotel-segment-diff.js
// Chạy: node scripts/test-tour-hotel-segment-diff.js

const assert = require("assert");
const {
  buildRoomPlanFromSegments,
  buildRoomPlanFromLinkRequest,
  roomPlansEqual,
  diffHotelsForConfirm,
} = require("../helpers/tour-hotel-segment-diff.helper");

const RT1 = "507f1f77bcf86cd799439011";
const RT2 = "507f1f77bcf86cd799439012";
const H1 = "607f1f77bcf86cd799439021";
const H2 = "607f1f77bcf86cd799439022";
const H3 = "607f1f77bcf86cd799439023";

function seg(from, to, hotels) {
  return { fromDate: from, toDate: to, hotels };
}

const baseSegments = [
  seg("2027-03-01", "2027-03-03", [
    {
      hotelId: H1,
      roomAllocations: [
        { roomTypeId: RT1, assignedRooms: 2, baseOccupancy: 2, roomTypeName: "Deluxe" },
      ],
    },
    {
      hotelId: H2,
      roomAllocations: [
        { roomTypeId: RT1, assignedRooms: 1, baseOccupancy: 2, roomTypeName: "Deluxe" },
      ],
    },
  ]),
];

const baseRequests = [
  {
    hotelId: H1,
    status: "pending",
    createdAt: new Date("2027-01-02"),
    requestedRooms: [
      {
        roomTypeId: RT1,
        assignedRooms: 2,
        baseOccupancy: 2,
        fromDate: "2027-03-01",
        toDate: "2027-03-03",
      },
    ],
  },
  {
    hotelId: H2,
    status: "approved",
    createdAt: new Date("2027-01-02"),
    requestedRooms: [
      {
        roomTypeId: RT1,
        assignedRooms: 1,
        baseOccupancy: 2,
        fromDate: "2027-03-01",
        toDate: "2027-03-03",
      },
    ],
  },
];

// unchanged when identical
{
  const d = diffHotelsForConfirm({
    currentSegments: baseSegments,
    linkRequests: baseRequests,
  });
  assert.deepStrictEqual(d.unchangedHotelIds.sort(), [H1, H2].sort());
  assert.deepStrictEqual(d.changedHotelIds, []);
  assert.deepStrictEqual(d.addedHotelIds, []);
  assert.deepStrictEqual(d.removedHotelIds, []);
}

// changed room count
{
  const modified = JSON.parse(JSON.stringify(baseSegments));
  modified[0].hotels[0].roomAllocations[0].assignedRooms = 3;
  const d = diffHotelsForConfirm({
    currentSegments: modified,
    linkRequests: baseRequests,
  });
  assert.ok(d.changedHotelIds.includes(H1));
  assert.ok(d.unchangedHotelIds.includes(H2));
  assert.ok(d.needsNewRequestHotelIds.includes(H1));
}

// added hotel
{
  const withNew = JSON.parse(JSON.stringify(baseSegments));
  withNew[0].hotels.push({
    hotelId: H3,
    roomAllocations: [
      { roomTypeId: RT2, assignedRooms: 1, baseOccupancy: 2 },
    ],
  });
  const d = diffHotelsForConfirm({
    currentSegments: withNew,
    linkRequests: baseRequests,
  });
  assert.ok(d.addedHotelIds.includes(H3));
  assert.ok(d.unchangedHotelIds.includes(H1));
}

// removed hotel
{
  const onlyH1 = [
    seg("2027-03-01", "2027-03-03", [
      {
        hotelId: H1,
        roomAllocations: [
          { roomTypeId: RT1, assignedRooms: 2, baseOccupancy: 2 },
        ],
      },
    ]),
  ];
  const d = diffHotelsForConfirm({
    currentSegments: onlyH1,
    linkRequests: baseRequests,
  });
  assert.ok(d.removedHotelIds.includes(H2));
  assert.ok(d.unchangedHotelIds.includes(H1));
}

// first confirm — no effective requests
{
  const d = diffHotelsForConfirm({
    currentSegments: baseSegments,
    linkRequests: [],
  });
  assert.deepStrictEqual(d.addedHotelIds.sort(), [H1, H2].sort());
  assert.deepStrictEqual(d.unchangedHotelIds, []);
}

// cancelled latest → treat as added (no effective baseline)
{
  const d = diffHotelsForConfirm({
    currentSegments: baseSegments,
    linkRequests: [
      {
        hotelId: H1,
        status: "cancelled",
        createdAt: new Date(),
        requestedRooms: baseRequests[0].requestedRooms,
      },
    ],
  });
  assert.ok(d.addedHotelIds.includes(H1));
}

// roomPlansEqual
{
  const p1 = buildRoomPlanFromSegments(baseSegments, H1);
  const p2 = buildRoomPlanFromLinkRequest(baseRequests[0].requestedRooms);
  assert.ok(roomPlansEqual(p1, p2));
}

console.log("test-tour-hotel-segment-diff: all assertions passed");
