import {
  escapeAttr,
  escapeHtml,
  formatBeijingDateTime,
  formatHoldingTime,
  formatMoney,
  formatPrice,
  formatRValue,
  formatVolume,
  profitClass,
} from "../shared/js/formatters.mjs";

function positionRiskMessage(position) {
  return {
    missing_initial_stop: "缺少入场时设置的初始止损，组合 R 暂不计算。",
    invalid_stop_direction: "止损方向无效：多单需低于所有入场价，空单需高于所有入场价。",
    invalid_initial_stop: "初始止损不是有效价格。",
    position_incomplete: "Position 成交尚未闭合，平仓完成后才能计算 R。",
    volume_mismatch: "开仓与退出手数不一致，当前不计算 R。",
    zero_risk: "初始计划风险为零，当前不计算 R。",
  }[position.risk_missing_reason] || "R 已按该 Position 的初始计划风险计算。";
}

function positionR(position) {
  return position.position_r === null || position.position_r === undefined
    ? "R 缺失"
    : formatRValue(position.position_r);
}

export function createOrderDetailModule({
  api,
  view,
  toast,
  confirm,
  getState,
  renderCustomValueEditor,
  bindCustomValueInputs,
  bindChoiceTriggers,
  classificationSelectOptions,
  afterMutation,
}) {
  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  function renderScreenshotEditor(trade) {
    const preview = trade?.screenshot_url
      ? `<button class="shot-btn snapshot compact-snapshot" id="detailShot" data-shot="${escapeAttr(trade.screenshot_url)}" title="放大截图"><img src="${escapeAttr(trade.screenshot_url)}" alt="5分钟K线截图" /></button>`
      : `<div class="screenshot-empty">暂无截图</div>`;
    return `
      <div class="screenshot-editor" id="screenshotEditor" tabindex="0" aria-label="交易截图">
        <div class="screenshot-preview">${preview}</div>
        <div class="screenshot-actions">
          <button id="replaceScreenshot" class="ghost-btn" type="button">替换图片</button>
          <input id="screenshotFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
          <button id="deleteScreenshot" class="ghost-btn danger-btn" type="button" ${trade?.screenshot_url ? "" : "disabled"}>删除图片</button>
        </div>
        <span class="screenshot-status">支持直接粘贴、拖入或选择本地图片</span>
      </div>
    `;
  }

  function bindScreenshotEditor(trade) {
    const editor = getElement("screenshotEditor");
    const fileInput = getElement("screenshotFile");
    if (!editor || !fileInput) return;
    getElement("replaceScreenshot")?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) replaceScreenshotFile(trade, file);
      fileInput.value = "";
    });
    getElement("deleteScreenshot")?.addEventListener("click", () => deleteTradeScreenshot(trade));
    editor.addEventListener("click", (event) => {
      if (!event.target.closest("button, input")) editor.focus();
    });
    editor.addEventListener("paste", (event) => {
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      replaceScreenshotFile(trade, file);
    });
    editor.addEventListener("dragover", (event) => {
      if (Array.from(event.dataTransfer?.items || []).some((item) => item.type.startsWith("image/"))) {
        event.preventDefault();
        editor.classList.add("drag-over");
      }
    });
    editor.addEventListener("dragleave", () => editor.classList.remove("drag-over"));
    editor.addEventListener("drop", (event) => {
      editor.classList.remove("drag-over");
      const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      replaceScreenshotFile(trade, file);
    });
  }

  function imageFileFromClipboard(clipboard) {
    if (!clipboard) return null;
    const direct = Array.from(clipboard.files || []).find((file) => file.type.startsWith("image/"));
    if (direct) return direct;
    return Array.from(clipboard.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .find(Boolean) || null;
  }

  async function replaceScreenshotFile(trade, file) {
    if (!trade) return;
    if (!file.type.startsWith("image/")) {
      toast("请选择图片文件", { tone: "error" });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("图片不能超过 15MB", { tone: "error" });
      return;
    }
    try {
      const imageData = await readFileAsDataUrl(file);
      await api.requestJson(`/api/trades/${encodeURIComponent(trade.id)}/screenshot`, {
        method: "POST",
        body: { image_data: imageData, filename: file.name },
      });
      toast("截图已替换，旧图片已清理");
      await afterMutation();
    } catch (error) {
      toast(error.message || "截图替换失败", { tone: "error" });
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function deleteTradeScreenshot(trade) {
    if (!trade?.screenshot_url) return;
    if (!confirm("删除这张交易截图？删除后原文件不可恢复。")) return;
    try {
      await api.requestJson(`/api/trades/${encodeURIComponent(trade.id)}/screenshot`, { method: "DELETE" });
      toast("截图已删除，存储文件已清理");
      await afterMutation();
    } catch (error) {
      toast(error.message || "截图删除失败", { tone: "error" });
    }
  }

  async function saveReview() {
    const selection = getState();
    if (!selection.campaign) return;
    const tradeType = getElement("detailTradeType")?.value;
    const strategy = getElement("detailStrategy")?.value;
    const reviewText = getElement("detailReview")?.value || "";
    const payload = { trade_type: tradeType, strategy, review_text: reviewText };
    try {
      if (selection.trade && selection.position) {
        await api.requestJson(`/api/trades/${encodeURIComponent(selection.trade.id)}/review`, {
          method: "PATCH",
          body: payload,
        });
      } else {
        await api.requestJson(`/api/campaigns/${encodeURIComponent(selection.campaign.id)}/review`, {
          method: "PATCH",
          body: payload,
        });
      }
      await afterMutation();
      toast(selection.position ? "订单复盘已保存到本地" : "组合复盘已保存到本地");
    } catch (error) {
      toast(error.message || "复盘保存失败", { tone: "error" });
    }
  }

  function renderCampaignDetail() {
    const node = getElement("orderDetail");
    if (!node) return;
    const { campaign, detail, trade, customFields } = getState();
    if (!campaign) {
      node.innerHTML = `<div class="detail-empty">选择一个交易组合开始复盘</div>`;
      return;
    }
    if (!detail) {
      node.innerHTML = `<div class="detail-empty">正在加载交易组合详情</div>`;
      return;
    }
    const customFieldInputs = customFields
      .map(
        (field) => `
          <div class="field compact-field">
            <label>${escapeHtml(field.name)}</label>
            ${trade ? renderCustomValueEditor(trade, field, "detail") : `<span class="muted-mini">无代表订单</span>`}
          </div>
        `,
      )
      .join("");
    const positionRows = (detail.positions || [])
      .map((position) => {
        const exits = (position.exit_deals || [])
          .map(
            (exitDeal) => `
              <li><span>${formatBeijingDateTime(exitDeal.time_utc)}</span><strong>${Number(exitDeal.volume).toFixed(2)} 手 @ ${escapeHtml(exitDeal.price)}</strong></li>
            `,
          )
          .join("");
        return `
          <section class="campaign-position ${position.risk_status === "complete" ? "" : "position-risk-gap"}">
            <div class="campaign-position-head">
              <div>
                <strong>Position ${escapeHtml(position.display_position_id || position.position_id)}</strong>
                <span>${formatBeijingDateTime(position.opened_at_utc)} · ${Number(position.entry_volume || 0).toFixed(2)} 手 @ ${formatPrice(position.weighted_entry_price)}</span>
              </div>
              <span class="position-r-status ${position.risk_status}">${escapeHtml(positionR(position))}</span>
            </div>
            <div class="position-plan-risk">
              <span>初始计划止损</span>
              <strong>${escapeHtml(formatPrice(position.initial_stop_price))}</strong>
              <small>请在左侧订单流水表格中填写或修改</small>
            </div>
            <p class="position-risk-note">${escapeHtml(positionRiskMessage(position))}</p>
            <ul class="position-exits">${exits || `<li><span>尚未平仓</span></li>`}</ul>
          </section>
        `;
      })
      .join("");
    node.innerHTML = `
      <div class="detail-body dense-detail">
        <div class="detail-title">
          <div>
            <p class="eyebrow">${escapeHtml(campaign.symbol)} · Campaign ${escapeHtml(campaign.display_order_no || campaign.id.slice(0, 8))}</p>
            <h2>${campaign.side === "long" ? "多单" : "空单"} · ${campaign.position_count} 个 Position</h2>
            <span class="detail-time">${escapeHtml(formatBeijingDateTime(campaign.opened_at_utc))} → ${escapeHtml(formatBeijingDateTime(campaign.closed_at_utc))}</span>
          </div>
          <strong class="${profitClass(campaign.net_pnl)}">${formatMoney(campaign.net_pnl)}</strong>
        </div>
        <div class="campaign-risk-summary ${campaign.risk_status === "complete" ? "complete" : "missing"}">
          <div><span>组合 R</span><strong>${escapeHtml(globalThis.RMultipleUI?.formatCampaignR?.(campaign) || "-")}</strong></div>
          <small>${escapeHtml(globalThis.RMultipleUI?.campaignActivityLabel?.(campaign) || "")} · 初始计划风险不代表实际最大浮亏</small>
        </div>
        <div class="campaign-position-list">${positionRows}</div>
        ${trade ? renderScreenshotEditor(trade) : ""}
        <div class="field-grid classification-grid">
          <div class="field compact-field">
            <label>交易场景</label>
            <select id="detailTradeType">${classificationSelectOptions("trade_type", campaign.trade_type)}</select>
          </div>
          <div class="field compact-field">
            <label>交易策略</label>
            <select id="detailStrategy">${classificationSelectOptions("strategy", campaign.strategy)}</select>
          </div>
        </div>
        ${customFieldInputs ? `<div class="field-grid">${customFieldInputs}</div>` : ""}
        <div class="field">
          <label>复盘</label>
          <textarea id="detailReview" class="review-editor" maxlength="10000" placeholder="记录入场依据、执行过程、风险控制与改进计划">${escapeHtml(campaign.review_text || "")}</textarea>
        </div>
        <div class="detail-actions">
          <button id="saveReview" class="primary-btn">保存组合复盘</button>
        </div>
      </div>
    `;
    bindDetailInteractions(trade);
  }

  function renderPositionDetail() {
    const node = getElement("orderDetail");
    if (!node) return;
    const { campaign, position, trade, customFields } = getState();
    if (!campaign || !position) return;
    const customFieldInputs = customFields
      .map(
        (field) => `
          <div class="field compact-field">
            <label>${escapeHtml(field.name)}</label>
            ${trade ? renderCustomValueEditor(trade, field, "detail") : `<span class="muted-mini">暂无来源订单</span>`}
          </div>
        `,
      )
      .join("");
    const exits = (position.exit_deals || [])
      .map((deal) => `<li><span>${formatBeijingDateTime(deal.time_utc)}</span><strong>${Number(deal.volume || 0).toFixed(2)} 手 @ ${formatPrice(deal.price)}</strong></li>`)
      .join("");
    node.innerHTML = `
      <div class="detail-body dense-detail position-detail">
        <div class="detail-title">
          <div>
            <p class="eyebrow">${escapeHtml(campaign.symbol)} · Position ${escapeHtml(position.display_position_id || position.position_id)}</p>
            <h2>${campaign.side === "long" ? "多单" : "空单"} · 单笔订单</h2>
            <span class="detail-time">${escapeHtml(formatBeijingDateTime(position.opened_at_utc))} → ${escapeHtml(formatBeijingDateTime(position.closed_at_utc))}</span>
          </div>
          <strong class="${profitClass(position.position_pnl)}">${formatMoney(position.position_pnl ?? 0)}</strong>
        </div>
        <div class="position-detail-metrics">
          <span>入场 <strong>${formatPrice(position.weighted_entry_price)}</strong> · ${formatVolume(position.entry_volume)} 手</span>
          <span>出场 <strong>${formatPrice(position.weighted_exit_price)}</strong> · ${formatVolume(position.exit_volume)} 手</span>
          <span>持仓 <strong>${escapeHtml(formatHoldingTime(position.holding_seconds))}</strong></span>
          <span>R <strong>${escapeHtml(positionR(position))}</strong></span>
        </div>
        <div class="position-plan-risk"><span>初始计划止损</span><strong>${escapeHtml(formatPrice(position.initial_stop_price))}</strong><small>在左侧订单流水中填写或修改</small></div>
        ${trade ? renderScreenshotEditor(trade) : ""}
        <div class="field-grid classification-grid">
          <div class="field compact-field"><label>交易场景</label><select id="detailTradeType">${classificationSelectOptions("trade_type", trade?.trade_type || campaign.trade_type)}</select></div>
          <div class="field compact-field"><label>交易策略</label><select id="detailStrategy">${classificationSelectOptions("strategy", trade?.strategy || campaign.strategy)}</select></div>
        </div>
        ${customFieldInputs ? `<div class="field-grid">${customFieldInputs}</div>` : ""}
        <ul class="position-exits">${exits || "<li><span>尚未平仓</span></li>"}</ul>
        <div class="field"><label>复盘</label><textarea id="detailReview" class="review-editor" maxlength="10000" placeholder="记录入场依据、执行过程、风险控制与改进计划">${escapeHtml(trade?.review_text || "")}</textarea></div>
        <div class="detail-actions"><button id="saveReview" class="primary-btn">保存订单复盘</button></div>
      </div>
    `;
    bindDetailInteractions(trade);
  }

  function bindDetailInteractions(trade) {
    getElement("saveReview")?.addEventListener("click", saveReview);
    getElement("detailShot")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const src = event.currentTarget?.dataset?.shot;
      if (src) openImageModal(src);
    });
    if (trade) bindScreenshotEditor(trade);
    bindCustomValueInputs();
    bindChoiceTriggers();
  }

  function openImageModal(src) {
    if (!src) return;
    const modal = getElement("imageModal");
    const image = getElement("modalImage");
    if (modal) {
      modal.classList?.add?.("open");
      modal.setAttribute?.("aria-hidden", "false");
    }
    if (image) image.src = src;
  }

  function render() {
    const { position, detail } = getState();
    if (position && detail) renderPositionDetail();
    else renderCampaignDetail();
  }

  function dispose() {}

  return { render, renderCampaignDetail, renderPositionDetail, saveReview, dispose };
}
