import {loadLayout, layoutItem} from "./domestic-futures-layout.mjs";

const calendar = document.querySelector("#calendar");
const days = ["一", "二", "三", "四", "五", "六", "日"];
const values = {2: 1680, 3: -920, 6: 3120, 7: 2140, 8: -1560, 9: 4280, 10: 960, 13: -3120, 14: 2640, 15: 3780, 16: 1180, 17: 2940, 18: 2340};

function renderCalendar() {
  if (!calendar) return;
  calendar.textContent = "";
  days.forEach((day) => calendar.insertAdjacentHTML("beforeend", `<div class="weekday">${day}</div>`));
  for (let index = 0; index < 4; index += 1) calendar.insertAdjacentHTML("beforeend", '<div class="day empty">&nbsp;</div>');
  for (let day = 1; day <= 31; day += 1) {
    const value = values[day] || 0;
    const tone = value > 0 ? "profit" : value < 0 ? "loss" : "flat";
    const amount = value ? `${value > 0 ? "+" : ""}${(value / 1000).toFixed(1)}k` : "—";
    const sign = value > 0 ? "+" : "";
    const detail = value ? `${sign}¥${Math.abs(value).toLocaleString()}` : "无交易";
    calendar.insertAdjacentHTML("beforeend", `<div class="day ${tone}" title="10月${day}日 ${detail}"><span>${day}</span><b>${amount}</b></div>`);
  }
}

function applyLayout(layout) {
  document.querySelectorAll(".layout-module").forEach((module) => {
    const item = layoutItem(layout, module.dataset.module);
    if (!item) return;
    module.hidden = item.visible === false;
    module.style.gridColumn = `${item.x + 1} / span ${item.w}`;
    module.style.gridRow = `${item.y + 1} / span ${item.h}`;
    const title = module.querySelector("h2, h3");
    if (title) title.textContent = item.title;
    const subtitle = module.querySelector(".panel-head .panel-sub");
    if (subtitle) subtitle.textContent = item.subtitle || "";
  });
}

renderCalendar();
applyLayout(loadLayout());
document.querySelectorAll(".range button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".range button").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}));
if (window.lucide) window.lucide.createIcons();
