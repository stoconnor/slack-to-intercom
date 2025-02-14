require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const INTERCOM_ADMIN_ID = process.env.INTERCOM_ADMIN_ID;

// 1️⃣ Listen for new Slack messages
app.post("/slack-events", async (req, res) => {
  const { event, challenge } = req.body;

  // Handle Slack's verification challenge
  if (challenge) {
    return res.status(200).json({ challenge });
  }

  // Only process new messages, not thread replies or other events
  if (event && event.type === "message" && !event.subtype) {
    const slackThreadTs = event.ts;
    const slackChannelId = event.channel;
    const slackUserId = event.user;
    const slackMessage = event.text;

    console.log(
      "📝 Received Slack event payload:",
      JSON.stringify(event, null, 2)
    );

    try {
      // Create new Intercom conversation and store Slack thread info
      const intercomResponse = await axios.post(
        "https://api.intercom.io/conversations",
        {
          from: { type: "user", id: INTERCOM_ADMIN_ID },
          body: slackMessage,
          message_type: "inapp",
          external_id: slackThreadTs, // Prevents duplicate conversations
          custom_attributes: {
            slack_thread_ts: slackThreadTs, // Store thread ID for replies
            slack_channel: slackChannelId, // Store channel for replies
          },
        },
        {
          headers: {
            Authorization: `Bearer ${INTERCOM_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        "Intercom API Response:",
        JSON.stringify(intercomResponse.data, null, 2)
      );
      console.log(
        `✅ Intercom conversation created: ${intercomResponse.data.id}`
      );
      return res.status(200).send("OK");
    } catch (error) {
      console.error(
        "❌ Error creating Intercom conversation:",
        error.response?.data || error
      );
      return res.status(500).send("Error creating Intercom conversation");
    }
  }

  return res.status(200).send("Ignored");
});

// 2️⃣ Listen for Intercom replies and send them to the original Slack thread
app.post("/intercom-webhook", async (req, res) => {
  try {
    console.log(
      "📝 Received Intercom webhook payload:",
      JSON.stringify(req.body, null, 2)
    );

    // Handle Intercom's ping/test notification
    if (
      req.body.type === "notification_event" &&
      req.body.data?.item?.type === "ping"
    ) {
      console.log("✅ Intercom Webhook Test Request Received");
      return res
        .status(200)
        .json({ message: "Webhook test received successfully" });
    }

    // Handle regular conversation updates
    const { data } = req.body;

    // Get the latest reply from the conversation
    const conversationPart =
      data?.item?.conversation_parts?.conversation_parts[0];
    if (!conversationPart) {
      return res.status(400).json({ error: "No conversation part found" });
    }

    // Extract necessary information
    const message = conversationPart.body || "No message content";

    //TODO: look into why these attributes are not saved?
    //const slackThreadTs = data.item.custom_attributes?.slack_thread_ts;
    //const slackChannelId = data.item.custom_attributes?.slack_channel;

    const slackChannelId = "C08DDDMT750";
    const slackThreadTs = data.item.external_id;

    // Verify we have the necessary Slack thread information
    if (!slackThreadTs || !slackChannelId) {
      console.log("❌ No Slack thread info found in Intercom conversation");
      return res.status(400).json({ error: "Missing Slack thread metadata" });
    }

    // Send the Intercom reply back to the original Slack thread
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: slackChannelId,
        thread_ts: slackThreadTs, // This ensures the message appears in the thread
        text: message,
      },
      {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      }
    );

    console.log("✅ Reply sent to Slack thread");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(
      "❌ Error processing Intercom webhook:",
      error.response?.data || error
    );
    return res.status(500).json({ error: "Failed to process webhook" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
