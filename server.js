require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const csrf = require("csurf");

const { openDb, initDb, nowMs } = require("./db/db");
const aiService = require("./ai/aiService");

const app = express();
const db = openDb();
initDb(db);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// Rate-limit only API (do not block static assets/pages)
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300
  })
);

const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 25,
  message: { error: "AI_RATE_LIMIT", message: "Слишком много запросов к ИИ. Подождите минуту." }
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

const csrfProtection = csrf({ cookie: true });

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

function multerStorage(subdir) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(PUBLIC_DIR, "uploads", subdir);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const safe = String(file.originalname || "file")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "_")
        .slice(-80);
      cb(null, `${Date.now()}_${safe}`);
    }
  });
}

const upload = multer({
  storage: multerStorage("avatars"),
  limits: { fileSize: 2 * 1024 * 1024 }
});

const uploadPost = multer({
  storage: multerStorage("posts"),
  limits: { fileSize: 5 * 1024 * 1024 }
});

function toPublicAvatarPath(filename) {
  return `/uploads/avatars/${filename}`;
}

function toPublicPostImagePath(filename) {
  return `/uploads/posts/${filename}`;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  next();
}

function requireAdmin(req, res, next) {
  const u = getUserById(req.session.userId);
  if (!u || u.role !== "admin") return res.status(403).json({ error: "FORBIDDEN" });
  next();
}

function getUserById(id) {
  return db
    .prepare(
      "SELECT id, username, email, bio, avatar_path, role, verified, created_at FROM users WHERE id = ?"
    )
    .get(id);
}

function sanitizeText(s, maxLen) {
  const str = String(s ?? "").trim();
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function validateEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) return null;
  if (e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function validateUsername(username) {
  const u = String(username ?? "").trim();
  if (!u) return null;
  if (u.length < 3 || u.length > 20) return null;
  if (!/^[a-zA-Z0-9_а-яА-ЯёЁ.-]+$/.test(u)) return null;
  return u;
}

function addNotification(userId, type, payload) {
  db.prepare(
    "INSERT INTO notifications (user_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, type, JSON.stringify(payload ?? {}), nowMs());
}

// ---- API: session/meta ----
app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  return res.json({ user: getUserById(req.session.userId) });
});

app.get("/api/csrf", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ---- API: auth ----
app.post("/api/auth/register", csrfProtection, (req, res) => {
  const username = validateUsername(req.body.username);
  const email = validateEmail(req.body.email);
  const password = String(req.body.password ?? "");
  const password2 = String(req.body.password2 ?? "");

  const errors = {};
  if (!username) errors.username = "Никнейм: 3–20 символов, буквы/цифры/._-";
  if (!email) errors.email = "Некорректная почта";
  if (password.length < 8) errors.password = "Пароль минимум 8 символов";
  if (password !== password2) errors.password2 = "Пароли не совпадают";
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare("INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(username, email, hash, nowMs());
    req.session.userId = info.lastInsertRowid;
    return res.json({ ok: true, user: getUserById(req.session.userId) });
  } catch (e) {
    const msg = String(e && e.message ? e.message : "");
    if (msg.includes("UNIQUE") && msg.includes("users.username"))
      return res.status(409).json({ errors: { username: "Никнейм уже занят" } });
    if (msg.includes("UNIQUE") && msg.includes("users.email"))
      return res.status(409).json({ errors: { email: "Почта уже занята" } });
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.post("/api/auth/login", csrfProtection, (req, res) => {
  const login = String(req.body.login ?? "").trim();
  const password = String(req.body.password ?? "");

  const user = db
    .prepare(
      "SELECT id, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1"
    )
    .get(login, login.toLowerCase());
  if (!user) return res.status(400).json({ errors: { login: "Неверный логин или пароль" } });
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(400).json({ errors: { login: "Неверный логин или пароль" } });
  req.session.userId = user.id;
  return res.json({ ok: true, user: getUserById(user.id) });
});

app.post("/api/auth/logout", csrfProtection, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---- API: posts ----
function buildPostListQuery({ q, sort, newsOnly }) {
  const params = {};
  const parts = ["1=1"];
  if (q) {
    parts.push("(p.title LIKE @q OR p.body LIKE @q)");
    params.q = `%${q}%`;
  }
  if (newsOnly) parts.push("u.verified = 1");
  const where = parts.join(" AND ");

  let orderBy = "p.created_at DESC";
  if (sort === "discussed") orderBy = "comment_count DESC, p.created_at DESC";
  if (sort === "useful") orderBy = "like_count DESC, p.created_at DESC";

  const sql = `
    SELECT
      p.id,
      p.title,
      p.body,
      p.image_path,
      p.created_at,
      p.updated_at,
      u.id AS author_id,
      u.username AS author_username,
      u.avatar_path AS author_avatar,
      u.verified AS author_verified,
      COALESCE(l.like_count, 0) AS like_count,
      COALESCE(c.comment_count, 0) AS comment_count,
      COALESCE(r.repost_count, 0) AS repost_count
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN (
      SELECT post_id, COUNT(*) AS like_count FROM post_likes GROUP BY post_id
    ) l ON l.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id
    ) c ON c.post_id = p.id
    LEFT JOIN (
      SELECT post_id, COUNT(*) AS repost_count FROM post_reposts GROUP BY post_id
    ) r ON r.post_id = p.id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT 50
  `;

  return { sql, params };
}

app.get("/api/posts", (req, res) => {
  const q = sanitizeText(req.query.q, 80);
  const sort = String(req.query.sort ?? "new");
  const newsOnly = req.query.news === "1";
  const { sql, params } = buildPostListQuery({ q, sort, newsOnly });
  const posts = db.prepare(sql).all(params);
  res.json({ posts });
});

app.get("/api/posts/:id", (req, res) => {
  const id = Number(req.params.id);
  const post = db
    .prepare(
      `
      SELECT p.*, u.username AS author_username, u.avatar_path AS author_avatar,
        u.verified AS author_verified,
        (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        (SELECT COUNT(*) FROM post_reposts pr WHERE pr.post_id = p.id) AS repost_count
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.id = ?
    `
    )
    .get(id);
  if (!post) return res.status(404).json({ error: "NOT_FOUND" });

  const comments = db
    .prepare(
      `
      SELECT c.id, c.body, c.created_at,
        u.id AS author_id, u.username AS author_username, u.avatar_path AS author_avatar
      FROM comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.post_id = ?
      ORDER BY c.created_at DESC
    `
    )
    .all(id);

  const likedByMe = req.session.userId
    ? !!db
        .prepare("SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?")
        .get(req.session.userId, id)
    : false;

  const repostedByMe = req.session.userId
    ? !!db
        .prepare("SELECT 1 FROM post_reposts WHERE user_id = ? AND post_id = ?")
        .get(req.session.userId, id)
    : false;

  res.json({ post, comments, likedByMe, repostedByMe });
});

app.post(
  "/api/posts",
  csrfProtection,
  requireAuth,
  uploadPost.single("image"),
  (req, res) => {
    const title = sanitizeText(req.body.title, 120);
    const body = sanitizeText(req.body.body, 10000);
    if (!title || title.length < 3) return res.status(400).json({ error: "TITLE_REQUIRED" });
    const hasImage = !!req.file;
    if ((!body || body.length < 3) && !hasImage) {
      return res.status(400).json({ error: "BODY_REQUIRED" });
    }

    const imagePath = req.file ? toPublicPostImagePath(req.file.filename) : "";
    const ts = nowMs();
    const info = db
      .prepare(
        "INSERT INTO posts (author_id, title, body, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(req.session.userId, title, body || "", imagePath, ts, ts);
    res.json({ ok: true, id: info.lastInsertRowid });
  }
);

app.post("/api/posts/:id/comments", csrfProtection, requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const body = sanitizeText(req.body.body, 3000);
  if (!body || body.length < 1) return res.status(400).json({ error: "BODY_REQUIRED" });
  const post = db.prepare("SELECT id, author_id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "NOT_FOUND" });

  const info = db
    .prepare("INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(postId, req.session.userId, body, nowMs());

  if (post.author_id !== req.session.userId) {
    addNotification(post.author_id, "comment", {
      postId,
      commentId: info.lastInsertRowid,
      fromUserId: req.session.userId
    });
  }

  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete("/api/comments/:id", csrfProtection, requireAuth, (req, res) => {
  const commentId = Number(req.params.id);
  const comment = db
    .prepare(
      `
      SELECT c.id, c.post_id, c.author_id, p.author_id AS post_author_id
      FROM comments c
      JOIN posts p ON p.id = c.post_id
      WHERE c.id = ?
    `
    )
    .get(commentId);
  if (!comment) return res.status(404).json({ error: "NOT_FOUND" });

  const me = getUserById(req.session.userId);
  const canDelete =
    comment.author_id === req.session.userId ||
    comment.post_author_id === req.session.userId ||
    me.role === "admin";

  if (!canDelete) return res.status(403).json({ error: "FORBIDDEN" });

  db.prepare("DELETE FROM comments WHERE id = ?").run(commentId);
  const commentCount = db
    .prepare("SELECT COUNT(*) AS c FROM comments WHERE post_id = ?")
    .get(comment.post_id).c;
  res.json({ ok: true, commentCount, postId: comment.post_id });
});

app.post("/api/posts/:id/like", csrfProtection, requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare("SELECT id, author_id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "NOT_FOUND" });

  const existing = db
    .prepare("SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?")
    .get(req.session.userId, postId);

  const ts = nowMs();
  if (existing) {
    db.prepare("DELETE FROM post_likes WHERE user_id = ? AND post_id = ?").run(
      req.session.userId,
      postId
    );
  } else {
    db.prepare("INSERT INTO post_likes (user_id, post_id, created_at) VALUES (?, ?, ?)").run(
      req.session.userId,
      postId,
      ts
    );
    if (post.author_id !== req.session.userId) {
      addNotification(post.author_id, "like", { postId, fromUserId: req.session.userId });
    }
  }

  const likeCount = db.prepare("SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?").get(postId)
    .c;
  res.json({ ok: true, liked: !existing, likeCount });
});

app.post("/api/posts/:id/repost", csrfProtection, requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare("SELECT id, author_id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "NOT_FOUND" });

  const existing = db
    .prepare("SELECT 1 FROM post_reposts WHERE user_id = ? AND post_id = ?")
    .get(req.session.userId, postId);

  const ts = nowMs();
  if (existing) {
    db.prepare("DELETE FROM post_reposts WHERE user_id = ? AND post_id = ?").run(
      req.session.userId,
      postId
    );
  } else {
    db.prepare("INSERT INTO post_reposts (user_id, post_id, created_at) VALUES (?, ?, ?)").run(
      req.session.userId,
      postId,
      ts
    );
    if (post.author_id !== req.session.userId) {
      addNotification(post.author_id, "repost", { postId, fromUserId: req.session.userId });
    }
  }

  const repostCount = db
    .prepare("SELECT COUNT(*) AS c FROM post_reposts WHERE post_id = ?")
    .get(postId).c;
  res.json({ ok: true, reposted: !existing, repostCount });
});

// ---- API: profile ----
app.get("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: "NOT_FOUND" });

  const postsCount = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE author_id = ?").get(id).c;
  const followersCount = db
    .prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?")
    .get(id).c;
  const followingCount = db
    .prepare("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?")
    .get(id).c;

  const isFollowing =
    req.session.userId && req.session.userId !== id
      ? !!db
          .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?")
          .get(req.session.userId, id)
      : false;

  res.json({ user, stats: { postsCount, followersCount, followingCount }, isFollowing });
});

app.post("/api/me/profile", csrfProtection, requireAuth, (req, res) => {
  const username = validateUsername(req.body.username);
  const bio = sanitizeText(req.body.bio, 280);

  const errors = {};
  if (!username) errors.username = "Никнейм: 3–20 символов, буквы/цифры/._-";
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  try {
    db.prepare("UPDATE users SET username = ?, bio = ? WHERE id = ?").run(
      username,
      bio ?? "",
      req.session.userId
    );
  } catch (e) {
    const msg = String(e && e.message ? e.message : "");
    if (msg.includes("UNIQUE") && msg.includes("users.username"))
      return res.status(409).json({ errors: { username: "Никнейм уже занят" } });
    return res.status(500).json({ error: "SERVER_ERROR" });
  }

  res.json({ ok: true, user: getUserById(req.session.userId) });
});

app.post(
  "/api/me/avatar",
  csrfProtection,
  requireAuth,
  upload.single("avatar"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "NO_FILE" });
    const avatarPath = toPublicAvatarPath(req.file.filename);
    db.prepare("UPDATE users SET avatar_path = ? WHERE id = ?").run(avatarPath, req.session.userId);
    res.json({ ok: true, user: getUserById(req.session.userId) });
  }
);

app.post("/api/users/:id/follow", csrfProtection, requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.session.userId) return res.status(400).json({ error: "BAD_REQUEST" });
  const exists = getUserById(targetId);
  if (!exists) return res.status(404).json({ error: "NOT_FOUND" });

  const row = db
    .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?")
    .get(req.session.userId, targetId);
  if (row) {
    db.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?").run(
      req.session.userId,
      targetId
    );
    return res.json({ ok: true, following: false });
  }
  db.prepare("INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)").run(
    req.session.userId,
    targetId,
    nowMs()
  );
  res.json({ ok: true, following: true });
});

// ---- API: user tabs ----
const profilePostSelect = `
  p.id, p.title, p.body, p.image_path, p.created_at,
  u.id AS author_id,
  u.username AS author_username,
  u.avatar_path AS author_avatar,
  u.verified AS author_verified,
  (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
  (SELECT COUNT(*) FROM post_reposts WHERE post_id = p.id) AS repost_count
`;

app.get("/api/me/posts", requireAuth, (req, res) => {
  const posts = db
    .prepare(
      `
      SELECT ${profilePostSelect}
      FROM posts p
      JOIN users u ON u.id = p.author_id
      WHERE p.author_id = ?
      ORDER BY p.created_at DESC
      LIMIT 50
    `
    )
    .all(req.session.userId);
  res.json({ posts });
});

app.get("/api/me/favorites", requireAuth, (req, res) => {
  const posts = db
    .prepare(
      `
      SELECT ${profilePostSelect}
      FROM post_likes pl
      JOIN posts p ON p.id = pl.post_id
      JOIN users u ON u.id = p.author_id
      WHERE pl.user_id = ?
      ORDER BY pl.created_at DESC
      LIMIT 50
    `
    )
    .all(req.session.userId);
  res.json({ posts });
});

app.get("/api/me/reposts", requireAuth, (req, res) => {
  const posts = db
    .prepare(
      `
      SELECT ${profilePostSelect}
      FROM post_reposts pr
      JOIN posts p ON p.id = pr.post_id
      JOIN users u ON u.id = p.author_id
      WHERE pr.user_id = ?
      ORDER BY pr.created_at DESC
      LIMIT 50
    `
    )
    .all(req.session.userId);
  res.json({ posts });
});

app.get("/api/me/replies", requireAuth, (req, res) => {
  const posts = db
    .prepare(
      `
      SELECT ${profilePostSelect}
      FROM comments c
      JOIN posts p ON p.id = c.post_id
      JOIN users u ON u.id = p.author_id
      WHERE c.author_id = ?
      GROUP BY p.id
      ORDER BY MAX(c.created_at) DESC
      LIMIT 50
    `
    )
    .all(req.session.userId);
  res.json({ posts });
});

// ---- API: messages ----
app.get("/api/messages/inbox", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT m.id, m.from_user_id, m.to_user_id, m.body, m.created_at, m.read_at,
        uf.username AS from_username, uf.avatar_path AS from_avatar
      FROM messages m
      JOIN users uf ON uf.id = m.from_user_id
      WHERE m.to_user_id = ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `
    )
    .all(req.session.userId);
  res.json({ messages: rows });
});

app.post("/api/messages/send", csrfProtection, requireAuth, (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const body = sanitizeText(req.body.body, 2000);
  if (!toUserId || !getUserById(toUserId)) return res.status(404).json({ error: "NOT_FOUND" });
  if (!body) return res.status(400).json({ error: "BODY_REQUIRED" });

  const id = db
    .prepare("INSERT INTO messages (from_user_id, to_user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(req.session.userId, toUserId, body, nowMs()).lastInsertRowid;

  addNotification(toUserId, "message", { messageId: id, fromUserId: req.session.userId });
  res.json({ ok: true, id });
});

// ---- API: notifications ----
app.get("/api/notifications", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT id, type, payload_json, created_at, read_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `
    )
    .all(req.session.userId)
    .map((r) => ({ ...r, payload: safeJsonParse(r.payload_json) }));
  res.json({ notifications: rows });
});

app.post("/api/notifications/read", csrfProtection, requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(
    nowMs(),
    req.session.userId
  );
  res.json({ ok: true });
});

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// ---- API: admin ----
app.get("/api/admin/overview", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const posts = db.prepare("SELECT COUNT(*) AS c FROM posts").get().c;
  const comments = db.prepare("SELECT COUNT(*) AS c FROM comments").get().c;
  res.json({ users, posts, comments });
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 200")
    .all();
  res.json({ users: rows });
});

app.post("/api/admin/notify", csrfProtection, requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.body.userId);
  const message = sanitizeText(req.body.message, 500);
  if (!message) return res.status(400).json({ error: "MESSAGE_REQUIRED" });
  if (userId) {
    if (!getUserById(userId)) return res.status(404).json({ error: "NOT_FOUND" });
    addNotification(userId, "admin", { message });
  } else {
    const all = db.prepare("SELECT id FROM users").all().map((r) => r.id);
    const insert = db.prepare(
      "INSERT INTO notifications (user_id, type, payload_json, created_at) VALUES (?, 'admin', ?, ?)"
    );
    const payload = JSON.stringify({ message });
    const ts = nowMs();
    const tx = db.transaction(() => {
      for (const id of all) insert.run(id, payload, ts);
    });
    tx();
  }
  res.json({ ok: true });
});

// ---- API: AI ----
app.get("/api/ai/status", (req, res) => {
  const cfg = aiService.getConfig();
  res.json({
    configured: cfg.configured,
    model: cfg.configured ? cfg.model : null
  });
});

app.post("/api/ai/chat", aiRateLimit, csrfProtection, requireAuth, async (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  const last = sanitizeText(req.body.message, 2000);
  if (!last) return res.status(400).json({ error: "MESSAGE_REQUIRED" });

  const history = messages
    .slice(-12)
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: sanitizeText(m.content, 2000)
    }))
    .filter((m) => m.content);

  try {
    const reply = await aiService.chat([...history, { role: "user", content: last }]);
    res.json({ ok: true, reply });
  } catch (e) {
    return aiError(res, e);
  }
});

app.post("/api/ai/improve-post", aiRateLimit, csrfProtection, requireAuth, async (req, res) => {
  const title = sanitizeText(req.body.title, 120);
  const body = sanitizeText(req.body.body, 10000);
  if (!title && !body) return res.status(400).json({ error: "EMPTY" });
  try {
    const result = await aiService.improvePost(title, body);
    res.json({ ok: true, ...result });
  } catch (e) {
    return aiError(res, e);
  }
});

app.post("/api/ai/suggest-comment", aiRateLimit, csrfProtection, requireAuth, async (req, res) => {
  const postId = Number(req.body.postId);
  const draft = sanitizeText(req.body.draft, 500);
  const post = db.prepare("SELECT title, body FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "NOT_FOUND" });
  try {
    const suggestion = await aiService.suggestComment(post.title, post.body, draft);
    res.json({ ok: true, suggestion });
  } catch (e) {
    return aiError(res, e);
  }
});

function aiError(res, e) {
  if (e.code === "AI_NOT_CONFIGURED") {
    return res.status(503).json({
      error: "AI_NOT_CONFIGURED",
      message:
        "ИИ не настроен. Создайте файл .env и укажите OPENAI_API_KEY (см. .env.example)."
    });
  }
  return res.status(502).json({
    error: e.code || "AI_ERROR",
    message: e.message || "Ошибка ИИ"
  });
}

// ---- HTML routes (static pages) ----
function sendPage(res, name) {
  res.sendFile(path.join(PUBLIC_DIR, name));
}

app.get("/", (req, res) => sendPage(res, "index.html"));
app.get("/news", (req, res) => sendPage(res, "news.html"));
app.get("/popular", (req, res) => sendPage(res, "popular.html"));
app.get("/social", (req, res) => sendPage(res, "social.html"));
app.get("/rules", (req, res) => sendPage(res, "rules.html"));
app.get("/login", (req, res) => sendPage(res, "login.html"));
app.get("/register", (req, res) => sendPage(res, "register.html"));
app.get("/create", (req, res) => sendPage(res, "create.html"));
app.get("/profile", (req, res) => sendPage(res, "profile.html"));
app.get("/post", (req, res) => sendPage(res, "post.html"));
app.get("/messages", (req, res) => sendPage(res, "messages.html"));
app.get("/notifications", (req, res) => sendPage(res, "notifications.html"));
app.get("/admin", (req, res) => sendPage(res, "admin.html"));
app.get("/ai", (req, res) => sendPage(res, "ai.html"));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
  if (aiService.isConfigured()) {
    console.log(`AI: enabled (${aiService.getConfig().model})`);
  } else {
    console.log("AI: disabled — set OPENAI_API_KEY in .env");
  }
});
