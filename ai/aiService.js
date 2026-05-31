const SYSTEM_PROMPT = `Ты — доброжелательный ИИ-помощник форума «Семья» регионального центра психолого-педагогической, медицинской и социальной помощи (Оренбургская область).
Помогаешь пользователям формулировать посты и комментарии, отвечаешь на вопросы о семье, воспитании, психологической поддержке.
Пиши по-русски, понятно и уважительно. Не выдавай себя за врача: при серьёзных проблемах советуй обратиться к специалистам центра или по телефону +7 (3532) 75 43 88.
Не используй markdown-заголовки с #. Ответы будут короткими, если вопрос простой.`;

function getConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
  return { apiKey: apiKey.trim(), baseUrl, model };
}

function isConfigured() {
  return !!getConfig().apiKey;
}

async function chatCompletion(messages, { maxTokens = 1200, temperature = 0.7 } = {}) {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) {
    const err = new Error("AI_NOT_CONFIGURED");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: maxTokens,
      temperature
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.code = "AI_API_ERROR";
    err.status = res.status;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error("Пустой ответ от ИИ");
    err.code = "AI_EMPTY";
    throw err;
  }
  return text.trim();
}

async function chat(messages) {
  return chatCompletion(messages);
}

async function improvePost(title, body) {
  const userContent = `Улучши черновик поста для форума. Верни ответ СТРОГО в формате JSON без markdown:
{"title":"...","body":"..."}

Заголовок (до 120 символов): ${title || "(пусто)"}

Текст:
${body || "(пусто)"}`;

  const raw = await chatCompletion([{ role: "user", content: userContent }], {
    maxTokens: 1500,
    temperature: 0.5
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      title: String(parsed.title || title).slice(0, 120),
      body: String(parsed.body || body).slice(0, 10000)
    };
  } catch {
    return { title, body: raw };
  }
}

async function suggestComment(postTitle, postBody, userDraft) {
  const userContent = `Пост на форуме:
Заголовок: ${postTitle}
Текст: ${postBody}

${userDraft ? `Черновик ответа пользователя: ${userDraft}` : "Пользователь ещё не написал ответ."}

Напиши один уместный, доброжелательный комментарий (2–5 предложений). Только текст комментария, без кавычек и пояснений.`;

  return chatCompletion([{ role: "user", content: userContent }], {
    maxTokens: 400,
    temperature: 0.7
  });
}

module.exports = {
  isConfigured,
  getConfig: () => {
    const c = getConfig();
    return { configured: !!c.apiKey, model: c.model, baseUrl: c.baseUrl };
  },
  chat,
  improvePost,
  suggestComment
};
