## Форум “СЕМЬЯ” (диплом)

Стек: **HTML/CSS/JS + Node.js (Express) + SQLite**.

### Запуск

1) Установить зависимости:

```bash
npm install
```

2) Запустить сервер:

```bash
npm run dev
```

Откройте `http://localhost:3000`.

### Админ

По умолчанию при первом запуске создаётся админ:

- **login**: `admin`
- **password**: `admin12345`

Админ‑панель: `/admin`

### Официальный аккаунт (новости)

Аккаунт с галочкой верификации (`galka.png`):

- **login**: `Семья` (или `official@family.local`)
- **password**: `official12345`

Посты этого аккаунта отображаются в разделе **Новости** (`/news`).

### Искусственный интеллект (реальный API)

Форум подключается к **OpenAI API** или любому **OpenAI-совместимому** сервису (OpenRouter, Groq и др.).

1. Скопируйте `.env.example` в `.env`
2. Укажите ключ:

```env
OPENAI_API_KEY=sk-ваш-ключ
OPENAI_MODEL=gpt-4o-mini
```

3. Перезапустите сервер

**Возможности ИИ:**
- Кнопка **«ИИ»** в правом нижнем углу — чат-помощник
- Страница **/ai** — полноэкранный чат
- При создании поста — «Улучшить текст с ИИ», «Предложить заголовок»
- В комментариях — «Предложить ответ (ИИ)»

Пример для [OpenRouter](https://openrouter.ai):

```env
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
OPENAI_MODEL=openai/gpt-4o-mini
```

### Иконки

По ТЗ все иконки лежат в `/pic`.

Положите ваши файлы в `public/pic/` (например `logo.png`, `search.png`, `heart.png`, `repost.png`, `galka.png`, `avatar-default.jpg` и др.).

