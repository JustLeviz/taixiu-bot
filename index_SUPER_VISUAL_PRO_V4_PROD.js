// ===============================
//  SUPER VISUAL PRO V4 - FIXED + DAILY + LIXI
// ===============================
// Notes:
// - Fixed "Interaction failed" by using the proper ready event + safer interaction handling.
// - Added /daily (50,000 mỗi 24h) and /lixi (admin phát tiền cho 1 người hoặc toàn server).
// - For safety, TOKEN is read from environment variables. Set DISCORD_TOKEN before running.

/* Optional: load .env if present */
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
  Events
} = require("discord.js");

const fs = require("fs");

// ===== CONFIG =====
// IMPORTANT: Do NOT hardcode your token in code.
// Windows (PowerShell):  $env:DISCORD_TOKEN="YOUR_TOKEN_HERE"
// Linux/macOS:           export DISCORD_TOKEN="YOUR_TOKEN_HERE"
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1478077058512060561";
const GUILD_ID = process.env.GUILD_ID || "1279852470306082817";
const GAME_CHANNEL_ID = process.env.GAME_CHANNEL_ID || "1477815093143011512";

// Game config
const BET_TIME = 30000;

// Daily config
const DAILY_AMOUNT = 50000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

if (!TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN env var. Please set DISCORD_TOKEN then run again.");
  process.exit(1);
}

// ===== DATA =====
let data = fs.existsSync("./data.json")
  ? JSON.parse(fs.readFileSync("./data.json", "utf8"))
  : { users: {}, history: [], riggedNext: null };

function saveData() {
  fs.writeFileSync("./data.json", JSON.stringify(data, null, 2), "utf8");
}

function getUser(id) {
  if (!data.users[id]) {
    data.users[id] = { money: 100000, win: 0, lose: 0, lastDaily: 0 };
  } else if (typeof data.users[id].lastDaily !== "number") {
    data.users[id].lastDaily = 0;
  }
  return data.users[id];
}

function formatVND(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName("balance").setDescription("Xem số dư"),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Nhận 50,000 mỗi 24 giờ (reset theo thời điểm bạn nhận)"),

  new SlashCommandBuilder()
    .setName("addmoney")
    .setDescription("Admin cộng tiền")
    .addUserOption(o => o.setName("user").setDescription("Người nhận").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Số tiền").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("lixi")
    .setDescription("Admin phát tiền lì xì cho 1 người hoặc toàn server")
    .addIntegerOption(o => o.setName("amount").setDescription("Số tiền mỗi người nhận").setRequired(true))
    .addUserOption(o => o.setName("user").setDescription("Nếu bỏ trống: phát cho toàn server").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Chuyển tiền")
    .addUserOption(o => o.setName("user").setDescription("Người nhận").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Số tiền").setRequired(true)),

  new SlashCommandBuilder()
    .setName("rig")
    .setDescription("Admin set kết quả vòng sau")
    .addStringOption(o =>
      o.setName("result")
        .setDescription("TÀI hoặc XỈU")
        .setRequired(true)
        .addChoices(
          { name: "TÀI", value: "TÀI" },
          { name: "XỈU", value: "XỈU" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName("top").setDescription("Top giàu nhất"),

  new SlashCommandBuilder()
    .setName("allmoney")
    .setDescription("Admin xem tiền của tất cả người chơi")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

// Register commands (guild-scoped)
(async () => {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash commands registered.");
  } catch (e) {
    console.error("❌ Failed to register commands:", e);
  }
})();

let currentGame = null;

// ===== READY =====
// Use the official ready event to ensure the bot is fully ready (fixes many "Interaction failed" symptoms).
client.once(Events.ClientReady, async c => {
  console.log(`✅ Bot Online! Logged in as ${c.user.tag}`);

  try {
    const channel = await client.channels.fetch(GAME_CHANNEL_ID);
    if (!channel) return console.log("❌ Sai GAME_CHANNEL_ID (không fetch được channel).");

    setInterval(() => startRound(channel), BET_TIME + 5000);
    startRound(channel);
  } catch (e) {
    console.error("❌ Cannot fetch GAME_CHANNEL_ID channel:", e);
  }
});

// ===== INTERACTION =====
client.on(Events.InteractionCreate, async interaction => {
  try {
    // ===== SLASH =====
    
    if (interaction.isChatInputCommand()) {
      const user = getUser(interaction.user.id);

      switch (interaction.commandName) {
        case "balance": {
          return interaction.reply({ content: `💰 ${formatVND(user.money)} VND`, ephemeral: true });
        }

        case "daily": {
          const now = Date.now();
          const remaining = (user.lastDaily + DAILY_COOLDOWN_MS) - now;

          if (remaining > 0) {
            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
            const secs = Math.floor((remaining % (60 * 1000)) / 1000);
            return interaction.reply({
              content: `⏳ Bạn đã nhận daily rồi. Quay lại sau **${hours}h ${mins}m ${secs}s** nữa nhé!`,
              ephemeral: true
            });
          }

          user.money += DAILY_AMOUNT;
          user.lastDaily = now;
          saveData();
          return interaction.reply({
            content: `🎁 Daily thành công! Bạn nhận **${formatVND(DAILY_AMOUNT)} VND**.
💰 Số dư: **${formatVND(user.money)} VND**`,
            ephemeral: true
          });
        }

        case "addmoney": {
          const target = interaction.options.getUser("user");
          const amount = interaction.options.getInteger("amount");
          if (!amount || amount <= 0) return interaction.reply({ content: "❌ Không hợp lệ", ephemeral: true });

          getUser(target.id).money += amount;
          saveData();
          return interaction.reply(`💎 Đã cộng **${formatVND(amount)}** cho ${target.username}`);
        }

        case "lixi": {
          const amount = interaction.options.getInteger("amount");
          const target = interaction.options.getUser("user");
          if (!amount || amount <= 0) return interaction.reply({ content: "❌ Không hợp lệ", ephemeral: true });

          if (target) {
            getUser(target.id).money += amount;
            saveData();
            return interaction.reply(`🧧 Đã lì xì **${formatVND(amount)}** cho ${target.username}`);
          }

          await interaction.deferReply({ ephemeral: true });

          const guild = interaction.guild;
          if (!guild) return interaction.editReply("❌ Lỗi: không lấy được guild.");

          const members = await guild.members.fetch();
          let count = 0;

          for (const [, member] of members) {
            if (member.user?.bot) continue;
            getUser(member.id).money += amount;
            count++;
          }

          saveData();
          return interaction.editReply(`🧧 Đã phát lì xì **${formatVND(amount)}** cho **${count}** người trong server.`);
        }

        case "pay": {
          const target = interaction.options.getUser("user");
          const amount = interaction.options.getInteger("amount");
          if (!amount || amount <= 0) return interaction.reply({ content: "❌ Số tiền không hợp lệ", ephemeral: true });
          if (target.id === interaction.user.id) return interaction.reply({ content: "❌ Không thể chuyển cho chính bạn", ephemeral: true });
          if (user.money < amount) return interaction.reply({ content: "❌ Không đủ tiền", ephemeral: true });

          user.money -= amount;
          getUser(target.id).money += amount;
          saveData();
          return interaction.reply(`💸 Đã chuyển **${formatVND(amount)}** cho ${target.username}`);
        }

        case "rig": {
          data.riggedNext = interaction.options.getString("result");
          saveData();
          return interaction.reply(`🎯 Đã set vòng sau: ${data.riggedNext}`);
        }

        case "top": {
          const top = Object.entries(data.users)
            .sort((a, b) => (b[1].money || 0) - (a[1].money || 0))
            .slice(0, 5)
            .map((u, i) => `${i + 1}. <@${u[0]}> - ${formatVND(u[1].money)}`)
            .join("
");
          return interaction.reply("🏆 TOP GIÀU:
" + (top || "Chưa có dữ liệu."));
        }

        case "allmoney": {
          const sorted = Object.entries(data.users)
            .sort((a, b) => (b[1].money || 0) - (a[1].money || 0));

          if (sorted.length === 0) {
            return interaction.reply({ content: "Chưa có dữ liệu người chơi.", ephemeral: true });
          }

          let text = "📊 DANH SÁCH TOÀN BỘ NGƯỜI CHƠI

";
          for (let i = 0; i < sorted.length; i++) {
            const [id, info] = sorted[i];
            text += `${i + 1}. <@${id}> - ${formatVND(info.money)} VND
`;
          }

          // Discord message limit 2000 chars
          return interaction.reply({ content: text.slice(0, 2000), ephemeral: true });
        }

        default:
          return interaction.reply({ content: "❌ Lệnh không tồn tại.", ephemeral: true });
      }
    }

    // ===== BUTTON =====
    if (interaction.isButton()) {
      try {
        if (!currentGame || !currentGame.isOpen) {
          return interaction.reply({ content: "⛔ Hết thời gian!", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`bet_${interaction.customId}`)
          .setTitle("Nhập tiền cược");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("amount")
              .setLabel("Số tiền")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return interaction.showModal(modal);

      } catch (err) {
        console.error(err);
      }
    }

    // ===== MODAL =====
    if (interaction.isModalSubmit()) {
      // Always acknowledge within 3s
      await interaction.deferReply({ ephemeral: true });

      if (!currentGame || !currentGame.isOpen) {
        return interaction.editReply("⛔ Hết vòng!");
      }

      const raw = interaction.fields.getTextInputValue("amount");
      const amount = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
      const choice = interaction.customId.includes("tai") ? "TÀI" : "XỈU";
      const user = getUser(interaction.user.id);

      if (!amount || amount <= 0) return interaction.editReply("❌ Số tiền không hợp lệ");
      if (user.money < amount) return interaction.editReply("❌ Không đủ tiền");

      user.money -= amount;
      currentGame.bets[interaction.user.id] = { amount, choice };
      saveData();

      return interaction.editReply(`✅ Đặt **${formatVND(amount)}** vào **${choice}**`);
    }
  } catch (err) {
    console.error(err);

    // Safe fallback response (avoid "Unknown interaction" errors)
    try {
      if (interaction.deferred && !interaction.replied) {
        return interaction.editReply({ content: "❌ Có lỗi xảy ra", ephemeral: true });
      }
      if (!interaction.replied) {
        return interaction.reply({ content: "❌ Có lỗi xảy ra", ephemeral: true });
      }
    } catch (e) {
      // ignore
    }
  }
});

// ===== GAME =====
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
        .setColor("#2f3136")
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
            .setColor("#2f3136")
        ],
        components: [row]
      });
    } catch (e) {
      // Message deleted / missing perms etc.
      clearInterval(timer);
    }
  }, 1000);
  } catch (e) {
    console.error('startRound error:', e);
  }
}

async function endRound(msg) {
  try {
  let dice, result;

  if (data.riggedNext) {
    result = data.riggedNext;
    dice = result === "TÀI" ? [6, 5, 4] : [1, 2, 3];
    data.riggedNext = null;
  } else {
    dice = Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1);
    const total = dice.reduce((a, b) => a + b, 0);
    result = total >= 11 ? "TÀI" : "XỈU";
  }

  const total = dice.reduce((a, b) => a + b, 0);
  data.history.push(result);
  if (data.history.length > 15) data.history.shift();

  let resultText = `🎲 ${dice.join("  ")} (${total} điểm • ${result})\n\nKết quả thắng/thua\n`;

  for (const id in currentGame.bets) {
    const bet = currentGame.bets[id];
    if (bet.choice === result) {
      const win = bet.amount * 2;
      getUser(id).money += win;
      getUser(id).win++;
      resultText += `<@${id}>: +${formatVND(bet.amount)}\n`;
    } else {
      getUser(id).lose++;
      resultText += `<@${id}>: -${formatVND(bet.amount)}\n`;
    }
  }

  saveData();

  await msg.edit({
    embeds: [
      new EmbedBuilder()
        .setTitle("🎲 Tài Xỉu 🎲")
        .setDescription(resultText)
        .setColor("#2f3136")
    ],
    components: []
  });
}

// ===== STABILITY (ANTI-CRASH) =====
process.on("unhandledRejection", (reason) => {
  console.error("🔴 unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🔴 uncaughtException:", err);
});

// Graceful shutdown (PM2/systemd friendly)
async function shutdown(signal) {
  try {
    console.log(`🟡 Received ${signal}, shutting down...`);
    await client.destroy();
  } catch (e) {
    console.error("Shutdown error:", e);
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

client.login(TOKEN);

