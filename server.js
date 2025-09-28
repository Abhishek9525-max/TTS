// speechify-backend-server.js
// Node.js backend with Express + Socket.io + ElevenLabs TTS streaming
// Usage: set ELEVENLABS_API_KEY in .env and run `node --experimental-modules server.js` or use babel/ts-node

import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

dotenv.config();
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVEN_KEY) {
  console.error("Set ELEVENLABS_API_KEY in .env");
  process.exit(1);
}

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const client = new ElevenLabsClient({ apiKey: ELEVEN_KEY });

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

// Simple health
app.get("/health", (req, res) => res.json({ ok: true }));

// WebSocket real-time TTS
io.on("connection", (socket) => {
  console.log("client connected", socket.id);

  socket.on("textChunk", async (msg) => {
    // msg = { text: string, voiceId: string, modelId?: string }
    try {
      const { text, voiceId, modelId = "eleven_multilingual_v2" } = msg;
      if (!text || !voiceId)
        return socket.emit("error", "text and voiceId required");
      if (text.length > 2000) return socket.emit("error", "chunk too long");

      // Call ElevenLabs streaming API
      const stream = await client.textToSpeech.stream(voiceId, {
        text,
        modelId,
      });

      // stream is async iterable of Uint8Array chunks
      let counter = 0;
      for await (const chunk of stream) {
        // emit binary chunk to client
        socket.emit("audioChunk", {
          chunk: Buffer.from(chunk).toString("base64"),
          seq: counter++,
        });
      }

      // Optionally tell client this chunk finished
      socket.emit("chunkComplete", { message: "done", seq: counter });
    } catch (err) {
      console.error("TTS error", err);
      socket.emit("error", "TTS generation failed");
    }
  });

  socket.on("disconnect", () => console.log("client disconnected", socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on", PORT));

// NOTE: Frontend should decode base64 audio chunks and append to buffer for playback.
// Keep API key server-side; add rate-limiting & auth for production.
