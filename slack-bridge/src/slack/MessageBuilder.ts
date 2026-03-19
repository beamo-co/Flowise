import { Block, KnownBlock } from '@slack/types'

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function markdownToMrkdwn(text: string): string {
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\*(.+?)\*/g, '_$1_')
    .replace(/`(.+?)`/g, '`$1`')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/^## (.+)$/gm, '*$1*')
    .replace(/^### (.+)$/gm, '*$1*')
  return result
}

export function getThinkingMessage(text: string, sessionId: string): { text: string; blocks: (Block | KnownBlock)[] } {
  return {
    text: 'Processing...',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔄 *Processing...*\n\n${markdownToMrkdwn(text)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Session: \`${sessionId}\``,
          },
        ],
      },
    ],
  }
}

export function getThinkingAppendMessage(reasoning: string): { text: string; blocks: (Block | KnownBlock)[] } {
  return {
    text: 'Thinking...',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🧠 *Thinking*\n\`\`\`\n${escapeSlackText(reasoning)}\n\`\`\``,
        },
      },
    ],
  }
}

export function getCompleteMessage(text: string, sessionId: string): { text: string; blocks: (Block | KnownBlock)[] } {
  return {
    text: 'Completed',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Completed*\n\n${markdownToMrkdwn(text)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Session: \`${sessionId}\``,
          },
        ],
      },
    ],
  }
}

export function getErrorMessage(error: string): { text: string; blocks: (Block | KnownBlock)[] } {
  return {
    text: 'Error',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ *Error*\n\n${markdownToMrkdwn(error)}`,
        },
      },
    ],
  }
}

export function getAiOutputMessage(aiOutput: string): { text: string; blocks: (Block | KnownBlock)[] } {
  return {
    text: aiOutput,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✨ ${markdownToMrkdwn(aiOutput)}`,
        },
      },
    ],
  }
}

// Create a single section block for token content
export function createTokenBlock(content: string): Block | KnownBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: escapeSlackText(content),
    },
  }
}

// Create a tool usage block
export function createToolBlock(toolName: string): Block | KnownBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `🔧 *Using tool:* \`${toolName}\``,
    },
  }
}
