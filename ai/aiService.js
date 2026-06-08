const crypto = require("crypto");
const https = require("https");
const axios = require("axios");

const CLIENT_ID = (process.env.GIGACHAT_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.GIGACHAT_CLIENT_SECRET || process.env.GIGACHAT_SECRET_KEY || "").trim();
const AUTH_KEY = (process.env.GIGACHAT_AUTHORIZATION_KEY || "").trim();
const SCOPE = (process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS").trim();
const MODEL = (process.env.GIGACHAT_MODEL || "GigaChat").trim();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const http = axios.create({ httpsAgent, timeout: 60000 });

let accessToken = null;
let tokenExpiresAt = 0;

const SYSTEM_PROMPT = `Ты — доброжелательный ИИ-помощник форума «Семья» регионального центра психолого-педагогической помощи. Помогаешь формулировать посты и комментарии. Пиши по-русски. Не выдавай себя за врача. При серьезных проблемах советуй обращаться к специалистам центра (+7 3532 75 43 88).`;

function notConfiguredError() {
  const err = new Error(
    "ИИ не настроен. Укажите GIGACHAT_AUTHORIZATION_KEY или GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET в .env."
  );
  err.code = "AI_NOT_CONFIGURED";
  return err;
}

function getAuthorizationHeader() {
  if (AUTH_KEY) {
    return `Basic ${AUTH_KEY}`;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw notConfiguredError();
  }

  try {
    const decoded = Buffer.from(CLIENT_SECRET, "base64").toString("utf8");
    if (decoded.startsWith(`${CLIENT_ID}:`)) {
      return `Basic ${CLIENT_SECRET}`;
    }
  } catch {

  }

  const encoded = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  const rqUID = crypto.randomUUID();
  const authorization = getAuthorizationHeader();

  try {
    const { data } = await http.post(
      "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      new URLSearchParams({ scope: SCOPE }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: authorization,
          RqUID: rqUID
        }
      }
    );

    if (!data.access_token) {
      const err = new Error("GigaChat не вернул access_token");
      err.code = "GIGACHAT_AUTH_ERROR";
      throw err;
    }

    accessToken = data.access_token;
    const expiresMs = Number(data.expires_at) * 1000;
    tokenExpiresAt = expiresMs > 0 ? expiresMs - 300000 : Date.now() + 25 * 60 * 1000;

    return accessToken;
  } catch (error) {
    if (error.code === "AI_NOT_CONFIGURED") throw error;
    const status = error.response?.status;
    const apiMsg = error.response?.data?.message;
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`GigaChat auth${status ? ` [${status}]` : ""}:`, detail);

    let message = status ? `Ошибка авторизации GigaChat (${status})` : "Ошибка авторизации GigaChat";
    if (status === 400 && apiMsg?.includes("scope")) {
      message =
        "Неверный GIGACHAT_SCOPE. Для физлиц — GIGACHAT_API_PERS, для ИП/юрлиц — GIGACHAT_API_B2B или GIGACHAT_API_CORP.";
    }

    const err = new Error(message);
    err.code = "GIGACHAT_AUTH_ERROR";
    throw err;
  }
}

async function chatCompletion(messages, { maxTokens = 1200, temperature = 0.7 } = {}) {
  const token = await getAccessToken();

  try {
    const { data } = await http.post(
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
      {
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: maxTokens,
        temperature
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error("Пустой ответ GigaChat");
      err.code = "GIGACHAT_API_ERROR";
      throw err;
    }
    return content;
  } catch (error) {
    if (error.code === "AI_NOT_CONFIGURED" || error.code === "GIGACHAT_API_ERROR") throw error;
    const status = error.response?.status;
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error(`GigaChat chat${status ? ` [${status}]` : ""}:`, detail);

    let message = status ? `Ошибка GigaChat (${status})` : "Ошибка GigaChat";
    if (status === 402) {
      message =
        "Требуется оплата пакета GigaChat API. Подключите тариф в личном кабинете developers.sber.ru.";
    }

    const err = new Error(message);
    err.code = "GIGACHAT_API_ERROR";
    throw err;
  }
}

module.exports = {
  isConfigured: () => {
    if (AUTH_KEY) return true;
    return !!CLIENT_ID && !!CLIENT_SECRET;
  },
  getConfig: () => ({ configured: module.exports.isConfigured(), model: MODEL }),
  async chat(messages) {
    return chatCompletion(messages);
  },
  async improvePost(title, body) {
    const prompt = `Улучши черновик поста. Верни JSON: {"title":"...","body":"..."}. Заголовок: ${title || "(пусто)"}. Текст: ${body || "(пусто)"}`;
    const raw = await chatCompletion([{ role: "user", content: prompt }], { maxTokens: 1500, temperature: 0.5 });
    try {
      const jsonMatch = raw.match(/{[\s\S]*}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      return {
        title: String(parsed.title || title).slice(0, 120),
        body: String(parsed.body || body).slice(0, 10000)
      };
    } catch {
      return { title, body: raw };
    }
  },
  async suggestComment(postTitle, postBody, userDraft) {
    const draft = userDraft ? `\nЧерновик пользователя: ${userDraft}` : "";
    const prompt = `Пост: ${postTitle}\nТекст: ${postBody}${draft}\nНапиши вежливый комментарий (2-3 предложения).`;
    return chatCompletion([{ role: "user", content: prompt }], { maxTokens: 400, temperature: 0.7 });
  }
};
