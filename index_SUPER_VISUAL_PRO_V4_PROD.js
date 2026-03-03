const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config();

const token = (process.env.DISCORD_TOKEN || "").trim();

console.log("TOKEN len:", token.length);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("✅ BOT READY:", client.user.tag);
});

client.on("error", e => console.error("Client error:", e));
process.on("unhandledRejection", e => console.error("Unhandled:", e));
process.on("uncaughtException", e => console.error("Uncaught:", e));

client.login(token)
  .then(() => console.log("🔥 LOGIN OK"))
  .catch(err => console.error("LOGIN FAILED:", err));
