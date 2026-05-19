const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const requestedRoomSchema = new Schema(
  {
    roomTypeId: { type: Types.ObjectId, required: true },
    roomTypeName: { type: String, default: "" },
    baseOccupancy: { type: Number, default: 2 },
    assignedRooms: { type: Number, default: 0 },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
  },
  { _id: false }
);

const approvedRoomSchema = new Schema(
  {
    roomTypeId: { type: Types.ObjectId, required: true },
    approvedRooms: { type: Number, default: 0 },
  },
  { _id: false }
);

const schema = new Schema(
  {
    fromCompanyId: { type: Types.ObjectId, ref: "Company", required: true },
    fromCompanyName: { type: String, default: "" },
    toCompanyId: { type: Types.ObjectId, ref: "Company", required: true },
    toCompanyName: { type: String, default: "" },

    tourSegmentId: { type: Types.ObjectId, ref: "TourSegment", required: true },
    tourId: { type: Types.ObjectId, ref: "Tour", required: true },
    tourName: { type: String, default: "" },
    departureDate: { type: Date, required: true },
    endDate: { type: Date },

    hotelId: { type: Types.ObjectId, ref: "Hotel", required: true },
    hotelName: { type: String, default: "" },

    requestedRooms: { type: [requestedRoomSchema], default: [] },
    approvedRooms: { type: [approvedRoomSchema], default: [] },

    status: {
      type: String,
      enum: ["pending", "approved", "partially_approved", "rejected", "cancelled"],
      default: "pending",
    },

    note: { type: String, default: "" },
    responseNote: { type: String, default: "" },

    /** Người đã thực hiện duyệt / từ chối (phía nhận yêu cầu). */
    reviewedBy: {
      accountId: { type: Types.ObjectId, ref: "AccountAdmin", default: null },
      fullName:  { type: String, default: "" },
    },
    /** Thời điểm duyệt / từ chối. */
    reviewedAt: { type: Date, default: null },

    holdBookingIds: { type: [Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: "hotel_link_requests" }
);

schema.index({ toCompanyId: 1, status: 1, createdAt: -1 });
schema.index({ fromCompanyId: 1, createdAt: -1 });
schema.index({ tourSegmentId: 1 });

module.exports = mongoose.model("HotelLinkRequest", schema);
