// Conversational hours and payout calculator for Pixl builders.
// Performs exact arithmetic on build hours, Hackatime logs, Restoration Energy (RE),
// and shop item goals.

const shop = require("./shop");

const HOURS_REGEX = /\b(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i;
const RE_REGEX = /\b(\d+(?:\.\d+)?)\s*(?:re|restoration energy)\b/i;
const CALCULATOR_INTENT_REGEX = /\b(?:calculate|how much (?:will|do) i (?:earn|make|get)|how many more hours|how much more hours|can i afford|what can i (?:get|buy|afford)|hours? (?:left|needed|remaining)|payout for)\b/i;

function parseHours(text) {
  const m = String(text || "").match(HOURS_REGEX);
  return m ? parseFloat(m[1]) : null;
}

function parseRe(text) {
  const m = String(text || "").match(RE_REGEX);
  return m ? parseFloat(m[1]) : null;
}

function isCalculatorQuery(text) {
  const t = String(text || "");
  const hasHours = HOURS_REGEX.test(t);
  const hasIntent = CALCULATOR_INTENT_REGEX.test(t);
  return (hasHours && hasIntent) || (/\b(?:calculate|calculator|calc)\b/i.test(t) && (hasHours || RE_REGEX.test(t)));
}

function directAnswer(question, data = null) {
  if (!isCalculatorQuery(question)) return null;

  const currentShop = data || shop.current();
  const economy = currentShop?.economy || shop.DEFAULT_ECONOMY;
  const items = currentShop?.items || [];

  const hours = parseHours(question);
  const currentRe = parseRe(question) || 0;
  const tier = shop.parseTier(question) || 1;
  const tierName = shop.TIER_NAMES[tier - 1] || "Spark";
  const rateRe = shop.rePerHour(tier, economy);

  // Check if a target shop item is named
  const matchedItems = items.length > 0 ? shop.findItems(question, items) : [];
  const targetItem = matchedItems.length === 1 ? matchedItems[0] : null;

  // Case 1: Target item named ("I have 14 hours at T2, how many more hours for PS5?")
  if (targetItem && !shop.isTrophy(targetItem) && !shop.isUnpriced(targetItem)) {
    const itemPx = shop.priceOf(targetItem);
    const earnedRe = hours !== null ? currentRe + (hours * rateRe) : currentRe;
    const totalHoursNeeded = shop.hoursForPixels(itemPx, { tier, startingRe: earnedRe, economy });
    const hoursRemaining = hours !== null ? Math.max(0, Math.round((totalHoursNeeded) * 10) / 10) : totalHoursNeeded;

    const lines = [
      `*${targetItem.name}* costs *${shop.priceOf(targetItem).toLocaleString()} px*.`,
      "",
    ];

    if (hours !== null) {
      const earnedPxAtFloor = Math.round(hours * shop.pxPerHour(0, economy));
      lines.push(
        `With *${hours}h* at *T${tier} ${tierName}* (${rateRe} RE/h), you've banked ~*${Math.round(earnedRe)} RE* (worth ~*${earnedPxAtFloor} px* at base rate).`
      );
      if (hoursRemaining <= 0) {
        lines.push(`🎉 You already have enough hours to redeem this item!`);
      } else {
        lines.push(
          `You need about *${hoursRemaining} more hours* at T${tier} to reach it.`
        );
      }
    } else {
      lines.push(
        `Starting from *${Math.round(currentRe)} RE* at *T${tier} ${tierName}* (${rateRe} RE/h), you need about *${Math.round(totalHoursNeeded * 10) / 10}h* of shipped work.`
      );
    }

    return {
      source: "Pixl Calculator",
      direct: true,
      answer: lines.join("\n").trim(),
    };
  }

  // Case 2: "What can I get / afford with 15 hours / 500 px?"
  if (/\b(?:what can i (?:get|buy|afford)|affordable)\b/i.test(question) && items.length > 0 && hours !== null) {
    const earnedRe = currentRe + (hours * rateRe);
    const estimatedPx = Math.round(hours * shop.pxPerHour(0, economy));
    const affordable = items
      .filter((i) => !shop.isTrophy(i) && !shop.isUnpriced(i) && shop.priceOf(i) <= estimatedPx)
      .sort((a, b) => shop.priceOf(b) - shop.priceOf(a))
      .slice(0, 5);

    const lines = [
      `With *${hours}h* at *T${tier} ${tierName}* (~*${Math.round(earnedRe)} RE* banked, ~*${estimatedPx} px* earned):`,
      "",
    ];

    if (affordable.length > 0) {
      lines.push("*Items in your range right now:*");
      for (const item of affordable) {
        lines.push(`• *${item.name}* (${shop.priceOf(item).toLocaleString()} px)`);
      }
    } else {
      lines.push(`Keep building! The lowest priced item starts slightly above ${estimatedPx} px.`);
    }

    return {
      source: "Pixl Calculator",
      direct: true,
      answer: lines.join("\n").trim(),
    };
  }

  // Case 3: General hours & payout calculation ("calculate payout for 20 hours at T3")
  if (hours !== null) {
    const bankedRe = Math.round(currentRe + (hours * rateRe));
    const startRateUsd = shop.payoutUsdPerHour(currentRe, economy);
    const finalRateUsd = shop.payoutUsdPerHour(bankedRe, economy);
    const floorPx = Math.round(hours * shop.pxPerHour(0, economy));

    const lines = [
      `*Payout Calculation for ${hours}h at T${tier} ${tierName} (${rateRe} RE/h):*`,
      "",
      `• *Restoration Energy (RE):* +${Math.round(hours * rateRe)} RE banked (Total: *${bankedRe} RE*)`,
      `• *Hourly Rate:* Starts at *$${startRateUsd.toFixed(2)}/h* (scales to *$${finalRateUsd.toFixed(2)}/h* as RE builds up)`,
      `• *Estimated Pixels:* ~*${floorPx.toLocaleString()} px* earned`,
      "",
      `_Tip: Higher tier projects (T3/T4) bank RE faster, boosting your payout toward the $6.00/h max rate sooner._`,
    ];

    return {
      source: "Pixl Calculator",
      direct: true,
      answer: lines.join("\n").trim(),
    };
  }

  return null;
}

module.exports = {
  parseHours,
  parseRe,
  isCalculatorQuery,
  directAnswer,
};
