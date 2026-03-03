// ===============================
//  SUPER VISUAL PRO V4 - CLEAN FIX (Render + Slash OK)
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

// ===== HARD LOG / CRASH GUARD =====
process.on("unhandledRejection", (e) => console.error("❌ unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("❌ uncaughtException:", e));

// ===== CONFIG =====
const DISCORD_TOKEN = (process.env.DISCORD_TOKEN || "").trim();
const CLIENT_ID = (process.env.CLIENT_ID || "1478077058512060561").trim();
const GUILD_ID = (process.env.GUILD_ID || "1279852470306082817").trim();
const GAME_CHANNEL_ID = (process.env.GAME_CHANNEL_ID || "1477815093143011512").trim();

// Game config
const BET_TIME = 30000;
const DAILY_AMOUNT = 50000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ===== BOOT CHECK =====
console.log("=== BOOT CONFIG CHECK ===");
console.log("NODE_ENV:", process.env.NODE_ENV || "(none)");
console.log("TOKEN len:", DISCORD_TOKEN ? DISCORD_TOKEN.length : 0, "TOKEN tail:", DISCORD_TOKEN ? DISCORD_TOKEN.slice(-4) : "none");
console.log("CLIENT_ID:", CLIENT_ID);
console.log("GUILD_ID :", GUILD_ID);
console.log("GAME_CHANNEL_ID:", GAME_CHANNEL_ID);
console.log("=========================");

if (!DISCORD_TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN (Render ENV not set / has spaces / duplicate key?)");
  process.exit(1);
}

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.on("error", (e) => console.error("❌ client error:", e));
client.on("shardError", (e) => console.error("❌ shardError:", e));

// ===== DATA =====
let data = fs.existsSync("./data.json")
  ? JSON.parse(fs.readFileSync("./data.json", "utf8"))
  : { users: {}, history: [], riggedNext: null };

function saveData() {
  fs.writeFileSync("./data.json", JSON.stringify(data, null, 2));
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    console.log("🔁 Registering slash commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash commands registered OK");
  } catch (err) {
    console.error("❌ Register commands FAILED:", err);
  }
}

// ===== READY =====
client.once(Events.ClientReady, async () => {
  console.log("✅ READY:", client.user?.tag);

  // Register commands on boot (safe)
  await registerCommands();

  // Fetch channel
  const channel = await client.channels.fetch(GAME_CHANNEL_ID).catch((e) => {
    console.error("❌ Fetch GAME_CHANNEL_ID failed:", e);
    return null;
  });

  if (!channel) {
    console.log("❌ Không fetch được GAME_CHANNEL_ID -> check channel id / bot permission / bot in guild");
    return;
  }

  console.log("✅ Game channel OK:", channel?.id);

  // Start game loop
  setInterval(() => startRound(channel), BET_TIME + 5000);
  startRound(channel);
});

// ===== INTERACTION =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Log để biết event có chạy hay không
    console.log("⚡ Interaction:", interaction.type, interaction.isChatInputCommand() ? interaction.commandName : "not-command");

    if (!interaction.isChatInputCommand()) return;

    // ACK sớm để tránh "Ứng dụng không phản hồi"
    // (riêng balance trả nhanh thì vẫn ok, nhưng ACK sớm cho chắc)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
    }

    const user = getUser(interaction.user.id);

    switch (interaction.commandName) {
      case "balance": {
        return interaction.editReply({
          content: `💰 ${formatVND(user.money)} VND`,
        });
      }

      case "daily": {
        const now = Date.now();
        if (now - user.lastDaily < DAILY_COOLDOWN_MS) {
          return interaction.editReply({ content: "⏳ Chưa đủ 24h." });
        }

        user.money += DAILY_AMOUNT;
        user.lastDaily = now;
        saveData();

        return interaction.editReply({
          content: `🎁 Nhận ${formatVND(DAILY_AMOUNT)} VND`,
        });
      }

      case "top": {
        const top = Object.entries(data.users)
          .sort((a, b) => (b[1].money || 0) - (a[1].money || 0))
          .slice(0, 5)
          .map((u, i) => `${i + 1}. <@${u[0]}> - ${formatVND(u[1].money)} VND`)
          .join("\n");

        return interaction.editReply({
          content: `🏆 TOP GIÀU:\n${top || "Chưa có dữ liệu."}`,
        });
      }

      case "allmoney": {
        const sorted = Object.entries(data.users)
          .sort((a, b) => (b[1].money || 0) - (a[1].money || 0));

        if (!sorted.length) return interaction.editReply({ content: "Chưa có dữ liệu." });

        let text = `📊 DANH SÁCH TOÀN BỘ NGƯỜI CHƠI\n\n`;
        for (let i = 0; i < sorted.length; i++) {
          const [id, info] = sorted[i];
          text += `${i + 1}. <@${id}> - ${formatVND(info.money)} VND\n`;
        }

        return interaction.editReply({
          content: text.slice(0, 2000),
        });
      }

      default:
        return interaction.editReply({ content: "Lệnh không hợp lệ." });
    }
  } catch (err) {
    console.error("❌ Interaction handler error:", err);

    // Nếu chưa reply thì reply fallback
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "❌ Có lỗi xảy ra.", ephemeral: true });
      } else {
        await interaction.editReply({ content: "❌ Có lỗi xảy ra." });
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
      } catch (e) {
        console.error("msg.edit failed:", e?.message || e);
        clearInterval(timer);
      }
    }, 1000);

  } catch (err) {
    console.error("❌ startRound error:", err);
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
    console.error("❌ endRound error:", err);
  }
}

// ===== LOGIN =====
client.login(DISCORD_TOKEN)
  .then(() => console.log("🔥 Discord login OK"))
  .catch(err => {
    console.error("❌ Discord login FAILED:", err);
    process.exit(1);
  });

// ===== RENDER PORT FIX =====
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});
