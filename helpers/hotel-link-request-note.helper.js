// Prefix gắn vào đầu HotelLinkRequest.responseNote khi hệ thống đóng yêu cầu
// do phía công ty gửi tour (xác nhận lại / huỷ segment), không phải do đối tác
// từ chối trên màn «Yêu cầu nhận được».
// Trang hotel-link-requests-sent.pug dùng cùng hằng để hiển thị đúng nhãn.
exports.HOTEL_LINK_REQ_AUTO_BY_SENDING_COMPANY_TAG = "[AUTO_BEN_GUI_TOUR] ";
