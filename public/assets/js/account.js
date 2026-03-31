// Login Form
const loginForm = document.querySelector("#login-form");
if (loginForm) {
  const validator = new JustValidate("#login-form");

  validator
    .addField("#email", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập email!",
      },
      {
        rule: "email",
        errorMessage: "Email không đúng định dạng!",
      },
    ])
    .addField("#password", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mật khẩu!",
      },
    ])
    .onSuccess((event) => {
      const email = event.target.email.value;
      const password = event.target.password.value;
      // const rememberPassword = event.target.rememberPassword.checked;

      const dataFinal = {
        email: email,
        password: password,
      };

      fetch(`/account/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            drawNotify(data.code, data.message);
            window.location.href = `/`;
          }
        });
    });
}
// End Login Form

// Register Form
const registerForm = document.querySelector("#register-form");
if (registerForm) {
  const validator = new JustValidate("#register-form");

  validator
    .addField("#fullName", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập họ tên!",
      },
      {
        rule: "minLength",
        value: 5,
        errorMessage: "Họ tên phải có ít nhất 5 ký tự!",
      },
      {
        rule: "maxLength",
        value: 50,
        errorMessage: "Họ tên không được vượt quá 50 ký tự!",
      },
    ])
    .addField("#email", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập email!",
      },
      {
        rule: "email",
        errorMessage: "Email không đúng định dạng!",
      },
    ])
    .addField("#password", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mật khẩu!",
      },
      {
        rule: "minLength",
        value: 8,
        errorMessage: "Mật khẩu phải có ít nhất 8 ký tự!",
      },
      {
        rule: "customRegexp",
        value: /[A-Z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết hoa!",
      },
      {
        rule: "customRegexp",
        value: /[a-z]/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ cái viết thường!",
      },
      {
        rule: "customRegexp",
        value: /\d/,
        errorMessage: "Mật khẩu phải có ít nhất một chữ số!",
      },
      {
        rule: "customRegexp",
        value: /[~!@#$%^&*]/,
        errorMessage:
          "Mật khẩu phải có ít nhất một ký tự đặc biệt! (~!@#$%^&*)",
      },
    ])
    .addField("#agree", [
      {
        rule: "required",
        errorMessage: "Bạn phải đồng ý với các điều khoản và điều kiện!",
      },
    ])
    .onSuccess((event) => {
      const fullName = event.target.fullName.value;
      const email = event.target.email.value;
      const password = event.target.password.value;

      const dataFinal = {
        fullName: fullName,
        email: email,
        password: password,
      };

      fetch(`/account/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dataFinal),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code == "error") {
            notify.error(data.message);
          }

          if (data.code == "success") {
            drawNotify(data.code, data.message);
            window.location.href = `/account/login`;
          }
        });
    });
}
// End Register Form
