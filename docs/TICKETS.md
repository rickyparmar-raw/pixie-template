# 🎫 Helper Ticketing & Escalation Guide

Pixie includes a built-in helper ticketing and escalation system inspired by **[Hack Club Nephthys](https://github.com/hackclub/nephthys)**.

It allows community helpers and organizers to triage, claim, and resolve help requests directly in Slack without needing external database servers like PostgreSQL.

---

## ⚡ How It Works

1. **Member Asks in Help Channel:** A member asks a question in `#help` (or your configured help channel).
2. **AI Confidence & Escalation:**
   * If Pixie knows the answer with high confidence, it answers immediately with citations.
   * If the question requires human helper attention or is unanswerable from the docs, an interactive **Ticket Card** is posted to `#helpers`.
3. **Helper Interaction via Cards in Helper Channel:**
   * **`🙋 Claim Ticket`** — Marks the ticket as claimed by the helper in the card.
   * **`✅ Resolve`** — Closes the ticket with resolved status.
   * **`❌ Close`** — Closes the ticket as non-issue or invalid.
   * **`🔄 Reopen`** — Reopens a closed ticket.

---

## ⚙️ Enabling Ticketing

To enable ticketing:
1. Create a private helper channel (e.g. `#event-helpers`).
2. Add Pixie to the helper channel (`/invite @pixie`).
3. Set `PIXIE_HELPER_CHANNEL="C0..."` in your `.env` (or Railway environment variables).

If `PIXIE_HELPER_CHANNEL` is left unset, ticketing remains disabled and Pixie operates in standard Q&A mode.
