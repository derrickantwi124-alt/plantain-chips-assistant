const http = require("http");
const crypto = require("crypto");
const business = require("./business");

// ---- Settings (these come from Render's Environment Variables) ----
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID; // where new orders are sent
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL; // Render fills this in automatically
const MODEL = "claude-haiku-5-5";

const SECRET = crypto
  .createHash("sha256")
  .update(TELEGRAM_TOKEN || "none")
  .digest("hex");
const TG = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Remembers each customer's recent conversation (resets if the service restarts)
const histories = new Map();

function buildSystemPrompt() {
  return `You are the friendly, polite order assistant for ${business.name}. You chat with customers on Telegram and take their food orders.

MENU:
${business.menu}

BUSINESS RULES:
${business.rules}

HOW TO BEHAVE:
- Keep replies short, warm and simple. Use plain text only (no markdown, no asterisks).
- Only sell items on the menu, at the menu prices. If something is not on the menu, politely say so.
- Collect: the items and quantities, whether it is delivery or pickup, the customer's name, their phone number, and their address if it is delivery.
- Ask for missing details one or two at a time, not all at once.
- Before finishing, repeat the full order with the total price (including delivery fee if any) and ask the customer to confirm.
- Only AFTER the customer clearly confirms (for example says yes), reply with a short thank-you and include the final order summary between the markers [[ORDER]] and [[/ORDER]]. Put the markers on their own lines. Include the items, total, delivery or pickup, name, phone and address. Do this only once per order.
- If the customer asks something you cannot answer, say the owner will get back to them.`;
}

async function askClaude(history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: buildSystemPrompt(),
      messages: history,
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function sendTelegram(chatId, text) {
  const res = await fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    console.error("Telegram send error:", res.status, await res.text());
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Handy command to discover your own chat ID (needed to receive orders)
  if (text === "/myid") {
    await sendTelegram(chatId, `Your chat ID is: ${chatId}`);
    return;
  }

  if (text === "/start") {
    histories.delete(chatId);
    await sendTelegram(chatId, business.greeting);
    return;
  }

  const history = histories.get(chatId) || [];
  history.push({ role: "user", content: text });
  while (history.length > 20) history.shift();
  while (history.length && history[0].role !== "user") history.shift();

  let reply;
  try {
    reply = await askClaude(history);
  } catch (err) {
    console.error(err);
    history.pop();
    await sendTelegram(
      chatId,
      "Sorry, something went wrong on our side. Please try again in a moment."
    );
    return;
  }

  history.push({ role: "assistant", content: reply });
  histories.set(chatId, history);

  const orderMatch = reply.match(/\[\[ORDER\]\]([\s\S]*?)\[\[\/ORDER\]\]/);
  const customerText = reply
    .replace(/\[\[ORDER\]\][\s\S]*?\[\[\/ORDER\]\]/, "")
    .trim();

  await sendTelegram(
    chatId,
    customerText || "Thank you! Your order has been received."
  );

  if (orderMatch && OWNER_CHAT_ID) {
    const who = msg.from.username ? ` (@${msg.from.username})` : "";
    await sendTelegram(
      OWNER_CHAT_ID,
      `🛎 NEW ORDER\nFrom: ${msg.from.first_name || "Customer"}${who}\n\n${orderMatch[1].trim()}`
    );
  } else if (orderMatch) {
    console.log("NEW ORDER (no OWNER_CHAT_ID set):", orderMatch[1].trim());
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    if (req.headers["x-telegram-bot-api-secret-token"] !== SECRET) {
      res.writeHead(403);
      return res.end();
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      res.writeHead(200);
      res.end("ok");
      try {
        handleUpdate(JSON.parse(body)).catch((e) => console.error(e));
      } catch (e) {
        console.error(e);
      }
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Order assistant is running.");
});

server.listen(PORT, async () => {
  console.log(`Server started on port ${PORT}`);
  if (!TELEGRAM_TOKEN || !ANTHROPIC_API_KEY) {
    console.error("MISSING: TELEGRAM_TOKEN or ANTHROPIC_API_KEY in Environment.");
    return;
  }
  if (!BASE_URL) {
    console.error("No public URL found, so the Telegram webhook was not set.");
    return;
  }
  try {
    const res = await fetch(`${TG}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `${BASE_URL}/webhook`,
        secret_token: SECRET,
      }),
    });
    console.log("Webhook result:", await res.text());
  } catch (err) {
    console.error("Could not set webhook:", err);
  }
});
