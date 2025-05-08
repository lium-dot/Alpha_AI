import { makeWASocket, useMultiFileAuthState, Browsers, downloadContentFromMessage } from '@whiskeysockets/baileys';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import NodeCache from 'node-cache';
import pino from 'pino';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import ffmpegStatic from 'ffmpeg-static';
import FormData from 'form-data';

// Initialize configuration
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const messageCache = new NodeCache({ stdTTL: 0 });
const pendingQueries = new NodeCache();
const APPROVAL_THRESHOLD = 3;

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

// Encryption setup
const encrypt = (text) => {
  const cipher = crypto.createCipheriv('aes-256-cbc', 
    Buffer.from(process.env.ENCRYPTION_KEY), 
    Buffer.alloc(16));
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

const decrypt = (encrypted) => {
  const decipher = crypto.createDecipheriv('aes-256-cbc',
    Buffer.from(process.env.ENCRYPTION_KEY),
    Buffer.alloc(16));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

// WhatsApp initialization
const { state, saveCreds } = await useMultiFileAuthState(
  'auth_info', 
  { encrypt, decrypt }
);

const sock = makeWASocket({
  auth: {
    ...state,
    phoneNumber: process.env.BOT_NUMBER,
    showPairingCode: true
  },
  browser: Browsers.macOS('Alpha'),
  logger: pino({ level: 'silent' })
});

// Pairing code handler
sock.ev.on('pairing_code', (code) => {
  logger.info(`Pairing Code: ${code}`);
  console.log(`\n🔢 PAIRING CODE: ${code}\n` + 
    'On phone: WhatsApp → Settings → Linked Devices → Link Device');
});

// Connection management
sock.ev.on('connection.update', (update) => {
  if (update.connection === 'open') {
    console.log('✅ Alpha is ready!');
  }
});

// Create temp directory if not exists
try { await fs.mkdir('temp') } catch {}

// Audio transcription handler
async function transcribeAudio(audioMessage) {
  try {
    const stream = await downloadContentFromMessage(audioMessage, 'audio');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const outputPath = path.join('temp', `${Date.now()}.mp3`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(Readable.from(buffer))
        .audioFrequency(16000)
        .audioChannels(1)
        .format('mp3')
        .save(outputPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const formData = new FormData();
    formData.append('file', await fs.readFile(outputPath), 'audio.mp3');
    formData.append('model', 'whisper-1');

    const response = await axios.post('https://free.churchless.tech/v1/audio/transcriptions', formData, {
      headers: formData.getHeaders()
    });

    await fs.unlink(outputPath);
    return response.data.text;
  } catch (error) {
    logger.error(error, 'Audio transcription failed');
    return null;
  }
}

// Permission system
async function checkPermission(jid) {
  try {
    const data = await fs.readFile('permissions.json');
    return JSON.parse(data).allowed.includes(jid);
  } catch {
    return false;
  }
}

async function grantAccess(jid) {
  let permissions = { allowed: [] };
  try {
    permissions = JSON.parse(await fs.readFile('permissions.json'));
  } catch {}
  
  if (!permissions.allowed.includes(jid)) {
    permissions.allowed.push(jid);
    await fs.writeFile('permissions.json', JSON.stringify(permissions));
  }
}

// Message tracking
function trackUser(jid) {
  const count = (messageCache.get(jid) || 0) + 1;
  messageCache.set(jid, count);
  return count;
}

// AI response handler
async function getAIResponse(prompt) {
  try {
    const response = await axios.post('https://free.churchless.tech/v1/chat/completions', {
      model: 'mistral-7b',
      messages: [{
        role: 'system',
        content: 'You are Alpha, a helpful WhatsApp assistant. Respond concisely.'
      }, {
        role: 'user',
        content: prompt
      }]
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    logger.error(error, 'AI API error');
    return null;
  }
}

// Core message handler
sock.ev.on('messages.upsert', async ({ messages }) => {
  const msg = messages[0];
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  const user = msg.pushName || 'Unknown';
  let prompt = '';

  try {
    // Handle media messages
    if (msg.message.audioMessage) {
      prompt = await transcribeAudio(msg.message.audioMessage);
      if (!prompt) throw new Error('Transcription failed');
    } else {
      prompt = msg.message.conversation || '';
    }

    // Track user messages
    const msgCount = trackUser(jid);
    if (msgCount >= APPROVAL_THRESHOLD) await grantAccess(jid);

    if (!prompt.toLowerCase().startsWith('alpha')) return;
    prompt = prompt.replace(/alpha/gi, '').trim();

    // Check permissions
    if (!(await checkPermission(jid))) {
      await sock.sendMessage(jid, {
        text: `🔒 You need ${APPROVAL_THRESHOLD - msgCount} more messages to use Alpha`
      });
      return;
    }

    // Process query
    const aiResponse = await getAIResponse(prompt);
    
    if (!aiResponse || aiResponse.includes("I don't know")) {
      const queryId = Date.now().toString(36);
      pendingQueries.set(queryId, { jid, user, prompt });
      
      await sock.sendMessage(process.env.ADMIN_JID, {
        text: `❓ Assistance Request\n\nUser: ${user}\nQuery: ${prompt}\nID: ${queryId}\nReply with: /ans ${queryId} [response]`
      });
      
      await sock.sendMessage(jid, { text: "Consulting knowledge base... ⏳" });
    } else {
      await sock.sendMessage(jid, { text: aiResponse });
    }

  } catch (error) {
    logger.error(error);
    await sock.sendMessage(jid, { 
      text: msg.message.audioMessage 
        ? "⚠️ Couldn't process audio message" 
        : "⚠️ Error processing request" 
    });
  }
});

// Admin response handler
sock.ev.on('messages.upsert', async ({ messages }) => {
  const msg = messages[0];
  if (!msg.message || msg.key.remoteJid !== process.env.ADMIN_JID) return;

  const text = msg.message.conversation || '';
  if (text.startsWith('/ans')) {
    const [, queryId, ...responseParts] = text.split(' ');
    const response = responseParts.join(' ');
    const query = pendingQueries.get(queryId);

    if (query) {
      await sock.sendMessage(query.jid, { 
        text: `🤖 Alpha: ${response}` 
      });
      pendingQueries.del(queryId);
    }
  }
});

// Save credentials and start
sock.ev.on('creds.update', saveCreds);
console.log('🚀 Starting Alpha WhatsApp AI...');

process.on('uncaughtException', (error) => {
  logger.fatal(error, 'Uncaught exception');
  process.exit(1);
});