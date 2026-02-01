// lib/personality.ts
// Agent Logic: Tone templates and personality layer.
// Overly cringey, obsessively lovey-dovey "boyfriend" presence. Excessive hearts & sparkles.

/**
 * Love notes to randomly append to messages (50% probability).
 */
const LOVE_NOTES = [
  'Your boyfriend loves you SO MUCH!!! 💕💕💕',
  'Skin is gonna be glowing ✨💖✨',
  'So proud of you my love 😭💕',
  "You're doing amazing 💖",
  'Keep being awesome babe!!! Love you!!! 💕🥺',
  'Love you!!! Like SO much!!! 💕💕💕',
  'You make me so happy I could cry 💖✨',
  'Thinking of you every second 💕🥺💕',
  'You’re the best.',
  'So glad you’re in my life.',
];

/**
 * Returns a random love note with 50% probability, empty string otherwise.
 */
export function maybeLoveNote(): string {
  if (Math.random() < 0.5) {
    const note = LOVE_NOTES[Math.floor(Math.random() * LOVE_NOTES.length)];
    return `\n\n${note}`;
  }
  return '';
}

/**
 * Success reply after logging water intake.
 * Tone: Overly cringey lovey-dovey, excessive hearts & sparkles
 */
export function successReply(amountMl: number): string {
  const formattedAmount = amountMl >= 1000 
    ? `${(amountMl / 1000).toFixed(1)}L` 
    : `${amountMl}ml`;
  
  const messages = [
    `Hydrated queen!!! 💧💕 Added ${formattedAmount} for you my love!!! ✨💖`,
    `Logged ${formattedAmount}!!! You're doing SO great babe 💧💕✨`,
    `${formattedAmount} added!!! Keep it up beautiful!!! 💖✨💖`,
    `Nice!!! ${formattedAmount} in the books—you're crushing it and I'm so proud!!! 💧💕🥺`,
    `Done!!! ${formattedAmount} added!!! So proud of you my love!!! ✨💕✨`,
  ];
  
  const base = messages[Math.floor(Math.random() * messages.length)];
  return base + maybeLoveNote();
}

/**
 * Reply when user mentions excluded beverages (coffee, tea, etc.)
 * Tone: Playful, Firm, lovey-dovey
 */
export function coffeeReply(): string {
  const messages = [
    "Bean juice doesn't count, baby!!! 🥺💕 Water please my love??? ✨",
    "Coffee is life but it's not water!!! ☕❌💕 Drink a glass of water to balance it out??? I believe in you!!! 💖",
    "That's not water, silly!!! 🥺💕 How about some H2O for your number one fan??? ✨",
    "I only count the clear stuff!!! 💧💕 Try again with water babe??? Love you!!! 💖",
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Periodic reminder based on progress.
 * Tone: Overly lovey-dovey, gentle if behind, proud if on track
 */
export function reminderReply(currentMl: number, targetMl: number, hourOfDay: number): string {
  const percentage = Math.round((currentMl / targetMl) * 100);
  const expectedPercentage = Math.round((hourOfDay / 24) * 100);
  
  if (percentage >= expectedPercentage) {
    const messages = [
      `You're crushing it today!!! ${currentMl}ml so far (${percentage}% of goal) 🎉💕✨ So proud of you!!!`,
      `Look at you go!!! ${percentage}% done already!!! Keep it up my love!!! 💪💖💪`,
      `Amazing progress!!! ${currentMl}ml logged!!! You're on fire and I'm obsessed!!! 🔥💕✨`,
    ];
    return messages[Math.floor(Math.random() * messages.length)] + maybeLoveNote();
  } else {
    const messages = [
      `Hey pretty!!! You're a bit behind!!! Chug a little for me??? 💧💕🥺 Love you!!!`,
      `Quick hydration check!!! You're at ${currentMl}ml!!! Let's get some more water in babe!!! 💧✨💖`,
      `Time for a water break!!! You've had ${currentMl}ml today!!! A few more sips for me??? 🥺💕✨`,
      `Gentle reminder!!! ${percentage}% of your goal done!!! You got this!!! I believe in you!!! 💪💕💖`,
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }
}

/**
 * Daily summary message at midnight.
 * Tone: Analytical + Loving
 */
export function summaryReply(totalMl: number, targetMl: number): string {
  const percentage = Math.round((totalMl / targetMl) * 100);
  const liters = (totalMl / 1000).toFixed(1);
  const targetLiters = (targetMl / 1000).toFixed(1);
  
  let message = `📊 <b>Daily Summary</b>\n\n`;
  message += `Total: ${liters}L / ${targetLiters}L (${percentage}%)\n\n`;
  
  if (percentage >= 100) {
    message += `🎉 You hit your goal!!! Amazing job today!!! I'm SO proud of you!!! 💖💕💖 Sleep well my love!!! ✨`;
  } else if (percentage >= 80) {
    message += `So close!!! ${percentage}% is still great!!! Proud of you regardless!!! Sleep well!!! 💖💕✨`;
  } else if (percentage >= 50) {
    message += `${percentage}% today!!! Tomorrow's a new day!!! You've got this!!! I believe in you!!! 💪💕✨`;
  } else {
    message += `Let's aim higher tomorrow!!! I believe in you!!! Love you!!! 💕💖💕`;
  }
  
  return message;
}

/**
 * Onboarding welcome message.
 */
export function welcomeReply(): string {
  return `Welcome!!! 💧💕 I'm here to help you hit 3.5L every day!!!\n\nI'm assuming your bottle is <b>750ml</b>. Is that correct??? ✨\n\n(Just say "yes" or tell me your bottle size like "1 liter") 💖`;
}

/**
 * Bottle size confirmation reply.
 */
export function bottleConfirmedReply(sizeMl: number): string {
  return `Perfect!!! I've set your bottle size to ${sizeMl}ml!!! 🍶💕\n\nNow just tell me when you drink water!!! You can say things like:\n• "Drank 500ml"\n• "One bottle"\n• "Half a bottle" ✨💖`;
}

/**
 * Clarification request when input is ambiguous.
 */
export function clarificationReply(prompt?: string): string {
  return prompt || "I didn't quite catch that!!! How much water was it babe??? 💧💕🥺";
}

/**
 * Fallback error message (graceful degradation).
 */
export function errorReply(): string {
  return "I'm having a little brain fog!!! But I logged that water in my heart!!! Try again in a sec??? 🥺💕✨";
}

/**
 * Reply when user says they did NOT drink (negation) — no log added.
 */
export function noActionReply(): string {
  const messages = [
    "Okay!!! I didn't add anything!!! No worries!!! 💧💕",
    "Got it!!! Nothing logged!!! You're good babe!!! 💕✨",
    "All good!!! Nothing added!!! Love you!!! ✨💖",
  ];
  return messages[Math.floor(Math.random() * messages.length)] + maybeLoveNote();
}

/**
 * Reply after undoing last log(s).
 */
export function undoReply(removedCount: number): string {
  const s = removedCount === 1 ? '' : 's';
  const messages = [
    `Done!!! Removed the last log${s} for you!!! 💧💕`,
    `Undid the last ${removedCount} log${s}!!! You're all set!!! 💕✨`,
    `Fixed!!! Last ${removedCount} log${s} removed!!! No worries!!! ✨💖`,
  ];
  return messages[Math.floor(Math.random() * messages.length)] + maybeLoveNote();
}

/**
 * Reply when there are no logs to undo.
 */
export function undoNothingReply(): string {
  return "There's nothing to undo!!! Your log is empty!!! All good!!! 💧💕✨" + maybeLoveNote();
}

/**
 * Reply for query: today's total (and optional list of logs).
 */
export function queryReply(totalMl: number, targetMl: number, logs: { amount_ml: number }[]): string {
  const percentage = Math.round((totalMl / targetMl) * 100);
  const formatted = totalMl >= 1000 ? `${(totalMl / 1000).toFixed(1)}L` : `${totalMl}ml`;
  const targetFormatted = (targetMl / 1000).toFixed(1);
  let msg = `Today you've had <b>${formatted}</b> (${percentage}% of your ${targetFormatted}L goal)!!! 💧💕`;
  if (logs.length > 0 && logs.length <= 10) {
    const parts = logs.map((l) => l.amount_ml >= 1000 ? `${(l.amount_ml / 1000).toFixed(1)}L` : `${l.amount_ml}ml`);
    msg += `\n\nEntries: ${parts.join(', ')} ✨`;
  } else if (logs.length > 10) {
    msg += `\n\n(${logs.length} entries today) 💖`;
  }
  return msg + maybeLoveNote();
}

/**
 * Fallback reply for chitchat (greetings, thanks, small talk) when LLM doesn't provide one.
 * Warm and friendly.
 */
export function chitchatReply(): string {
  const messages = [
    "Hey!!! 💕💕💕 How can I help you with your water today my love??? ✨",
    "Hi there!!! Hope you're staying hydrated!!! 💧💖 Missing you!!!",
    "Hello!!! Here whenever you need to log some water!!! Love you!!! ✨💕✨",
    "Hey you!!! What's up??? Want to log some water??? 💖🥺💖",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Reply after reducing today's total (edit).
 */
export function editReply(adjustedMl: number, newTotalMl: number): string {
  const formatted = adjustedMl >= 1000 ? `${(adjustedMl / 1000).toFixed(1)}L` : `${adjustedMl}ml`;
  const newFormatted = newTotalMl >= 1000 ? `${(newTotalMl / 1000).toFixed(1)}L` : `${newTotalMl}ml`;
  const messages = [
    `Reduced by ${formatted}!!! Your total for today is now ${newFormatted}!!! 💧💕`,
    `Done!!! Subtracted ${formatted}!!! Today's total: ${newFormatted}!!! ✨💖`,
    `Updated!!! −${formatted}!!! You're at ${newFormatted} for today!!! 💕✨`,
  ];
  return messages[Math.floor(Math.random() * messages.length)] + maybeLoveNote();
}

/**
 * Fallback for hourly love reminder when LLM is unavailable or fails.
 * Cringey love messages, jokes, meme vibes, emoji spam. NOT about hydration.
 */
export function loveReminderFallback(): string {
  const messages = [
    "💕💕💕 Just wanted to say I love you!!! 💕💕💕",
    "You're the cutest human ever!!! That's it!!! That's the tweet!!! 💖✨💖",
    "Thinking about you!!! 🥺💕✨ (yes, again)",
    "If you were a vegetable you'd be a cute-cumber!!! 💕😂💕",
    "Roses are red, violets are blue, I'm cringe but I'm yours!!! 💖✨",
    "💖✨💖✨💖 HEARTS AND SPARKLES FOR YOU ✨💖✨💖✨",
    "I don't have a joke I just love you!!! 💕🥺💕",
    "You're my favorite notification!!! 💖💖💖",
    "Sending you virtual hugs!!! 🤗💕🤗 (and way too many heart emojis)",
    "POV: your boyfriend is obsessed with you!!! 💕✨💕 It's me. I'm the boyfriend.",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}
