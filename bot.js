require('dotenv').config();
const { Client, Intents, MessageEmbed } = require('discord.js');
const axios = require('axios');

// ================= CẤU HÌNH BẢO MẬT =================
const config = {
  DISCORD: {
    TOKEN: process.env.DISCORD_TOKEN,
    ERROR_CHANNEL: process.env.ERROR_CHANNEL_ID
  },
  PIKAMC: {
    BASE_URL: 'https://cp.pikamc.vn/api/client',
    API_KEY: process.env.PIKAMC_API_KEY,
    SERVER_ID: process.env.PIKAMC_SERVER_ID
  },
  DEEPSEEK: {
    BASE_URL: 'https://api.deepseek.com/v1',
    API_KEY: process.env.DEEPSEEK_API_KEY
  }
};

// ================= KHỞI TẠO BOT =================
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MEMBERS
  ]
});

// ================= PIKAMC SERVICE =================
class PikaMCManager {
  static async fetchServerData() {
    try {
      const response = await axios.get(
        `${config.PIKAMC.BASE_URL}/servers/${config.PIKAMC.SERVER_ID}`,
        {
          headers: {
            'Authorization': `Bearer ${config.PIKAMC.API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.attributes;
    } catch (error) {
      this.handleAPIError('PIKAMC_FETCH', error);
      return null;
    }
  }

  static async retrieveLogs(lines = 100) {
    try {
      const response = await axios.get(
        `${config.PIKAMC.BASE_URL}/servers/${config.PIKAMC.SERVER_ID}/logs?size=${lines}`,
        {
          headers: {
            'Authorization': `Bearer ${config.PIKAMC.API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      this.handleAPIError('PIKAMC_LOGS', error);
      return null;
    }
  }

  static handleAPIError(context, error) {
    const errorMessage = error.response?.data?.errors?.[0]?.detail || error.message;
    console.error(`[${new Date().toISOString()}] ${context}_ERROR:`, errorMessage);
    
    const errorChannel = client.channels.cache.get(config.DISCORD.ERROR_CHANNEL);
    if (errorChannel) {
      errorChannel.send({
        embeds: [
          new MessageEmbed()
            .setColor('#FF0000')
            .setTitle(`⚠️ ${context} Error`)
            .setDescription(`\`\`\`${errorMessage.substring(0, 1000)}\`\`\``)
            .setTimestamp()
        ]
      });
    }
  }
}

// ================= DEEPSEEK AI SERVICE =================
class AIAnalyzer {
  static async diagnoseIssue(errorLog) {
    try {
      const response = await axios.post(
        `${config.DEEPSEEK.BASE_URL}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: [{
            role: 'user',
            content: `Lỗi Minecraft Server: ${errorLog}\n\nHãy phân tích nguyên nhân và đề xuất 3 giải pháp khắc phục chi tiết bằng tiếng Việt.`
          }],
          temperature: 0.5,
          max_tokens: 1500
        },
        {
          headers: {
            'Authorization': `Bearer ${config.DEEPSEEK.API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('[DEEPSEEK_ERROR]', error.response?.data || error.message);
      return '⚠️ Lỗi phân tích AI. Vui lòng thử lại sau.';
    }
  }
}

// ================= DISCORD COMMANDS =================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Lệnh !status - Kiểm tra trạng thái
  if (message.content === '!status') {
    const serverData = await PikaMCManager.fetchServerData();
    
    const statusEmbed = new MessageEmbed()
      .setColor(serverData?.status === 'running' ? '#00FF00' : '#FF0000')
      .setTitle('🖥️ Trạng thái Server')
      .addFields(
        { name: 'Tên Server', value: serverData?.name || 'N/A', inline: true },
        { name: 'Trạng thái', value: serverData?.status === 'running' ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'Phiên bản', value: serverData?.features?.minecraft_version || 'N/A', inline: true },
        { name: 'Người chơi', value: `${serverData?.resources?.players || 0}/${serverData?.limits?.players || 0}`, inline: true },
        { name: 'Hiệu suất', value: `CPU: ${serverData?.resources?.cpu_absolute || 0}%\nRAM: ${Math.round(serverData?.resources?.memory_bytes / 1024 / 1024) || 0}MB`, inline: true }
      )
      .setFooter('PikaMC.vn • Cập nhật');
    
    message.reply({ embeds: [statusEmbed] });
  }

  // Lệnh !logs [số dòng]
  if (message.content.startsWith('!logs')) {
    const lines = Math.min(parseInt(message.content.split(' ')[1]) || 50, 200);
    const logs = await PikaMCManager.retrieveLogs(lines);
    
    if (!logs) return message.reply('❌ Lỗi khi lấy nhật ký');
    
    const errorLogs = logs.split('\n').filter(line => 
      /Exception|Error|Failed|Crash|Warning/.test(line)
    ).slice(0, 5);
    
    const logEmbed = new MessageEmbed()
      .setColor('#FFA500')
      .setTitle(`📜 Logs (${lines} dòng gần nhất)`)
      .setDescription(`\`\`\`${errorLogs.join('\n').substring(0, 1000)}\`\`\``)
      .setFooter(`Dùng !fix <lỗi> để phân tích chi tiết`);
    
    message.reply({ embeds: [logEmbed] });
  }

  // Lệnh !fix <lỗi>
  if (message.content.startsWith('!fix')) {
    const errorText = message.content.slice(4).trim();
    if (!errorText) return message.reply('Vui lòng nhập nội dung lỗi để phân tích');
    
    const analysis = await AIAnalyzer.diagnoseIssue(errorText);
    
    const analysisEmbed = new MessageEmbed()
      .setColor('#7289DA')
      .setTitle('🔍 Phân tích lỗi bằng AI')
      .setDescription(`\`\`\`${errorText.substring(0, 500)}\`\`\``)
      .addField('💡 Giải pháp', analysis.substring(0, 1000))
      .setFooter('Powered by DeepSeek AI');
    
    message.reply({ embeds: [analysisEmbed] });
  }
});

// ================= KHỞI ĐỘNG =================
client.once('ready', () => {
  console.log(`🤖 Bot đã sẵn sàng: ${client.user.tag}`);
  console.log(`🔗 Quản lý server: https://cp.pikamc.vn/server/${config.PIKAMC.SERVER_ID}`);
});

client.login(config.DISCORD.TOKEN);
