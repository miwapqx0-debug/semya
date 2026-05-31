let csrfToken = null;

const DEFAULT_AVATAR = "/pic/avatar-default.jpg";

function avatarUrl(path) {
  return path || DEFAULT_AVATAR;
}

function verifiedBadge(verified) {
  if (!verified) return "";
  return `<img src="/pic/galka.png" alt="официальный" class="verified-badge" width="18" height="18" />`;
}

function iconChip(src, count) {
  return `<span class="chip"><img src="${src}" alt="" /> ${count ?? 0}</span>`;
}

function postImageHtml(imagePath) {
  if (!imagePath) return "";
  return `<img class="post-thumb" src="${escapeHtml(imagePath)}" alt="" loading="lazy" />`;
}

async function api(path, { method = "GET", body, headers } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (method !== "GET") {
    if (!csrfToken) await ensureCsrf();
    opts.headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error("API_ERROR");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureCsrf() {
  const data = await fetch("/api/csrf").then((r) => r.json());
  csrfToken = data.csrfToken;
}

function $(sel, root = document) {
  return root.querySelector(sel);
}
function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

async function initShell() {
  const sidebar = $(".sidebar");
  const toggle = $("#navToggle");
  if (sidebar && toggle) {
    toggle.addEventListener("click", () => {
      sidebar.classList.toggle("compact");
      localStorage.setItem("navCompact", sidebar.classList.contains("compact") ? "1" : "0");
    });
    if (localStorage.getItem("navCompact") === "1") sidebar.classList.add("compact");
  }

  const here = location.pathname;
  $all(".nav-item").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === here) a.classList.add("active");
  });

  // top actions: create button, auth state
  const me = await api("/api/me");
  const authZone = $("#authZone");
  const profileLink = $("#profileLink");
  const adminLink = $("#adminLink");
  if (profileLink) profileLink.style.display = me.user ? "inline-flex" : "none";
  if (adminLink) adminLink.style.display = me.user && me.user.role === "admin" ? "inline-flex" : "none";

  if (authZone) {
    authZone.innerHTML = "";
    if (!me.user) {
      const login = document.createElement("a");
      login.className = "btn ghost";
      login.href = "/login";
      login.textContent = "Войти";
      const reg = document.createElement("a");
      reg.className = "btn";
      reg.href = "/register";
      reg.textContent = "Регистрация";
      authZone.append(login, reg);
    } else {
      const u = document.createElement("a");
      u.className = "btn ghost";
      u.href = "/profile";
      u.textContent = me.user.username;
      const out = document.createElement("button");
      out.className = "btn";
      out.textContent = "Выйти";
      out.addEventListener("click", async () => {
        await api("/api/auth/logout", { method: "POST" });
        location.href = "/";
      });
      authZone.append(u, out);
    }
  }

  // search
  const search = $("#searchInput");
  const searchBtn = $("#searchBtn");
  if (search && searchBtn) {
    const run = () => {
      const q = search.value.trim();
      const url = new URL(location.origin + "/");
      if (q) url.searchParams.set("q", q);
      location.href = url.pathname + url.search;
    };
    searchBtn.addEventListener("click", run);
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
    });
  }
}

function postCard(p) {
  const el = document.createElement("a");
  el.className = "post";
  el.href = `/post?id=${encodeURIComponent(p.id)}`;
  const body = p.body || "";
  el.innerHTML = `
    <div class="avatar" style="width:52px;height:52px">
      <img alt="" src="${avatarUrl(p.author_avatar)}" />
    </div>
    <div style="flex:1">
      <div class="meta">${fmtDate(p.created_at)} • <span class="username-row">${escapeHtml(p.author_username)}${verifiedBadge(p.author_verified)}</span></div>
      <h3 class="title">${escapeHtml(p.title)}</h3>
      <p class="body">${escapeHtml(body.slice(0, 220))}${body.length > 220 ? "…" : ""}</p>
      ${postImageHtml(p.image_path)}
      <div class="chipbar">
        ${iconChip("/pic/heart.png", p.like_count)}
        ${iconChip("/pic/comments.png", p.comment_count)}
        ${iconChip("/pic/repost.png", p.repost_count)}
      </div>
    </div>
  `;
  return el;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function initIndexLikePage(defaultSort = "new") {
  const list = $("#postList");
  if (!list) return;

  const url = new URL(location.href);
  const q = url.searchParams.get("q") || "";

  let sort = url.searchParams.get("sort") || defaultSort;
  if (!["new", "discussed", "useful"].includes(sort)) sort = "new";

  const tabs = $all("[data-sort]");
  tabs.forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-sort") === sort);
    t.addEventListener("click", () => {
      const u = new URL(location.href);
      u.searchParams.set("sort", t.getAttribute("data-sort"));
      if (q) u.searchParams.set("q", q);
      location.href = u.pathname + u.search;
    });
  });

  const newsOnly = list.dataset.news === "1";
  const newsParam = newsOnly ? "&news=1" : "";
  const data = await api(
    `/api/posts?sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(q)}${newsParam}`
  );
  list.innerHTML = "";
  if (!data.posts.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = q ? "Ничего не найдено по поиску." : "Пока нет постов. Нажмите «Создать»!";
    list.append(empty);
    return;
  }
  data.posts.forEach((p) => list.append(postCard(p)));
}

async function initAuthForms() {
  const loginForm = $("#loginForm");
  const regForm = $("#registerForm");
  const errBox = $("#formError");

  const setErr = (html) => {
    if (!errBox) return;
    errBox.innerHTML = html || "";
  };

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setErr("");
      const login = $("#login")?.value ?? "";
      const password = $("#password")?.value ?? "";
      try {
        await api("/api/auth/login", { method: "POST", body: { login, password } });
        location.href = "/";
      } catch (e2) {
        const msg = e2?.data?.errors?.login || "Ошибка входа";
        setErr(`<div class="error">${escapeHtml(msg)}</div>`);
      }
    });
  }

  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setErr("");
      const username = $("#username")?.value ?? "";
      const email = $("#email")?.value ?? "";
      const password = $("#password")?.value ?? "";
      const password2 = $("#password2")?.value ?? "";
      try {
        await api("/api/auth/register", {
          method: "POST",
          body: { username, email, password, password2 }
        });
        location.href = "/";
      } catch (e2) {
        const errors = e2?.data?.errors || {};
        const lines = Object.values(errors).map((m) => `<div class="error">${escapeHtml(m)}</div>`);
        setErr(lines.join(""));
      }
    });
  }
}

async function initCreate() {
  const form = $("#createForm");
  if (!form) return;
  const me = await api("/api/me");
  if (!me.user) {
    location.href = "/login";
    return;
  }
  const err = $("#createError");
  const setErr = (t) => {
    if (err) err.textContent = t || "";
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setErr("");
    const title = $("#title")?.value ?? "";
    const body = $("#body")?.value ?? "";
    const fd = new FormData();
    fd.append("title", title);
    fd.append("body", body);
    const img = $("#postImage")?.files?.[0];
    if (img) fd.append("image", img);
    try {
      const res = await api("/api/posts", { method: "POST", body: fd });
      location.href = `/post?id=${encodeURIComponent(res.id)}`;
    } catch (e2) {
      setErr("Проверьте заголовок (мин. 3) и текст (мин. 3 символа или добавьте картинку).");
    }
  });
}

async function initPost() {
  const root = $("#postRoot");
  if (!root) return;

  const url = new URL(location.href);
  const id = url.searchParams.get("id");
  if (!id) {
    root.innerHTML = `<div class="card">Не указан пост.</div>`;
    return;
  }

  const me = await api("/api/me");
  const data = await api(`/api/posts/${encodeURIComponent(id)}`);
  const p = data.post;

  root.innerHTML = `
    <div class="card">
      <div style="display:flex; gap:14px; align-items:flex-start">
        <div class="avatar" style="width:64px;height:64px">
          <img alt="" src="${avatarUrl(p.author_avatar)}" />
        </div>
        <div style="flex:1">
          <div class="meta">${fmtDate(p.created_at)} • <span class="username-row">${escapeHtml(p.author_username)}${verifiedBadge(p.author_verified)}</span></div>
          <h2 style="margin:8px 0 10px 0">${escapeHtml(p.title)}</h2>
          <div style="white-space:pre-wrap; line-height:1.5">${escapeHtml(p.body)}</div>
          ${postImageHtml(p.image_path)}
          <div class="post-actions" style="margin-top:14px">
            <button id="likeBtn" class="btn btn-icon ${data.likedByMe ? "primary" : "ghost"}" type="button" title="Нравится">
              <img src="/pic/heart.png" alt="" /><span id="likeCount">${p.like_count}</span>
            </button>
            <button id="commentScrollBtn" class="btn btn-icon ghost" type="button" title="Комментарии">
              <img src="/pic/comments.png" alt="" /><span>${p.comment_count}</span>
            </button>
            <button id="repostBtn" class="btn btn-icon ${data.repostedByMe ? "primary" : "ghost"}" type="button" title="Репост">
              <img src="/pic/repost.png" alt="" /><span id="repostCount">${p.repost_count}</span>
            </button>
            <a class="btn ghost" href="/profile?userId=${p.author_id}">Профиль автора</a>
          </div>
        </div>
      </div>
    </div>
    <div style="height:12px"></div>
    <div class="card">
      <h3 id="commentsTitle" style="margin:0 0 10px 0">Комментарии (${p.comment_count})</h3>
      <div id="commentBox"></div>
      <div style="height:10px"></div>
      ${
        me.user
          ? `<form id="commentForm">
              <div class="field">
                <textarea id="commentBody" class="input" rows="3" placeholder="Написать комментарий..."></textarea>
                <div class="hint">После отправки автор поста получит уведомление.</div>
                <div class="ai-actions">
                  <button type="button" class="btn ghost" id="aiSuggestComment">Предложить ответ (ИИ)</button>
                </div>
                <div id="commentError" class="error"></div>
              </div>
              <button class="btn primary" type="submit">Отправить</button>
            </form>`
          : `<div class="muted">Чтобы комментировать — войдите.</div>`
      }
    </div>
  `;

  const likeBtn = $("#likeBtn");
  if (likeBtn) {
    likeBtn.addEventListener("click", async () => {
      try {
        const res = await api(`/api/posts/${encodeURIComponent(id)}/like`, { method: "POST" });
        $("#likeCount").textContent = String(res.likeCount);
        likeBtn.classList.toggle("primary", !!res.liked);
        likeBtn.classList.toggle("ghost", !res.liked);
      } catch {
        location.href = "/login";
      }
    });
  }

  const repostBtn = $("#repostBtn");
  if (repostBtn) {
    repostBtn.addEventListener("click", async () => {
      try {
        const res = await api(`/api/posts/${encodeURIComponent(id)}/repost`, { method: "POST" });
        $("#repostCount").textContent = String(res.repostCount);
        repostBtn.classList.toggle("primary", !!res.reposted);
        repostBtn.classList.toggle("ghost", !res.reposted);
      } catch {
        location.href = "/login";
      }
    });
  }

  $("#commentScrollBtn")?.addEventListener("click", () => {
    $("#commentForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#commentBody")?.focus();
  });

  const commentBox = $("#commentBox");
  const commentsTitle = $("#commentsTitle");

  function canDeleteComment(c) {
    if (!me.user) return false;
    return (
      me.user.id === c.author_id ||
      me.user.id === p.author_id ||
      me.user.role === "admin"
    );
  }

  function updateCommentCount(count) {
    if (commentsTitle) commentsTitle.textContent = `Комментарии (${count})`;
    const scrollSpan = $("#commentScrollBtn")?.querySelector("span");
    if (scrollSpan) scrollSpan.textContent = String(count);
  }

  function renderComments(comments) {
    if (!commentBox) return;
    commentBox.innerHTML = "";
    updateCommentCount(comments.length);

    if (!comments.length) {
      const e = document.createElement("div");
      e.className = "muted";
      e.textContent = "Комментариев пока нет.";
      commentBox.append(e);
      return;
    }

    comments.forEach((c) => {
      const el = document.createElement("div");
      el.className = "post comment-item";
      el.style.alignItems = "flex-start";
      el.dataset.commentId = String(c.id);
      const deleteBtn = canDeleteComment(c)
        ? `<button type="button" class="btn ghost comment-delete" data-comment-id="${c.id}" style="padding:6px 10px;font-size:12px">Удалить</button>`
        : "";
      el.innerHTML = `
        <div class="avatar" style="width:44px;height:44px"><img alt="" src="${avatarUrl(c.author_avatar)}"></div>
        <div style="flex:1">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px">
            <div class="meta">${fmtDate(c.created_at)} • ${escapeHtml(c.author_username)}</div>
            ${deleteBtn}
          </div>
          <div style="white-space:pre-wrap">${escapeHtml(c.body)}</div>
        </div>
      `;
      commentBox.append(el);
    });

    commentBox.querySelectorAll(".comment-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const commentId = btn.getAttribute("data-comment-id");
        if (!commentId) return;
        if (!confirm("Удалить этот комментарий?")) return;
        try {
          const res = await api(`/api/comments/${encodeURIComponent(commentId)}`, {
            method: "DELETE"
          });
          data.comments = data.comments.filter((c) => String(c.id) !== String(commentId));
          renderComments(data.comments);
          updateCommentCount(res.commentCount);
        } catch (e2) {
          if (e2?.status === 401) location.href = "/login";
          else alert("Не удалось удалить комментарий.");
        }
      });
    });
  }

  renderComments(data.comments);

  const form = $("#commentForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#commentError").textContent = "";
      const body = $("#commentBody")?.value ?? "";
      if (!body.trim()) {
        $("#commentError").textContent = "Введите текст комментария.";
        return;
      }
      await api(`/api/posts/${encodeURIComponent(id)}/comments`, { method: "POST", body: { body } });
      location.reload();
    });
  }

  if (typeof bindPostAiComment === "function") {
    bindPostAiComment(Number(id));
  }
}

async function initProfile() {
  const root = $("#profileRoot");
  if (!root) return;

  const url = new URL(location.href);
  const userId = Number(url.searchParams.get("userId") || 0);
  const me = await api("/api/me");
  const targetId = userId || (me.user ? me.user.id : 0);
  if (!targetId) {
    location.href = "/login";
    return;
  }

  const data = await api(`/api/users/${targetId}`);
  const u = data.user;

  const isMe = me.user && me.user.id === u.id;

  root.innerHTML = `
    <div class="card">
      <div class="profile-head">
        <div class="avatar">
          <img alt="" src="${avatarUrl(u.avatar_path)}" />
        </div>
        <div>
          <div style="font-weight:800; font-size:20px" class="username-row">${escapeHtml(u.username)}${verifiedBadge(u.verified)}</div>
          <div class="muted">@user${u.id}</div>
          <div style="height:8px"></div>
          <div class="muted">${escapeHtml(u.bio || "пока нет описания")}</div>
          <div style="height:10px"></div>
          <div class="counts">
            <div><span class="k">${data.stats.postsCount}</span> <span class="muted">постов</span></div>
            <div><span class="k">${data.stats.followersCount}</span> <span class="muted">подписчиков</span></div>
            <div><span class="k">${data.stats.followingCount}</span> <span class="muted">подписок</span></div>
          </div>
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end">
          ${
            isMe
              ? `<button class="btn" id="editBtn" type="button"><img src="/pic/settings.png" alt="" width="16" height="16" style="vertical-align:middle" /> Редактировать</button>`
              : me.user
                ? `<button class="btn primary" id="followBtn" type="button">${
                    data.isFollowing ? "Отписаться" : "Подписаться"
                  }</button>
                   <a class="btn ghost" href="/messages?to=${u.id}">Сообщение</a>`
                : `<a class="btn primary" href="/login">Войти</a>`
          }
        </div>
      </div>
    </div>
    <div style="height:12px"></div>
    <div class="tabs">
      <button class="tab active" data-tab="posts">
        <span class="icon" style="mask-image:url('/pic/edit.png');-webkit-mask-image:url('/pic/edit.png')" aria-hidden="true"></span>
        Посты
      </button>
      <button class="tab" data-tab="fav">
        <span class="icon" style="mask-image:url('/pic/heart.png');-webkit-mask-image:url('/pic/heart.png')" aria-hidden="true"></span>
        Избранное
      </button>
      <button class="tab" data-tab="reposts">
        <span class="icon" style="mask-image:url('/pic/repost.png');-webkit-mask-image:url('/pic/repost.png')" aria-hidden="true"></span>
        Репосты
      </button>
      <button class="tab" data-tab="rep">
        <span class="icon" style="mask-image:url('/pic/reply.png');-webkit-mask-image:url('/pic/reply.png')" aria-hidden="true"></span>
        Ответы
      </button>
    </div>
    <div id="tabRoot"></div>
  `;

  const tabRoot = $("#tabRoot");
  const tabs = $all(".tab");
  const loadTab = async (key) => {
    tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === key));
    if (!tabRoot) return;
    tabRoot.innerHTML = `<div class="card">Загрузка…</div>`;

    if (!me.user) {
      tabRoot.innerHTML = `<div class="card">Войдите, чтобы увидеть содержимое.</div>`;
      return;
    }
    if (!isMe) {
      tabRoot.innerHTML = `<div class="card">Вкладки доступны только в своём профиле.</div>`;
      return;
    }

    let data2;
    if (key === "posts") data2 = await api("/api/me/posts");
    if (key === "fav") data2 = await api("/api/me/favorites");
    if (key === "reposts") data2 = await api("/api/me/reposts");
    if (key === "rep") data2 = await api("/api/me/replies");

    const wrap = document.createElement("div");
    wrap.className = "list";
    if (!data2?.posts?.length) {
      wrap.append(Object.assign(document.createElement("div"), { className: "card", textContent: "Пусто." }));
    } else {
      data2.posts.forEach((p) => wrap.append(postCard(p)));
    }
    tabRoot.innerHTML = "";
    tabRoot.append(wrap);
  };

  tabs.forEach((t) => t.addEventListener("click", () => loadTab(t.getAttribute("data-tab"))));
  await loadTab("posts");

  const followBtn = $("#followBtn");
  if (followBtn) {
    followBtn.addEventListener("click", async () => {
      try {
        const r = await api(`/api/users/${u.id}/follow`, { method: "POST" });
        followBtn.textContent = r.following ? "Отписаться" : "Подписаться";
        followBtn.classList.toggle("primary", !r.following);
      } catch {
        location.href = "/login";
      }
    });
  }

  const editBtn = $("#editBtn");
  if (editBtn) {
    editBtn.addEventListener("click", () => openEditModal(me.user));
  }
}

function openEditModal(me) {
  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(10,14,28,.45)";
  modal.style.display = "grid";
  modal.style.placeItems = "center";
  modal.style.padding = "18px";
  modal.style.zIndex = "1000";

  modal.innerHTML = `
    <div class="card" style="width:min(560px, 100%)">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div style="font-weight:800; font-size:18px">Редактировать профиль</div>
        <button class="icon-btn" id="closeModal" type="button">✕</button>
      </div>
      <div style="height:12px"></div>
      <form id="profileForm">
        <div class="field">
          <label>Никнейм</label>
          <input class="input" id="p_username" value="${escapeHtml(me.username)}" />
          <div class="hint">3–20 символов</div>
          <div class="error" id="p_err"></div>
        </div>
        <div class="field">
          <label>Описание</label>
          <textarea class="input" id="p_bio" rows="3">${escapeHtml(me.bio || "")}</textarea>
        </div>
        <div class="field">
          <label>Аватар</label>
          <input class="input" id="p_avatar" type="file" accept="image/*" />
          <div class="hint">PNG/JPG до 2MB</div>
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end">
          <button class="btn ghost" id="cancelBtn" type="button">Отмена</button>
          <button class="btn primary" type="submit">Сохранить</button>
        </div>
      </form>
    </div>
  `;

  document.body.append(modal);
  $("#closeModal", modal).addEventListener("click", () => modal.remove());
  $("#cancelBtn", modal).addEventListener("click", () => modal.remove());

  $("#profileForm", modal).addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#p_err", modal).textContent = "";
    const username = $("#p_username", modal).value;
    const bio = $("#p_bio", modal).value;
    try {
      await api("/api/me/profile", { method: "POST", body: { username, bio } });
    } catch (e2) {
      const msg = e2?.data?.errors?.username || "Ошибка";
      $("#p_err", modal).textContent = msg;
      return;
    }

    const file = $("#p_avatar", modal).files?.[0];
    if (file) {
      const fd = new FormData();
      fd.append("avatar", file);
      await api("/api/me/avatar", { method: "POST", body: fd });
    }
    location.reload();
  });
}

async function initMessages() {
  const root = $("#messagesRoot");
  if (!root) return;
  const me = await api("/api/me");
  if (!me.user) {
    location.href = "/login";
    return;
  }

  const url = new URL(location.href);
  const to = Number(url.searchParams.get("to") || 0);

  root.innerHTML = `
    <div class="grid2">
      <div class="card">
        <div style="font-weight:800; margin-bottom:10px">Входящие</div>
        <div id="inbox" class="list"></div>
      </div>
      <div class="card">
        <div style="font-weight:800; margin-bottom:10px">Отправить сообщение</div>
        <form id="sendForm">
          <div class="field">
            <label>Кому (ID пользователя)</label>
            <input class="input" id="toUserId" value="${to ? String(to) : ""}" />
          </div>
          <div class="field">
            <label>Сообщение</label>
            <textarea class="input" id="msgBody" rows="5"></textarea>
            <div class="error" id="msgErr"></div>
          </div>
          <button class="btn primary" type="submit">Отправить</button>
        </form>
      </div>
    </div>
  `;

  const inbox = $("#inbox");
  const inboxData = await api("/api/messages/inbox");
  inbox.innerHTML = "";
  if (!inboxData.messages.length) {
    inbox.append(Object.assign(document.createElement("div"), { className: "muted", textContent: "Сообщений нет." }));
  } else {
    inboxData.messages.forEach((m) => {
      const el = document.createElement("div");
      el.className = "post";
      el.innerHTML = `
        <div class="avatar" style="width:44px;height:44px"><img alt="" src="${avatarUrl(m.from_avatar)}"></div>
        <div style="flex:1">
          <div class="meta">${fmtDate(m.created_at)} • ${escapeHtml(m.from_username)}</div>
          <div style="white-space:pre-wrap">${escapeHtml(m.body)}</div>
        </div>
      `;
      inbox.append(el);
    });
  }

  $("#sendForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#msgErr").textContent = "";
    const toUserId = Number($("#toUserId").value);
    const body = $("#msgBody").value;
    try {
      await api("/api/messages/send", { method: "POST", body: { toUserId, body } });
      $("#msgBody").value = "";
      location.reload();
    } catch {
      $("#msgErr").textContent = "Проверьте ID пользователя и текст сообщения.";
    }
  });
}

async function initNotifications() {
  const root = $("#notifsRoot");
  if (!root) return;
  const me = await api("/api/me");
  if (!me.user) {
    location.href = "/login";
    return;
  }

  const data = await api("/api/notifications");
  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center">
      <div style="font-weight:800">Уведомления</div>
      <button class="btn" id="markRead" type="button">Отметить прочитанным</button>
    </div>
    <div style="height:12px"></div>
    <div class="list" id="notifsList"></div>
  `;
  $("#markRead").addEventListener("click", async () => {
    await api("/api/notifications/read", { method: "POST" });
    location.reload();
  });

  const list = $("#notifsList");
  list.innerHTML = "";
  if (!data.notifications.length) {
    list.append(Object.assign(document.createElement("div"), { className: "card", textContent: "Уведомлений нет." }));
    return;
  }

  data.notifications.forEach((n) => {
    const el = document.createElement("div");
    el.className = "card";
    const badge = n.read_at ? "прочитано" : "новое";
    let text = "";
    if (n.type === "like") text = `Кто-то лайкнул ваш пост #${n.payload?.postId}`;
    if (n.type === "comment") text = `Новый комментарий к посту #${n.payload?.postId}`;
    if (n.type === "admin") text = `Сообщение от админа: ${n.payload?.message || ""}`;
    if (n.type === "message") text = `Новое личное сообщение`;
    if (n.type === "repost") text = `Кто-то сделал репост вашего поста #${n.payload?.postId}`;
    el.innerHTML = `
      <div class="meta">${fmtDate(n.created_at)} • <span class="muted">${badge}</span></div>
      <div style="margin-top:6px">${escapeHtml(text)}</div>
    `;
    list.append(el);
  });
}

async function initAdmin() {
  const root = $("#adminRoot");
  if (!root) return;

  const me = await api("/api/me");
  if (!me.user) {
    location.href = "/login";
    return;
  }
  if (me.user.role !== "admin") {
    root.innerHTML = `<div class="card">Доступ запрещён.</div>`;
    return;
  }

  const ov = await api("/api/admin/overview");
  const users = await api("/api/admin/users");
  root.innerHTML = `
    <div class="grid2">
      <div class="card">
        <div style="font-weight:800; margin-bottom:10px">Статистика</div>
        <div class="chipbar">
          <span class="chip">Пользователи: ${ov.users}</span>
          <span class="chip">Посты: ${ov.posts}</span>
          <span class="chip">Комментарии: ${ov.comments}</span>
        </div>
        <div style="height:12px"></div>
        <div style="font-weight:800; margin-bottom:10px">Уведомление от админа</div>
        <form id="adminNotify">
          <div class="field">
            <label>Кому (ID, пусто = всем)</label>
            <input class="input" id="admUserId" />
          </div>
          <div class="field">
            <label>Текст</label>
            <textarea class="input" id="admMsg" rows="3"></textarea>
            <div class="error" id="admErr"></div>
          </div>
          <button class="btn primary" type="submit">Отправить</button>
        </form>
      </div>
      <div class="card">
        <div style="font-weight:800; margin-bottom:10px">Пользователи</div>
        <div style="max-height:520px; overflow:auto; display:flex; flex-direction:column; gap:10px" id="admUsers"></div>
      </div>
    </div>
  `;

  const list = $("#admUsers");
  users.users.forEach((u) => {
    const el = document.createElement("div");
    el.className = "post";
    el.style.alignItems = "center";
    el.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:700">${escapeHtml(u.username)} <span class="muted">#${u.id}</span></div>
        <div class="meta">${escapeHtml(u.email)} • ${escapeHtml(u.role)} • ${fmtDate(u.created_at)}</div>
      </div>
      <a class="btn ghost" href="/profile?userId=${u.id}">Открыть</a>
    `;
    list.append(el);
  });

  $("#adminNotify").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#admErr").textContent = "";
    const userId = Number($("#admUserId").value) || 0;
    const message = $("#admMsg").value;
    try {
      await api("/api/admin/notify", { method: "POST", body: { userId, message } });
      $("#admMsg").value = "";
      alert("Отправлено");
    } catch {
      $("#admErr").textContent = "Не удалось отправить.";
    }
  });
}

function loadAiAssets() {
  if (!document.querySelector('link[href="/assets/ai.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/ai.css";
    document.head.append(link);
  }
  if (typeof initAi === "function") {
    initAi();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (document.querySelector('script[src="/assets/ai.js"]')) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "/assets/ai.js";
    s.onload = () => {
      if (typeof initAi === "function") initAi();
      resolve();
    };
    document.body.append(s);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await initShell();
  await Promise.all([
    initIndexLikePage("new"),
    initAuthForms(),
    initCreate(),
    initPost(),
    initProfile(),
    initMessages(),
    initNotifications(),
    initAdmin()
  ]);
  await loadAiAssets();
});

