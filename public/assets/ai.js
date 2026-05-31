/** ИИ-помощник форума (использует api() из app.js) */

function aiEscape(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

let aiStatusCache = null;

async function fetchAiStatus() {
  if (aiStatusCache) return aiStatusCache;
  try {
    aiStatusCache = await api("/api/ai/status");
  } catch {
    aiStatusCache = { configured: false };
  }
  return aiStatusCache;
}

function appendAiMessage(container, role, text) {
  const el = document.createElement("div");
  el.className = `ai-msg ${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function injectAiWidget() {
  if (document.getElementById("aiFab")) return;

  const fab = document.createElement("button");
  fab.id = "aiFab";
  fab.className = "ai-fab";
  fab.type = "button";
  fab.title = "ИИ-помощник";
  fab.textContent = "ИИ";

  const panel = document.createElement("div");
  panel.id = "aiPanel";
  panel.className = "ai-panel hidden";
  panel.innerHTML = `
    <div class="ai-panel-head">
      <div>
        <div class="title">ИИ-помощник</div>
        <div class="sub" id="aiPanelSub">Загрузка…</div>
      </div>
      <div style="display:flex;gap:4px">
        <a class="btn ghost" href="/ai" style="padding:6px 10px;font-size:12px">Открыть</a>
        <button type="button" class="icon-btn" id="aiPanelClose">✕</button>
      </div>
    </div>
    <div class="ai-messages" id="aiWidgetMessages"></div>
    <div class="ai-panel-foot">
      <textarea id="aiWidgetInput" rows="2" placeholder="Задайте вопрос…"></textarea>
      <button type="button" class="btn primary" id="aiWidgetSend">→</button>
    </div>
  `;

  document.body.append(fab, panel);

  const messagesEl = panel.querySelector("#aiWidgetMessages");
  const inputEl = panel.querySelector("#aiWidgetInput");
  const subEl = panel.querySelector("#aiPanelSub");
  let history = [];

  fetchAiStatus().then((st) => {
    if (st.configured) {
      subEl.textContent = `Модель: ${st.model || "ИИ"}`;
      appendAiMessage(
        messagesEl,
        "system",
        "Здравствуйте! Я помогу сформулировать пост, ответить на вопрос о форуме или поддержке семьи."
      );
    } else {
      subEl.textContent = "Не настроен";
      appendAiMessage(
        messagesEl,
        "system",
        "ИИ не подключён. Администратору нужно добавить OPENAI_API_KEY в файл .env (см. .env.example)."
      );
      inputEl.disabled = true;
      panel.querySelector("#aiWidgetSend").disabled = true;
    }
  });

  fab.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) inputEl.focus();
  });
  panel.querySelector("#aiPanelClose").addEventListener("click", () => panel.classList.add("hidden"));

  async function sendWidget() {
    const text = inputEl.value.trim();
    if (!text) return;
    const me = await api("/api/me");
    if (!me.user) {
      location.href = "/login";
      return;
    }
    inputEl.value = "";
    appendAiMessage(messagesEl, "user", text);
    history.push({ role: "user", content: text });
    const loading = document.createElement("div");
    loading.className = "ai-loading";
    loading.textContent = "ИИ думает…";
    messagesEl.append(loading);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const res = await api("/api/ai/chat", {
        method: "POST",
        body: { message: text, messages: history.slice(0, -1) }
      });
      loading.remove();
      appendAiMessage(messagesEl, "assistant", res.reply);
      history.push({ role: "assistant", content: res.reply });
    } catch (e) {
      loading.remove();
      const msg = e?.data?.message || "Не удалось получить ответ.";
      appendAiMessage(messagesEl, "system", msg);
    }
  }

  panel.querySelector("#aiWidgetSend").addEventListener("click", sendWidget);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendWidget();
    }
  });
}

async function initAiPage() {
  const root = document.getElementById("aiPageRoot");
  if (!root) return;

  const me = await api("/api/me");
  if (!me.user) {
    location.href = "/login";
    return;
  }

  const st = await fetchAiStatus();
  root.innerHTML = `
    <div class="card ai-page">
      <div style="font-weight:800;font-size:20px;margin-bottom:6px">ИИ-помощник форума «Семья»</div>
      <div class="muted" style="margin-bottom:14px">
        ${
          st.configured
            ? `Подключён реальный ИИ (${aiEscape(st.model || "")}). Задавайте вопросы о семье, поддержке, оформлении постов.`
            : "ИИ не настроен: добавьте OPENAI_API_KEY в файл .env в корне проекта."
        }
      </div>
      <div class="ai-messages chat-box" id="aiPageMessages"></div>
      <div class="ai-panel-foot" style="border:none;padding:10px 0 0">
        <textarea id="aiPageInput" rows="3" placeholder="Напишите сообщение…" ${st.configured ? "" : "disabled"}></textarea>
        <button type="button" class="btn primary" id="aiPageSend" ${st.configured ? "" : "disabled"}>Отправить</button>
      </div>
      <div class="ai-actions">
        <button type="button" class="btn ghost" id="aiClearChat">Очистить чат</button>
        <a class="btn ghost" href="/create">Создать пост</a>
      </div>
    </div>
  `;

  const messagesEl = root.querySelector("#aiPageMessages");
  const inputEl = root.querySelector("#aiPageInput");
  let history = [];

  if (st.configured) {
    appendAiMessage(messagesEl, "system", "Чем могу помочь? Могу подсказать текст поста, ответить на вопрос или объяснить правила форума.");
  }

  root.querySelector("#aiClearChat")?.addEventListener("click", () => {
    history = [];
    messagesEl.innerHTML = "";
    if (st.configured) {
      appendAiMessage(messagesEl, "system", "Чат очищен. Задайте новый вопрос.");
    }
  });

  async function sendPage() {
    const text = inputEl.value.trim();
    if (!text) return;
    appendAiMessage(messagesEl, "user", text);
    history.push({ role: "user", content: text });
    inputEl.value = "";
    const loading = document.createElement("div");
    loading.className = "ai-loading";
    loading.textContent = "ИИ думает…";
    messagesEl.append(loading);

    try {
      const res = await api("/api/ai/chat", {
        method: "POST",
        body: { message: text, messages: history.slice(0, -1) }
      });
      loading.remove();
      appendAiMessage(messagesEl, "assistant", res.reply);
      history.push({ role: "assistant", content: res.reply });
    } catch (e) {
      loading.remove();
      appendAiMessage(messagesEl, "system", e?.data?.message || "Ошибка ИИ");
    }
  }

  root.querySelector("#aiPageSend").addEventListener("click", sendPage);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendPage();
    }
  });
}

async function bindCreateAiButtons() {
  const improveBtn = document.getElementById("aiImprovePost");
  const titleBtn = document.getElementById("aiSuggestTitle");
  if (!improveBtn && !titleBtn) return;
  if (improveBtn?.dataset.aiBound) return;
  if (improveBtn) improveBtn.dataset.aiBound = "1";

  const st = await fetchAiStatus();
  if (!st.configured) {
    [improveBtn, titleBtn].filter(Boolean).forEach((b) => {
      b.disabled = true;
      b.title = "Настройте OPENAI_API_KEY в .env";
    });
    return;
  }

  async function runImprove() {
    const title = document.getElementById("title")?.value ?? "";
    const body = document.getElementById("body")?.value ?? "";
    if (!title && !body) {
      alert("Сначала напишите заголовок или текст.");
      return;
    }
    improveBtn.disabled = true;
    improveBtn.textContent = "ИИ работает…";
    try {
      const res = await api("/api/ai/improve-post", {
        method: "POST",
        body: { title, body }
      });
      document.getElementById("title").value = res.title;
      document.getElementById("body").value = res.body;
    } catch (e) {
      alert(e?.data?.message || "Ошибка ИИ");
    } finally {
      improveBtn.disabled = false;
      improveBtn.textContent = "Улучшить текст с ИИ";
    }
  }

  improveBtn?.addEventListener("click", runImprove);
  titleBtn?.addEventListener("click", async () => {
    const body = document.getElementById("body")?.value ?? "";
    if (!body) {
      alert("Сначала напишите текст поста.");
      return;
    }
    titleBtn.disabled = true;
    try {
      const res = await api("/api/ai/improve-post", {
        method: "POST",
        body: { title: "", body }
      });
      document.getElementById("title").value = res.title;
    } catch (e) {
      alert(e?.data?.message || "Ошибка ИИ");
    } finally {
      titleBtn.disabled = false;
    }
  });
}

async function bindPostAiComment(postId) {
  const btn = document.getElementById("aiSuggestComment");
  const textarea = document.getElementById("commentBody");
  if (!btn || !textarea) return;
  if (btn.dataset.aiBound) return;
  btn.dataset.aiBound = "1";

  const st = await fetchAiStatus();
  if (!st.configured) {
    btn.disabled = true;
    btn.title = "Настройте OPENAI_API_KEY в .env";
    return;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "ИИ…";
    try {
      const res = await api("/api/ai/suggest-comment", {
        method: "POST",
        body: { postId, draft: textarea.value }
      });
      textarea.value = res.suggestion;
    } catch (e) {
      alert(e?.data?.message || "Ошибка ИИ");
    } finally {
      btn.disabled = false;
      btn.textContent = "Предложить ответ (ИИ)";
    }
  });
}

function initAi() {
  injectAiWidget();
  initAiPage();
  bindCreateAiButtons();
}
