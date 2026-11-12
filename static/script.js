/* ===========================================================
   RiskPanel – Credit Risk UI
   API_BASE: leave "" when this UI is served by the same FastAPI app.
   If the UI is hosted separately, set your API URL, e.g.
   const API_BASE = "https://your-api.onrender.com";
   =========================================================== */
const API_BASE = "";

const $ = (s) => document.querySelector(s);
const form = $("#form");
const arcProg = $("#arcProg"), arcLen = 565.5, dot = $("#dot"), gaugeWrap = $(".gauge-wrap");
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const ease = (t) => 1 - Math.pow(1 - t, 3);

let history = JSON.parse(localStorage.getItem("rp_history") || "[]");
let last = null, mode = "summary", threshold = null, typeTimer = null, shown = 0;

/* ---------- tiny animation helper ---------- */
function tween(from, to, ms, fn) {
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min((now - t0) / ms, 1);
    fn(from + (to - from) * ease(p));
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function setGauge(pct) {                       // pct: 0..100
  arcProg.style.strokeDashoffset = arcLen * (1 - pct / 100);
  const pt = $("#arcTrack").getPointAtLength((pct / 100) * $("#arcTrack").getTotalLength());
  dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y);
  $("#gaugeVal").textContent = pct.toFixed(1) + "%";
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove("show"), 3800);
}

/* ---------- live form helpers ---------- */
const val = (n) => form.elements[n].value;
const num = (n) => parseFloat(val(n)) || 0;

function updateLive() {
  const inc = num("person_income"), amt = num("loan_amnt");
  const lpi = inc > 0 ? Math.round((amt / inc) * 100) / 100 : 0;
  form.elements.loan_percent_income.value = lpi;
  $("#sBurden").textContent = Math.round(lpi * 100) + "%";
  const r = num("loan_int_rate") / 1200;
  $("#sMonthly").textContent = money(amt * r);
  $("#sHist").textContent = num("cb_person_cred_hist_length") + " yrs";
  renderIndicators();
}
form.addEventListener("input", updateLive);

/* ---------- presets ---------- */
const PRESETS = {
  low:  { person_age: 38, person_income: 95000, person_home_ownership: "OWN", person_emp_length: 12, loan_intent: "HOMEIMPROVEMENT", loan_grade: "A", loan_amnt: 8000, loan_int_rate: 7.2, cb_person_default_on_file: "N", cb_person_cred_hist_length: 14 },
  mid:  { person_age: 27, person_income: 48000, person_home_ownership: "RENT", person_emp_length: 3, loan_intent: "EDUCATION", loan_grade: "C", loan_amnt: 12000, loan_int_rate: 12.8, cb_person_default_on_file: "N", cb_person_cred_hist_length: 5 },
  high: { person_age: 22, person_income: 24000, person_home_ownership: "RENT", person_emp_length: 0.5, loan_intent: "MEDICAL", loan_grade: "F", loan_amnt: 15000, loan_int_rate: 19.9, cb_person_default_on_file: "Y", cb_person_cred_hist_length: 2 },
};
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const p = PRESETS[b.dataset.preset];
    Object.entries(p).forEach(([k, v]) => (form.elements[k].value = v));
    updateLive();
    form.querySelectorAll("input,select").forEach((el, i) => setTimeout(() => el.classList.add("flash"), i * 25));
    setTimeout(() => form.querySelectorAll(".flash").forEach((el) => el.classList.remove("flash")), 1300);
  })
);
$("#resetBtn").addEventListener("click", () => { form.reset(); updateLive(); });

/* ---------- API ---------- */
async function checkHealth() {
  const s = $("#status");
  try {
    const r = await fetch(API_BASE + "/health");
    const d = await r.json();
    if (!d.model_loaded) throw 0;
    s.className = "status ok"; s.querySelector("b").textContent = "Model online";
  } catch {
    s.className = "status bad"; s.querySelector("b").textContent = "API offline";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  let bad = false;
  form.querySelectorAll("input[required]").forEach((el) => {
    el.classList.remove("err");
    if (el.value === "" || isNaN(el.value)) { el.classList.add("err"); bad = true; }
  });
  if (num("person_income") <= 0) { form.elements.person_income.classList.add("err"); bad = true; }
  if (bad) return toast("Check the highlighted fields and try again.");

  const payload = {
    person_age: parseInt(val("person_age")),
    person_income: num("person_income"),
    person_home_ownership: val("person_home_ownership"),
    person_emp_length: num("person_emp_length"),
    loan_intent: val("loan_intent"),
    loan_grade: val("loan_grade"),
    loan_amnt: num("loan_amnt"),
    loan_int_rate: num("loan_int_rate"),
    loan_percent_income: num("loan_percent_income"),
    cb_person_default_on_file: val("cb_person_default_on_file"),
    cb_person_cred_hist_length: parseInt(val("cb_person_cred_hist_length")),
  };

  const btn = $("#submitBtn"); btn.classList.add("loading");
  try {
    const res = await fetch(API_BASE + "/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The API rejected this application.");
    last = { payload, data, at: Date.now() };
    showResult(last);
    $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    toast(err.message.includes("fetch") ? "Can't reach the API. Check that the server is running." : err.message);
  } finally { btn.classList.remove("loading"); }
});

/* ---------- show a result ---------- */
function showResult({ payload, data }) {
  const pct = data.default_probability * 100, hi = data.default_prediction === 1;
  threshold = data.threshold;

  gaugeWrap.classList.toggle("hi", hi);
  const from = shown; shown = pct;
  tween(from, pct, 1500, setGauge);

  // threshold tick on the arc
  const tr = $("#arcTrack"), len = tr.getTotalLength();
  const p1 = tr.getPointAtLength(len * threshold), cx = 200, cy = 210;
  const k = 1.09, tick = $("#thrTick");
  const dx = p1.x - cx, dy = p1.y - cy;
  tick.setAttribute("x1", cx + dx * 0.95); tick.setAttribute("y1", cy + dy * 0.95);
  tick.setAttribute("x2", cx + dx * k); tick.setAttribute("y2", cy + dy * k);
  tick.classList.add("show");

  $("#verdict").className = "verdict " + (hi ? "high" : "low");
  $("#verdictTag").textContent = data.Result;
  $("#verdictText").textContent = `${pct.toFixed(1)}% chance of default (cut-off ${(threshold * 100).toFixed(1)}%)`;

  history.unshift({ at: Date.now(), p: data.default_probability, hi, grade: payload.loan_grade, amt: payload.loan_amnt, intent: payload.loan_intent, inc: payload.person_income, age: payload.person_age });
  history = history.slice(0, 30);
  localStorage.setItem("rp_history", JSON.stringify(history));
  renderStats(); renderHistory(true); renderIndicators();
  setMode(mode);
}

/* ---------- analyst text ---------- */
function analysis(kind) {
  const { payload: p, data: d } = last, pct = (d.default_probability * 100).toFixed(1), hi = d.default_prediction === 1;
  const issues = [], good = [];
  if (p.loan_percent_income > 0.3) issues.push(`Loan is <span class="hl">${Math.round(p.loan_percent_income * 100)}% of income</span>, which is a heavy burden`); else if (p.loan_percent_income <= 0.15) good.push("Loan size is modest compared with income");
  if (p.loan_int_rate > 14) issues.push(`High interest rate of <span class="hl">${p.loan_int_rate}%</span>`); else if (p.loan_int_rate < 9) good.push("Interest rate is low");
  if ("DEFG".includes(p.loan_grade)) issues.push(`Loan grade <span class="hl">${p.loan_grade}</span> signals weaker credit quality`); else if ("AB".includes(p.loan_grade)) good.push(`Strong loan grade (${p.loan_grade})`);
  if (p.cb_person_default_on_file === "Y") issues.push("<span class=\"hl\">Past default</span> is on file"); else good.push("No past default on file");
  if (p.cb_person_cred_hist_length < 4) issues.push("Short credit history"); else if (p.cb_person_cred_hist_length >= 10) good.push("Long credit history");
  if (p.person_emp_length < 1) issues.push("Less than a year in current employment"); else if (p.person_emp_length >= 5) good.push("Stable employment length");
  const li = (a) => "<ul>" + a.map((x) => `<li>${x}</li>`).join("") + "</ul>";

  if (kind === "drivers")
    return `<span class="hl">What stands out in this application</span>${li(issues.length ? issues.concat(good.slice(0, 1)) : good.concat(["Nothing in the inputs raises a clear red flag"]))}<span class="muted">These are plain-rule observations on your inputs, not the model's internal reasoning.</span>`;
  if (kind === "advice") {
    const a = hi
      ? ["Consider a smaller loan amount to lower the income burden", "Ask for a longer review if a past default is on file", "Re-run with a better grade or lower rate to see how the result moves"]
      : ["Standard review steps can continue", "Keep the loan-to-income ratio under 30% to stay in this band", "Re-check if income or loan terms change"];
    return `<span class="hl">Suggested next steps</span>${li(a)}`;
  }
  return hi
    ? `<span class="hl">Flag for review.</span> The model puts the default probability at <span class="hl">${pct}%</span>, above the ${(d.threshold * 100).toFixed(1)}% cut-off. ${issues[0] ? "Main concern: " + issues[0].replace(/<[^>]+>/g, "") + "." : ""}`
    : `<span class="hl">Looks acceptable.</span> The model puts the default probability at <span class="hl">${pct}%</span>, below the ${(d.threshold * 100).toFixed(1)}% cut-off. ${good[0] ? good[0] + "." : ""}`;
}
function typeInto(el, html) {
  clearInterval(typeTimer);
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const text = tmp.textContent;
  if (matchMedia("(prefers-reduced-motion:reduce)").matches) { el.innerHTML = html; return; }
  el.classList.add("caret"); el.textContent = ""; let i = 0;
  typeTimer = setInterval(() => {
    i += 3; el.textContent = text.slice(0, i);
    if (i >= text.length) { clearInterval(typeTimer); el.classList.remove("caret"); el.innerHTML = html; }
  }, 14);
}
function setMode(m) {
  mode = m;
  document.querySelectorAll("#modeChips .chip").forEach((c) => c.classList.toggle("dark", c.dataset.mode === m));
  if (last) typeInto($("#reply"), analysis(m));
}
document.querySelectorAll("#modeChips .chip").forEach((c) => c.addEventListener("click", () => setMode(c.dataset.mode)));
$("#viewBtn").addEventListener("click", () => $("#result").scrollIntoView({ behavior: "smooth", block: "center" }));

/* ---------- stats, pills, history ---------- */
function renderStats() {
  const n = history.length, hi = history.filter((h) => h.hi).length, lo = n - hi;
  countTo($("#tTotal"), n);
  $("#tAvg").textContent = n ? ((history.reduce((a, h) => a + h.p, 0) / n) * 100).toFixed(1) + "%" : "–";
  $("#tRate").textContent = n ? Math.round((lo / n) * 100) + "%" : "–";
  if (threshold !== null) $("#tThr").textContent = (threshold * 100).toFixed(1) + "%";
  $("#lowCount").textContent = "/" + lo; $("#highCount").textContent = "/" + hi;
  $("#lowFill").style.width = n ? Math.max((lo / n) * 100, lo ? 18 : 0) + "%" : "0";
  $("#highFill").style.width = n ? Math.max((hi / n) * 100, hi ? 18 : 0) + "%" : "0";
}
function countTo(el, to) { const f = parseInt(el.textContent) || 0; tween(f, to, 700, (v) => (el.textContent = Math.round(v))); }
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };
function renderHistory(animateFirst) {
  const ul = $("#histList");
  if (!history.length) { ul.innerHTML = '<span class="empty">No assessments yet. Run your first one above.</span>'; return; }
  ul.innerHTML = history.map((h, i) => `
    <li style="animation-delay:${animateFirst ? 0 : i * 40}ms">
      <span class="g">${h.grade}</span>
      <div class="h-main"><b>${money(h.amt)} · ${h.intent.replace("HOMEIMPROVEMENT", "HOME IMPROVEMENT").replace("DEBTCONSOLIDATION", "DEBT CONSOLIDATION").toLowerCase()}</b><small>Age ${h.age} · income ${money(h.inc)}</small></div>
      <div class="h-right ${h.hi ? "highc" : "lowc"}">${(h.p * 100).toFixed(1)}%<small>${h.hi ? "High risk" : "Low risk"} · ${ago(h.at)}</small></div>
    </li>`).join("");
}
$("#clearBtn").addEventListener("click", () => { history = []; localStorage.removeItem("rp_history"); renderStats(); renderHistory(); });

/* ---------- input indicators (simple rule-based view of the form) ---------- */
function renderIndicators() {
  const lpi = num("loan_percent_income"), rate = num("loan_int_rate"), g = "ABCDEFG".indexOf(val("loan_grade")), hist = num("cb_person_cred_hist_length");
  const rows = [
    ["Loan burden", Math.min(lpi / 0.5, 1), "#4b4bf0"],
    ["Interest rate", Math.min(rate / 25, 1), "#ffc857"],
    ["Loan grade", g / 6, "#8b5cf6"],
    ["Short credit history", Math.max(1 - hist / 20, 0), "#9a9a9f"],
    ["Past default", val("cb_person_default_on_file") === "Y" ? 1 : 0, "#ff7a72"],
  ];
  const sum = rows.reduce((a, r) => a + r[1], 0) || 1;
  $("#indScore").textContent = Math.round((sum / rows.length) * 100);
  $("#segbar").innerHTML = rows.map((r) => `<i style="background:${r[2]};width:${(r[1] / sum) * 100}%"></i>`).join("");
  $("#indList").innerHTML = rows.map((r) => `<li><i style="background:${r[2]}"></i><span>${r[0]}</span><em>${Math.round(r[1] * 100)}%</em></li>`).join("");
}

/* ---------- init ---------- */
updateLive(); renderStats(); renderHistory(); checkHealth(); setGauge(0);
setInterval(checkHealth, 30000);
