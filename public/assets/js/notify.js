// Notify
var notify = new Notyf({
  duration: 3000,
  position: {
    x: "right",
    y: "top",
  },
  dismissible: true,
});

let existNotify = sessionStorage.getItem("notify");
if (existNotify) {
  existNotify = JSON.parse(existNotify);
  if (existNotify.code == "error") {
    notify.error(existNotify.message);
  }
  if (existNotify.code == "success") {
    notify.success(existNotify.message);
  }
  sessionStorage.removeItem("notify");
}

const drawNotify = (code, message) => {
  sessionStorage.setItem(
    "notify",
    JSON.stringify({
      code: code,
      message: message,
    })
  );
};
// End Notify
