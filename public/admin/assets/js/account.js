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
      const rememberPassword = event.target.rememberPassword.checked;

      const dataFinal = {
        email: email,
        password: password,
        rememberPassword: rememberPassword,
      };

      fetch(`/${pathAdmin}/account/login`, {
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
            // ⭐ Redirect về URL từ server (super-admin hoặc company-admin dashboard)
            window.location.href = data.redirectUrl || `/${pathAdmin}/dashboard`;
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
      { rule: "required", errorMessage: "Vui lòng nhập họ tên!" },
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
      { rule: "required", errorMessage: "Vui lòng nhập email!" },
      { rule: "email", errorMessage: "Email không đúng định dạng!" },
    ])
    // NEW: companyName
    .addField("#companyName", [
      { rule: "required", errorMessage: "Vui lòng nhập tên công ty!" },
      {
        rule: "minLength",
        value: 2,
        errorMessage: "Tên công ty phải có ít nhất 2 ký tự!",
      },
      {
        rule: "maxLength",
        value: 100,
        errorMessage: "Tên công ty không được vượt quá 100 ký tự!",
      },
    ])
    .addField("#password", [
      { rule: "required", errorMessage: "Vui lòng nhập mật khẩu!" },
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
    .addField("#confirmPassword", [
      { rule: "required", errorMessage: "Vui lòng nhập xác nhận mật khẩu!" },
      {
        validator: (value, fields) => {
          const pwd = fields["#password"]?.elem?.value || "";
          return value === pwd;
        },
        errorMessage: "Xác nhận mật khẩu không khớp!",
      },
    ])
    .addField("#agree", [
      {
        rule: "required",
        errorMessage: "Bạn phải đồng ý với các điều khoản và điều kiện!",
      },
    ])
    .onSuccess((event) => {
      const fullName = event.target.fullName.value.trim();
      const email = event.target.email.value.trim().toLowerCase();
      const companyName = event.target.companyName.value.trim(); 
      const password = event.target.password.value;
      const confirmPassword = event.target.confirmPassword.value; 
      const agree = event.target.agree.checked;

      const dataFinal = {
        fullName,
        email,
        companyName, 
        password,
        confirmPassword, 
        agree,
      };

      fetch(`/${pathAdmin}/account/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataFinal),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.code === "error") {
            notify.error(data.message);
          }
          if (data.code === "success") {
            drawNotify(data.code, data.message);
            window.location.href = `/${pathAdmin}/account/register-initial`;
          }
        })
        .catch(() => notify.error("Không thể đăng ký. Vui lòng thử lại!"));
    });
}
// End Register Form

// Forgot Password Form
const forgotPasswordForm = document.querySelector("#forgot-password-form");
if (forgotPasswordForm) {
  const validator = new JustValidate("#forgot-password-form");

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
    .onSuccess((event) => {
      const email = event.target.email.value;

      const dataFinal = {
        email: email,
      };

      fetch(`/${pathAdmin}/account/forgot-password`, {
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
            window.location.href = `/${pathAdmin}/account/otp-password?email=${email}`;
          }
        });
    });
}
// End Forgot Password Form

// OTP Password Form
const otpPasswordForm = document.querySelector("#otp-password-form");
if (otpPasswordForm) {
  const validator = new JustValidate("#otp-password-form");

  validator
    .addField("#otp", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mã OTP!",
      },
    ])
    .onSuccess((event) => {
      const otp = event.target.otp.value;

      const urlParams = new URLSearchParams(location.search);
      const email = urlParams.get("email");

      const dataFinal = {
        email: email,
        otp: otp,
      };

      fetch(`/${pathAdmin}/account/otp-password`, {
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
            window.location.href = `/${pathAdmin}/account/reset-password`;
          }
        });
    });
}
// End OTP Password Form

// Reset Password Form
const resetPasswordForm = document.querySelector("#reset-password-form");
if (resetPasswordForm) {
  const validator = new JustValidate("#reset-password-form");

  validator
    .addField("#password", [
      {
        rule: "required",
        errorMessage: "Vui lòng nhập mật khẩu mới!",
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
    .addField("#confirm-password", [
      {
        validator: (value, fields) => {
          const password = fields["#password"].elem.value;
          return password == value;
        },
        errorMessage: "Mật khẩu xác nhận không khớp!",
      },
    ])
    .onSuccess((event) => {
      const password = event.target.password.value;

      const dataFinal = {
        password: password,
      };

      fetch(`/${pathAdmin}/account/reset-password`, {
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
            window.location.href = `/${pathAdmin}/dashboard`;
          }
        });
    });
}
// End Reset Password Form
