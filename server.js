require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(bodyParser.json());

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const INTERCOM_ADMIN_ID = process.env.INTERCOM_ADMIN_ID;

// Initialize SQLite database
const db = new sqlite3.Database(path.join(__dirname, "conversations.db"));

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slack_thread_ts TEXT NOT NULL,
      slack_channel_id TEXT NOT NULL,
      intercom_conversation_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS processed_webhooks (
      webhook_id TEXT PRIMARY KEY,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// 1️⃣ Listen for new Slack messages
app.post("/slack-events", async (req, res) => {
  console.log("Received Slack request:", JSON.stringify(req.body, null, 2));

  const { event, challenge } = req.body;

  if (challenge) {
    console.log("✅ Handling Slack verification challenge");
    return res.status(200).json({ challenge });
  }

  if (event && event.type === "message" && !event.subtype) {
    const slackThreadTs = event.ts;
    const slackChannelId = event.channel;
    const slackUserId = event.user;
    const slackMessage = event.text;

    try {
      // Create new Intercom conversation
      const intercomResponse = await axios.post(
        "https://api.intercom.io/conversations",
        {
          from: { type: "user", id: INTERCOM_ADMIN_ID },
          body: slackMessage,
          message_type: "inapp",
        },
        {
          headers: {
            Authorization: `Bearer ${INTERCOM_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      const intercomConversationId = intercomResponse.data.id;

      // Save the mapping to database
      db.run(
        `INSERT INTO conversations (slack_thread_ts, slack_channel_id, intercom_conversation_id) 
         VALUES (?, ?, ?)`,
        [slackThreadTs, slackChannelId, intercomConversationId],
        (err) => {
          if (err) {
            console.error("❌ Error saving to database:", err);
          } else {
            console.log("✅ Mapping saved to database");
          }
        }
      );

      console.log(
        `✅ Intercom conversation created: ${intercomConversationId}`
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

// 2️⃣ Listen for Intercom replies
app.post("/intercom-webhook", async (req, res) => {
  try {
    console.log(
      "📝 Received Intercom webhook payload:",
      JSON.stringify(req.body, null, 2)
    );

    if (
      req.body.type === "notification_event" &&
      req.body.data?.item?.type === "ping"
    ) {
      console.log("✅ Intercom Webhook Test Request Received");
      return res
        .status(200)
        .json({ message: "Webhook test received successfully" });
    }

    const webhookId = req.body.id;

    // Check if webhook was already processed
    db.get(
      "SELECT webhook_id FROM processed_webhooks WHERE webhook_id = ?",
      [webhookId],
      async (err, row) => {
        if (err) {
          console.error("❌ Error checking webhook status:", err);
          return res.status(500).json({ error: "Database error" });
        }

        if (row) {
          console.log("⚠️ Webhook already processed:", webhookId);
          return res.status(200).json({ message: "Webhook already processed" });
        }

        const conversationPart =
          conversation.conversation_parts?.conversation_parts[0];
        if (!conversationPart) {
          return res.status(400).json({ error: "No conversation part found" });
        }

        const message = conversationPart.body || "No message content";
        const intercomConversationId = req.body.data?.item.source.id;

        // Get Slack details from database
        db.get(
          `SELECT slack_thread_ts, slack_channel_id 
           FROM conversations 
           WHERE intercom_conversation_id = ?`,
          [intercomConversationId],
          async (err, row) => {
            if (err || !row) {
              console.error(
                "❌ Error retrieving Slack details:",
                err || "No matching conversation found"
              );
              return res
                .status(400)
                .json({ error: "Conversation mapping not found" });
            }

            try {
              // Send reply to Slack thread
              await axios.post(
                "https://slack.com/api/chat.postMessage",
                {
                  channel: row.slack_channel_id,
                  thread_ts: row.slack_thread_ts,
                  text: message,
                },
                {
                  headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
                }
              );

              // Mark webhook as processed
              db.run("INSERT INTO processed_webhooks (webhook_id) VALUES (?)", [
                webhookId,
              ]);

              console.log("✅ Reply sent to Slack thread");
              return res.status(200).json({ success: true });
            } catch (error) {
              console.error(
                "❌ Error sending Slack message:",
                error.response?.data || error
              );
              return res
                .status(500)
                .json({ error: "Failed to send Slack message" });
            }
          }
        );
      }
    );
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
