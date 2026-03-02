// ===============================
//  SUPER VISUAL PRO V4 - DEBUG + FIX (RENDER SAFE)
// ===============================

try { require("dotenv").config(); } catch (e) {}

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  Events
} = require("discord.js");

const fs = require("fs");
const http = require("http");

// ===== HARD DEBUG: show crashes =====
process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED_REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT_EXCEPTION:", err);
});

// ===== CONFIG =====
const TOKEN = (process.env.DISCORD_TOKEN || "").trim();
const CLIENT_ID = (process.env.CLIENT_ID || "").trim();
const GUILD_ID = (process.env.GUILD_ID || "").trim();
const GAME_CHANNEL_ID = (process.env.GAME_CHANNEL_ID || "").trim();

const BET_TIME = 30000;
const DAILY_AMOUNT = 50000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

console.log("=== BOOT CONFIG CHECK ===");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("TOKEN len:", TOKEN.length, "TOKEN tail4:", TOKEN.slice(-4) || "none");
console.log("CLIENT_ID:", CLIENT_ID || "MISSING");
console.log("GUILD_ID:", GUILD_ID || "MISSING");
console.log("GAME_CHANNEL_ID:", GAME_CHANNEL_ID || "MISSING");
console.log("=========================");

if (!TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN (Render ENV not set / has spaces?)");
  process.exit(1);
}
if (!CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing CLIENT_ID or GUILD_ID (Render ENV not set)");
  process.exit(1);
}

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== DATA =====
const DATA_PATH = "./data.json";
let data = fs.existsSync(DATA_PATH)
  ? JSON.parse(fs.readFileSync(DATA_PATH, "utf8"))
  : { users: {}, history: [], riggedNext: null };

function saveData() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ saveData failed (filesystem):", e);
  }
}

function getUser(id) {
  if (!data.users[id]) {
    data.users[id] = { money: 100000, win: 0, lose: 0, lastDaily: 0 };
  }
  return data.users[id];
}

function formatVND(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName("balance").setDescription("Xem số dư"),
  new SlashCommandBuilder().setName("daily").setDescription("Nhận 50,000 mỗi 24h"),
  new SlashCommandBuilder().setName("top").setDescription("Top giàu nhất"),
  new SlashCommandBuilder()
    .setName("allmoney")
    .setDescription("Xem toàn bộ tiền")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

async function registerCommands() {
  console.log("🔧 Registering slash commands...");
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands
    });
    console.log("✅ Slash commands registered OK");
  } catch (e) {
    console.error("❌ Register commands FAILED:", e);
  }
}

// ===== READY =====
client.once(Events.ClientReady, async () => {
  console.log("✅ Bot Online:", client.user?.tag);

  await registerCommands();

  if (!GAME_CHANNEL_ID) {
    console.log("⚠️ GAME_CHANNEL_ID missing -> skip game loop");
    return;
  }

  const channel = await client.channels.fetch(GAME_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.log("❌ Không fetch được GAME_CHANNEL_ID (bot thiếu quyền / sai ID / không cùng guild)");
    return;
  }

  setInterval(() => startRound(channel), BET_TIME + 5000);
  startRound(channel);
});

// ===== INTERACTION =====
client.on(Events.InteractionCreate, async interaction => {
  console.log("⚡ Interaction:", interaction.type, interaction.isChatInputCommand() ? interaction.commandName : "not-command");

  try {
    if (!interaction.isChatInputCommand()) return;

    const user = getUser(interaction.user.id);

    switch (interaction.commandName) {
      case "balance":
        return interaction.reply({
          content: `💰 ${formatVND(user.money)} VND`,
          ephemeral: true
        });

      case "daily": {
        const now = Date.now();
        if (now - user.lastDaily < DAILY_COOLDOWN_MS) {
          return interaction.reply({
            content: "⏳ Chưa đủ 24h.",
            ephemeral: true
          });
        }
        user.money += DAILY_AMOUNT;
        user.lastDaily = now;
        saveData();
        return interaction.reply({
          content: `🎁 Nhận ${formatVND(DAILY_AMOUNT)} VND`,
          ephemeral: true
        });
      }

      case "top": {
        const top = Object.entries(data.users)
          .sort((a, b) => (b[1].money || 0) - (a[1].money || 0))
          .slice(0, 5)
          .map((u, i) => `${i + 1}. <@${u[0]}> - ${formatVND(u[1].money)}`)
          .join("\n");

        return interaction.reply({
          content: `🏆 TOP GIÀU:\n${top || "Chưa có dữ liệu."}`
        });
      }

      case "allmoney": {
        const sorted = Object.entries(data.users)
          .sort((a, b) => (b[1].money || 0) - (a[1].money || 0));

        if (!sorted.length)
          return interaction.reply({
            content: "Chưa có dữ liệu.",
            ephemeral: true
          });

        let text = `📊 DANH SÁCH TOÀN BỘ NGƯỜI CHƠI\n\n`;
        for (let i = 0; i < sorted.length; i++) {
          const [id, info] = sorted[i];
          text += `${i + 1}. <@${id}> - ${formatVND(info.money)} VND\n`;
        }

        return interaction.reply({
          content: text.slice(0, 2000),
          ephemeral: true
        });
      }
    }
  } catch (err) {
    console.error("❌ Interaction handler error:", err);
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: "❌ Lỗi xử lý lệnh.", ephemeral: true });
      }
    } catch {}
  }
});

// ===== GAME =====
let currentGame = null;

async function startRound(channel) {
  try {
    currentGame = { bets: {}, isOpen: true };
    let timeLeft = Math.floor(BET_TIME / 1000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tai").setLabel("🔥 TÀI").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("xiu").setLabel("❄️ XỈU").setStyle(ButtonStyle.Primary)
    );

    const msg = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎲 TÀI XỈU 🎲")
          .setDescription(`⏳ ${timeLeft}s`)
      ],
      components: [row]
    });

    const timer = setInterval(async () => {
      timeLeft--;

      if (timeLeft <= 0) {
        clearInterval(timer);
        currentGame.isOpen = false;
        return endRound(msg);
      }

      try {
        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎲 TÀI XỈU 🎲")
              .setDescription(`⏳ ${timeLeft}s`)
          ],
          components: [row]
        });
      } catch {
        clearInterval(timer);
      }
    }, 1000);
  } catch (err) {
    console.error("startRound error:", err);
  }
}

async function endRound(msg) {
  try {
    const dice = Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1);
    const total = dice.reduce((a, b) => a + b, 0);
    const result = total >= 11 ? "TÀI" : "XỈU";

    await msg.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎲 KẾT QUẢ 🎲")
          .setDescription(`🎲 ${dice.join(" ")}\n${result}`)
      ],
      components: []
    });
  } catch (err) {
    console.error("endRound error:", err);
  }
}

// ===== LOGIN (IMPORTANT) =====
(async () => {
  console.log("🔑 Logging in Discord...");
  try {
    await client.login(TOKEN);
    console.log("🔥 Discord login OK");
  } catch (e) {
    console.error("❌ Discord login FAILED:", e);
    process.exit(1);
  }
})();

// ===== RENDER PORT FIX =====
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});
