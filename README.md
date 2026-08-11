# Plantain Chips WhatsApp Assistant

A simple AI assistant that answers customer questions on WhatsApp for a plantain chips business — flavors, prices, delivery, payment, hours, etc.

**This assistant does NOT take orders.** It only answers questions. If a customer wants to buy, it will tell them to contact the business directly.

## Files

- `index.js` — the main program (you won't need to edit this)
- `business-info.js` — **edit this file** to update flavors, prices, delivery info, etc.
- `.env.example` — a template showing what secret settings are needed (real values go into Render later, not into this file)

## How it works

1. A customer messages the business's WhatsApp number
2. WhatsApp forwards the message to this program
3. This program asks Claude (the AI) to write a reply, using the details in `business-info.js`
4. The reply is sent back to the customer on WhatsApp

## Updating business info later

Open `business-info.js`, replace the placeholder text (the parts in quotes), save, and upload the change to GitHub. Render will automatically redeploy with the new info.
