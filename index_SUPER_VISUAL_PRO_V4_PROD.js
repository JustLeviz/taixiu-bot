// ===============================
//  SUPER VISUAL PRO V4 - CLEAN FIX (FULL)
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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  Events,
} = require("discord.js");

const fs = require("fs");
const http = require("http");

// ===== CONFIG =====
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GAME_CHANNEL_ID = process.env.GAME_CHANNEL_ID;

const BET_TIME = 30_000;                 // 30s
const DAILY_AMOUNT = 50_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const PORT = process.env.PORT || 10000;

if (!TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN (Render Environment)");
  process.exit(1);
}
if (!CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing CLIENT_ID or GUILD_ID (Render Environment)");
  console.error("👉 Hãy set đủ: CLIENT_ID, GUILD_ID, GAME_CHANNEL_ID, DISCORD_TOKEN");
  process.exit(1);
}
if (!GAME_CHANNEL_ID) {
  console.error("❌ Missing GAME_CHANNEL_ID (Render Environment)");
  process.exit(1);
}

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

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

function clampInt(v, min, max) {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
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
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("✅ Slash commands registered OK");
  } catch (err) {
    console.error("❌ Register commands FAILED:", err);
  }
}

// ===== GAME STATE =====
let currentGame = null;
// currentGame = { isOpen: true, bets: { [userId]: { choice: "TAI"/"XIU", amount: number } }, msgId: string, startedAt: number }

// ===== READY =====
client.once(Events.ClientReady, async () => {
  console.log("✅ Bot Online:", client.user?.tag);

  await registerCommands();

  const channel = await client.channels.fetch(GAME_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.log("❌ Không fetch được GAME_CHANNEL_ID -> kiểm tra ID + bot phải có quyền xem channel");
    return;
  }

  // Start game loop
  setInterval(() => startRound(channel), BET_TIME + 5000);
  startRound(channel);
});

// ===== INTERACTION =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Debug log
    console.log("⚡ Interaction:", interaction.type, interaction.isChatInputCommand?.() ? interaction.commandName : (interaction.customId || "unknown"));

    // 1) SLASH COMMAND
    if (interaction.isChatInputCommand()) {
      // Safe ack (tránh timeout nếu Discord lag)
      await interaction.deferReply({ ephemeral: true }).catch(() => null);

      const user = getUser(interaction.user.id);

      switch (interaction.commandName) {
        case "balance":
          return interaction.editReply(`💰 ${formatVND(user.money)} VND`);

        case "daily": {
          const now = Date.now();
          if (now - user.lastDaily < DAILY_COOLDOWN_MS) {
            return interaction.editReply("⏳ Chưa đủ 24h.");
          }
          user.money += DAILY_AMOUNT;
          user.lastDaily = now;
          saveData();
          return interaction.editReply(`🎁 Nhận ${formatVND(DAILY_AMOUNT)} VND`);
        }

        case "top": {
          const top = Object.entries(data.users)
            .sort((a, b) => (b[1].money || 0) - (a[1].money || 0))
            .slice(0, 5)
            .map((u, i) => `${i + 1}. <@${u[0]}> - ${formatVND(u[1].money)} VND`)
            .join("\n");

          return interaction.editReply(`🏆 TOP GIÀU:\n${top || "Chưa có dữ liệu."}`);
        }

        case "allmoney": {
          const sorted = Object.entries(data.users)
            .sort((a, b) => (b[1].money || 0) - (a[1].money || 0));

          if (!sorted.length) return interaction.editReply("Chưa có dữ liệu.");

          let text = `📊 DANH SÁCH TOÀN BỘ NGƯỜI CHƠI\n\n`;
          for (let i = 0; i < sorted.length; i++) {
            const [id, info] = sorted[i];
            text += `${i + 1}. <@${id}> - ${formatVND(info.money)} VND\n`;
          }

          // Discord limit 2000
          return interaction.editReply(text.slice(0, 2000));
        }
      }

      return interaction.editReply("❓ Lệnh không hợp lệ.");
    }

    // 2) BUTTON (TÀI / XỈU)
    if (interaction.isButton()) {
      if (!currentGame || !currentGame.isOpen) {
        return interaction.reply({ content: "⛔ Hết thời gian cược rồi.", ephemeral: true });
      }

      const id = interaction.customId;
      if (id !== "tai" && id !== "xiu") {
        return interaction.reply({ content: "❓ Nút không hợp lệ.", ephemeral: true });
      }

      // Open modal to input bet amount
      const modal = new ModalBuilder()
        .setCustomId(`betmodal_${id}`)
        .setTitle(id === "tai" ? "Cược TÀI" : "Cược XỈU");

      const amountInput = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Nhập số tiền cược (VD: 10000)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Tối thiểu 1,000")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
      return interaction.showModal(modal);
    }

    // 3) MODAL SUBMIT (bet amount)
    if (interaction.isModalSubmit()) {
      if (!currentGame || !currentGame.isOpen) {
        return interaction.reply({ content: "⛔ Hết thời gian cược rồi.", ephemeral: true });
      }

      const custom = interaction.customId || "";
      if (!custom.startsWith("betmodal_")) {
        return interaction.reply({ content: "❓ Modal không hợp lệ.", ephemeral: true });
      }

      const choiceBtn = custom.replace("betmodal_", "");
      const choice = choiceBtn === "tai" ? "TAI" : "XIU";

      const rawAmount = interaction.fields.getTextInputValue("amount");
      const amount = clampInt(rawAmount, 1000, 1_000_000_000);
      if (!amount) {
        return interaction.reply({ content: "❌ Tiền cược không hợp lệ.", ephemeral: true });
      }

      const user = getUser(interaction.user.id);

      // If already bet this round: refund previous bet then replace (cho tiện)
      const prev = currentGame.bets[interaction.user.id];
      if (prev?.amount) {
        user.money += prev.amount;
      }

      if (user.money < amount) {
        // return money of prev already refunded above, so just check
        saveData();
        return interaction.reply({ content: `❌ Anh không đủ tiền. Số dư: ${formatVND(user.money)} VND`, ephemeral: true });
      }

      user.money -= amount;
      currentGame.bets[interaction.user.id] = { choice, amount };
      saveData();

      return interaction.reply({
        content: `✅ Đã cược **${choice === "TAI" ? "TÀI" : "XỈU"}**: **${formatVND(amount)} VND**`,
        ephemeral: true,
      });
    }

  } catch (err) {
    console.error("❌ Interaction handler error:", err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "❌ Có lỗi xảy ra.", ephemeral: true });
      }
    } catch {}
  }
});

// ===== GAME =====
async function startRound(channel) {
  try {
    currentGame = {
      bets: {},
      isOpen: true,
      msgId: null,
      startedAt: Date.now(),
    };

    let timeLeft = Math.floor(BET_TIME / 1000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tai").setLabel("🔥 TÀI").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("xiu").setLabel("❄️ XỈU").setStyle(ButtonStyle.Primary)
    );

    const msg = await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎲 TÀI XỈU 🎲")
          .setDescription(`⏳ Còn **${timeLeft}s** để cược\nBấm nút để cược (sẽ hiện ô nhập tiền).`)
      ],
      components: [row],
    });

    currentGame.msgId = msg.id;

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
              .setDescription(`⏳ Còn **${timeLeft}s** để cược\nBấm nút để cược (sẽ hiện ô nhập tiền).`)
          ],
          components: [row],
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
    // Roll
    const dice = Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1);
    const total = dice.reduce((a, b) => a + b, 0);
    const result = total >= 11 ? "TAI" : "XIU";

    // Payout
    const betEntries = Object.entries(currentGame?.bets || {});
    for (const [userId, bet] of betEntries) {
      const user = getUser(userId);
      if (!bet?.amount || !bet?.choice) continue;

      if (bet.choice === result) {
        // Win: receive 2x (stake back + profit)
        user.money += bet.amount * 2;
        user.win = (user.win || 0) + 1;
      } else {
        user.lose = (user.lose || 0) + 1;
      }
    }

    data.history.push({
      at: Date.now(),
      dice,
      total,
      result,
      betsCount: betEntries.length,
    });
    if (data.history.length > 50) data.history.shift();

    saveData();

    await msg.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎲 KẾT QUẢ 🎲")
          .setDescription(
            `🎲 ${dice.join(" ")}\n` +
            `📌 Tổng: **${total}**\n` +
            `🏁 Kết quả: **${result === "TAI" ? "TÀI" : "XỈU"}**\n` +
            `👥 Số người cược: **${betEntries.length}**`
          )
      ],
      components: [],
    });

  } catch (err) {
    console.error("endRound error:", err);
    try {
      await msg.edit({ components: [] }).catch(() => null);
    } catch {}
  }
}

// ===== STABILITY =====
process.on("unhandledRejection", (reason) => {
  console.error("🔴 unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🔴 uncaughtException:", err);
});

// ===== LOGIN =====
client.login(TOKEN)
  .then(() => console.log("🔥 Discord login OK"))
  .catch(err => {
    console.error("❌ Discord login FAILED:", err);
    process.exit(1);
  });

// ===== RENDER PORT FIX =====
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});
