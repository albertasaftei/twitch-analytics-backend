import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import fs from "fs";
import { env } from "process";

const router = Router();

const prisma = new PrismaClient();

async function fetchAllPages({
  apiUrl,
  token = null,
  allData = [],
  counter = 0,
}) {
  try {
    if (counter === 50) return allData;

    const response = await axios.get(apiUrl, {
      headers: {
        "Client-ID": env.CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    const { data, pagination } = response.data;

    const newData = [...allData, ...data];

    if (data?.length) {
      if (!apiUrl.includes("after")) {
        const url = `${apiUrl}&after=${pagination.cursor}`;
        return await fetchAllPages({
          apiUrl: url,
          token,
          allData: newData,
          counter: counter + 1,
        });
      } else if (apiUrl.includes("after")) {
        const url = apiUrl.replace(/after=\w+/, `after=${pagination.cursor}`);
        return await fetchAllPages({
          apiUrl: url,
          token,
          allData: newData,
          counter: counter + 1,
        });
      }
    } else {
      return newData;
    }
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}

const getAccessToken = async () => {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `client_id=${env.CLIENT_ID}&client_secret=${env.CLIENT_SECRET}&grant_type=client_credentials`,
  });

  const finalResponse = await response.json();

  return finalResponse.access_token;
};

router.get("/", (req, res) => {
  res.json({ message: "Hello World" });
});

router.get("/health", (req, res) => {
  res.status(200).send("Everything is ok here");
});

router.get("/getTwitchData", async (req, res) => {
  const access_token = await getAccessToken();
  const games = await fetch("https://api.twitch.tv/helix/games/top", {
    headers: {
      "Client-ID": env.CLIENT_ID,
      Authorization: `Bearer ${access_token}`,
    },
  });

  const gamesData = await games.json();

  const finalData = await Promise.all(
    gamesData.data.map(async (game) => {
      const allData = await fetchAllPages({
        apiUrl: `https://api.twitch.tv/helix/streams?first=100&game_id=${game.id}`,
        token: access_token,
      });
      return allData;
    })
  );

  const dataByGame = gamesData.data.map((game, index) => {
    return {
      game: game.name,
      thumbnail: game?.box_art_url
        .replace("{width}", "300")
        .replace("{height}", "500"),
      viewers: finalData[index].reduce(
        (acc, data) => acc + data.viewer_count,
        0
      ),
    };
  });

  const newRow = await prisma.twitchData.create({
    data: {
      data: dataByGame,
    },
  });

  return res.json(newRow);
});

router.post("/newTwitchData", async (req, res) => {
  const newRow = await prisma.twitchData.create({
    data: {
      data: req.body.data,
    },
  });

  return res.json(newRow);
});

router.get("/getAnalytics", async (req, res) => {
  const allData = await prisma.twitchData.findMany();

  return res.json(allData);
});

export default router;
