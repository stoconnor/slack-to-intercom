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
    const { data } = req.body;
    const conversationId = data.item.id;
    const adminName =
      data.item.conversation_parts.conversation_parts[0].author.name;
    const message = data.item.conversation_parts.conversation_parts[0].body;
    const slackThreadTs = data.item.custom_attributes.slack_thread_ts;
    const slackChannelId = data.item.custom_attributes.slack_channel;

    if (!slackThreadTs || !slackChannelId) {
      console.log("❌ No Slack thread info found.");
      return res.status(400).send("No Slack thread info");
    }

    // ✅ Post Intercom Reply in Slack Thread
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: slackChannelId,
        thread_ts: slackThreadTs,
        text: `📝 *Intercom Admin Reply:* \n👤 *${adminName}* \n💬 ${message}`,
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).send("OK");
  } catch (error) {
    console.error(
      "❌ Error sending message to Slack:",
      error.response?.data || error
    );
    res.status(500).send("Error");
  }
});

// ✅ 3️⃣ LISTEN FOR SLACK THREAD REPLIES & SEND TO INTERCOM
app.post("/slack-replies", async (req, res) => {
  const { event } = req.body;

  if (event && event.type === "message" && event.thread_ts) {
    const slackThreadTs = event.thread_ts;
    const slackMessage = event.text;
    const slackUserId = event.user;

    try {
      // ✅ Find Intercom Conversation Using `external_id`
      const intercomSearch = await axios.post(
        "https://api.intercom.io/conversations/search",
        {
          query: { field: "external_id", operator: "=", value: slackThreadTs },
        },
        {
          headers: {
            Authorization: INTERCOM_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      if (!intercomSearch.data.conversations.length) {
        return res.status(404).send("No matching Intercom conversation");
      }

      const intercomConversationId = intercomSearch.data.conversations[0].id;

      // ✅ Reply to Intercom Conversation
      await axios.post(
        `https://api.intercom.io/conversations/${intercomConversationId}/reply`,
        {
          type: "admin",
          admin_id: INTERCOM_ADMIN_ID,
          message_type: "comment",
          body: slackMessage,
        },
        {
          headers: {
            Authorization: INTERCOM_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );

      res.status(200).send("OK");
    } catch (error) {
      console.error(
        "❌ Error sending Slack reply to Intercom:",
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
