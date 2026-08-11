// ============================================================
// PLANTAIN CHIPS WHATSAPP FAQ ASSISTANT
// ============================================================
// This app receives WhatsApp messages from customers,
// asks Claude (Anthropic's AI) to answer using the business
// info in business-info.js, and sends the reply back on WhatsApp.
// It does NOT take or process orders — it only answers questions.
// ============================================================

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const Anthropic = require("@anthropic-ai/sdk");
const businessInfo = require("./business-info");

const app = express();
app.use(bodyParser.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// --------------------------------------------------------
// Build the instructions we give Claude, using business-info.js
// --------------------------------------------------------
function buildSystemPrompt() {
  const flavorsList = businessInfo.flavors.length
    ? businessInfo.flavors.join("\n")
    : "Flavor and price list not yet added.";

  return `You are a friendly customer support assistant for ${businessInfo.businessName}, a plantain chips business.

Your job is ONLY to answer customer questions using the information below. You do not take orders or process payments — if a customer wants to order, tell them to contact the business directly using the contact info below.

FLAVORS AND PRICES:
${flavorsList}

DELIVERY:
${businessInfo.deliveryInfo}

PAYMENT OPTIONS:
${businessInfo.paymentOptions}

BUSINESS HOURS:
${businessInfo.businessHours}

CONTACT INFO:
${businessInfo.contactInfo}

OTHER NOTES:
${businessInfo.extraNotes}

Keep replies short, warm, and friendly — like a real WhatsApp chat, not a formal email. If you don't know the answer from the info above, politely say you're not sure and suggest they contact the business directly.`;
}

// --------------------------------------------------------
// WhatsApp webhook verification (Meta calls this once when you set up the webhook)
// --------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// --------------------------------------------------------
// Receiving WhatsApp messages
// --------------------------------------------------------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from; // customer's WhatsApp number
    const text = message.text?.body;

    if (!text) {
      return res.sendStatus(200);
    }

    console.log(`Message from ${from}: ${text}`);

    // Ask Claude for a reply
    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: text }],
    });

    const replyText = aiResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    await sendWhatsAppMessage(from, replyText);

    res.sendStatus(200);
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.sendStatus(200); // always acknowledge to Meta, even on error
  }
});

// --------------------------------------------------------
// Sending a WhatsApp message back to the customer
// --------------------------------------------------------
async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Failed to send WhatsApp message:", errText);
  }
}

// --------------------------------------------------------
// Simple health check page
// --------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Plantain Chips Assistant is running.");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
