require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const INTERCOM_ADMIN_ID = process.env.INTERCOM_ADMIN_ID;

// ✅ 1️⃣ LISTEN FOR NEW MESSAGES IN SLACK
app.post("/slack-events", async (req, res) => {
  const { event } = req.body;

  if (event && event.type === "message" && !event.subtype) {
    const slackThreadTs = event.ts; // Unique Slack message timestamp
    const slackChannelId = event.channel;
    const slackUserId = event.user;
    const slackMessage = event.text;

    try {
      // ✅ Create a New Conversation in Intercom (Avoid Duplicates)
      const intercomResponse = await axios.post(
        "https://api.intercom.io/conversations",
        {
          from: { type: "user", id: slackUserId },
          body: slackMessage,
          message_type: "inapp",
          external_id: slackThreadTs, // Prevents duplicates
          custom_attributes: {
            slack_thread_ts: slackThreadTs,
            slack_channel: slackChannelId,
          },
        },
        {
          headers: {
            Authorization: INTERCOM_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        `✅ Intercom conversation created: ${intercomResponse.data.id}`
      );
      res.status(200).send("OK");
    } catch (error) {
      console.error(
        "❌ Error creating Intercom conversation:",
        error.response?.data || error
      );
      res.status(500).send("Error");
    }
  } else {
    res.status(200).send("Ignored");
  }
});

// ✅ 2️⃣ LISTEN FOR INTERCOM REPLIES & SEND THEM TO SLACK THREAD
app.post("/intercom-webhook", async (req, res) => {
  try {
    const { data, test } = req.body; // Intercom sends "test": true in test requests

    if (test) {
      console.log("✅ Intercom Webhook Test Request Received.");
      return res
        .status(200)
        .json({ message: "Webhook test received successfully." });
    }

    // ✅ Handle real webhook events
    const conversationId = data.item.id;
    const adminName =
      data.item.conversation_parts?.conversation_parts[0]?.author?.name ||
      "Unknown";
    const message =
      data.item.conversation_parts?.conversation_parts[0]?.body ||
      "No message content.";
    const slackThreadTs = data.item.custom_attributes?.slack_thread_ts;
    const slackChannelId = data.item.custom_attributes?.slack_channel;

    if (!slackThreadTs || !slackChannelId) {
      console.log("❌ No Slack thread info found.");
      return res.status(400).json({ error: "Missing Slack thread metadata" });
    }

    // ✅ Send Intercom reply to Slack thread
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: slackChannelId,
        thread_ts: slackThreadTs,
        text: message,
      },
      { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(
      "❌ Error processing Intercom webhook:",
      error.response?.data || error
    );
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

app.post("/slack-events", async (req, res) => {
  const { event, challenge } = req.body;

  // ✅ Handle Slack's verification challenge
  if (challenge) {
    return res.status(200).json({ challenge });
  }

  // ✅ Handle new messages
  if (event && event.type === "message" && !event.subtype) {
    const slackThreadTs = event.ts; // Unique Slack message timestamp
    const slackChannelId = event.channel;
    const slackUserId = event.user;
    const slackMessage = event.text;

    try {
      // ✅ Create a New Conversation in Intercom (Avoid Duplicates)
      const intercomResponse = await axios.post(
        "https://api.intercom.io/conversations",
        {
          from: { type: "user", id: slackUserId },
          body: slackMessage,
          message_type: "inapp",
          external_id: slackThreadTs,
          custom_attributes: {
            slack_thread_ts: slackThreadTs,
            slack_channel: slackChannelId,
          },
        },
        {
          headers: {
            Authorization: process.env.INTERCOM_ACCESS_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        `✅ Intercom conversation created: ${intercomResponse.data.id}`
      );
      res.status(200).send("OK");
    } catch (error) {
      console.error(
        "❌ Error creating Intercom conversation:",
        error.response?.data || error
      );
      res.status(500).send("Error");
    }
  } else {
    res.status(200).send("Ignored");
  }
});

// ✅ 4️⃣ DEPLOY SERVER
app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Server running on port 3000")
);
