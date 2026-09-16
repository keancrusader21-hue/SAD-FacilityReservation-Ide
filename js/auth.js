
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}-form`).classList.add("active");
  });
});


(async () => {
  const { data } = await sb.auth.getSession();
  if (data.session) window.location.href = "dashboard.html";
})();


document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-msg");
  msg.textContent = "Signing in...";

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    msg.textContent = error.message;
    msg.className = "form-msg error";
  } else {
    window.location.href = "dashboard.html";
  }
});


document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const full_name = document.getElementById("signup-name").value;
  const email = document.getElementById("signup-email").value;
  const password = document.getElementById("signup-password").value;
  const role = document.getElementById("signup-role").value;
  const msg = document.getElementById("signup-msg");
  msg.textContent = "Creating account...";

  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name, role } },
  });

  if (error) {
    msg.textContent = error.message;
    msg.className = "form-msg error";
  } else {
    msg.textContent = "Account created. You can sign in now.";
    msg.className = "form-msg success";
  }
});
