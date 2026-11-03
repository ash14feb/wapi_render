// Usage: node scripts/reset-ai-auto-pauses.js
// Re-enables the AI agent for conversations that the old policy-violation /
// repeated-error logic paused automatically (aiEnabled=false + handoffAt set).
// Conversations paused explicitly from the inbox (handoffAt null) are untouched.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const paused = await prisma.aiConversationState.findMany({
    where: { aiEnabled: false, handoffAt: { not: null } },
    select: { id: true, conversationId: true },
  });
  if (paused.length === 0) {
    console.log("No auto-paused conversations found.");
    return;
  }

  await prisma.aiConversationState.updateMany({
    where: { id: { in: paused.map((row) => row.id) } },
    data: { aiEnabled: null },
  });
  await prisma.conversation.updateMany({
    where: {
      id: { in: paused.map((row) => row.conversationId) },
      status: "PENDING_HUMAN",
    },
    data: { status: "OPEN" },
  });

  console.log(`Re-enabled the AI agent for ${paused.length} conversation(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
