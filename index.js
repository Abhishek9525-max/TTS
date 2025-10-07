import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import fs from "fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import path from "path";
import { fileURLToPath } from "url";
import { translate } from "@vitalets/google-translate-api"; // unofficial free translator

dotenv.config();
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const PORT = process.env.PORT || 3000;

if (!ELEVEN_KEY) {
  console.error("Set ELEVENLABS_API_KEY in .env");
  process.exit(1);
}

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const client = new ElevenLabsClient({ apiKey: ELEVEN_KEY });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure audio storage folder exists
const AUDIO_DIR = path.join(__dirname, "audio_files");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

app.get("/", (req, res) => {
  res.status(200).json("Welcome to TTS Api");
});

// REST: list voices
app.get("/voices", async (req, res) => {
  try {
    const voices = await client.voices.getAll();
    return res.json(voices);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch voices" });
  }
});

app.post("/tts", async (req, res) => {
  try {
    const {
      text,
      voiceId,
      modelId = "eleven_multilingual_v2",
      language = "en", // user selects language: en / fr / hi
    } = req.body;

    if (!text || !voiceId)
      return res.status(400).json({ error: "text and voiceId required" });

    let finalText = text;

    // Only translate if Hindi requested
    if (language === "hi") {
      const translated = await translate(text, { to: "hi" });
      finalText = translated.text;
      console.log("Translated to Hindi:", finalText);
    }

    // Send final text to ElevenLabs
    const stream = await client.textToSpeech.stream(voiceId, {
      text: finalText,
      modelId,
    });

    // Collect audio chunks
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);

    // Save locally
    const filePath = path.join(AUDIO_DIR, `audio_${Date.now()}.mp3`);
    fs.writeFileSync(filePath, audioBuffer);

    res.json({
      message: "Audio saved locally",
      translatedText: finalText,
      path: filePath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS generation failed" });
  }
});

// Existing Socket.IO streaming setup
io.on("connection", (socket) => {
  console.log("client connected", socket.id);

  // Get Voices over Socket
  socket.on("getVoices", async () => {
    try {
      const voices = await client.voices.getAll();
      socket.emit("voicesList", voices);
    } catch (err) {
      console.error(err);
      socket.emit("error", "Failed to fetch voices");
    }
  });


  // Generate TTS over Socket
  socket.on("generateTTS", async (msg) => {
    try {
      let {
        text,
        voiceId,
        modelId = "eleven_flash_v2_5",
        // modelId = "eleven_multilingual_v2",
        language = "en",
      } = msg;
      if (!text || !voiceId)
        return socket.emit("error", "text and voiceId required");
      console.log(text, voiceId, language);

      // Translate if Hindi
      if (language === "hi") {
        const translated = await translate(text, { to: "hi" });
        text = translated.text;
        console.log("Translated to Hindi:", text);
      }

      // Stream audio chunks
      const stream = await client.textToSpeech.stream(voiceId, {
        text,
        modelId,
      });

      const chunks = [];
      let counter = 0;
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk);
        chunks.push(buffer);
        socket.emit("audioChunk", {
          chunk: buffer.toString("base64"),
          seq: counter++,
        });
      }

      // Save full MP3
      const audioBuffer = Buffer.concat(chunks);
      const filePath = path.join(AUDIO_DIR, `audio_${Date.now()}.mp3`);
      fs.writeFileSync(filePath, audioBuffer);

      socket.emit("ttsResult", {
        message: "Audio saved locally",
        translatedText: text,
        path: filePath,
        fileBase64: audioBuffer.toString("base64"),
      });
    } catch (err) {
      console.error(err);
      socket.emit("error", "TTS generation failed");
    }
  });

  socket.on("disconnect", () => console.log("client disconnected", socket.id));
});

server.listen(PORT, () => console.log("Server running on", PORT));
