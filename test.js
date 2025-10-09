const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require('axios')

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

dotenv.config();
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("Set API_KEY in .env");
  process.exit(1);
}

// API endpoint
app.get("/voices", async (req, res) => {
  const url = "https://api.topmediai.com/v1/voices_list";
  const options = {
    method: "GET",
    headers: { "x-api-key": `${API_KEY}` },
    body: undefined,
  };
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    // console.log(data);
    res.json(data);
  } catch (error) {
    console.error(error);
  }
});

app.post("/tts", async (req, res) => {
  try {
    const { text, speaker } = req.body;

    const url = "https://api.topmediai.com/v1/text2speech";
    const options = {
      method: "POST",
      headers: {
        "x-api-key": `${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: `{"text": "${text}","speaker":"${speaker}","emotion":"Neutral"}`,
    };

    // Step 1: Generate TTS
    const response = await fetch(url, options);
    const data = await response.json();
    console.log(data);

    if (!data?.data?.oss_url) {
      return res.status(400).json({ error: "TTS generation failed" });
    }

    // Step 2: Download and store audio file
    const audioUrl = data.data.oss_url;
    const fileName = `audio_${Date.now()}.wav`;
    const folderPath = path.join("public", "tts_audios");

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const filePath = path.join(folderPath, fileName);
    const audioStream = await axios.get(audioUrl, {
      responseType: "arraybuffer",
    });

    // Save file locally
    fs.writeFileSync(filePath, Buffer.from(audioStream.data));

    // Step 3: Read file and send it as response
    const fileBuffer = fs.readFileSync(filePath);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    // Send both binary file and metadata
    res.send(fileBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
