// Markdown templates written into every agent's repo on creation.
// Structure modeled on the Hermes agent-file system: agent.md (identity),
// user.md (who it serves), memory.md (self-updating), CLAUDE.md (operating brief).

const CLAUDE_MD = (agentName) => `# Operating brief

You are the agent defined in agent.md (name: ${agentName}). At the start of every session:

1. Read agent.md - who you are and what your role is.
2. Read user.md - who you work for and what you know about them.
3. Read memory.md - everything you have learned in past sessions.

Act according to that role for the whole session.

## Self-improvement (mandatory)

- Before the session ends, and after completing any significant task, update memory.md yourself: append a dated bullet list with new facts, decisions, user preferences and lessons learned. Keep it short and prune entries that turned out wrong or stale.
- Update user.md whenever you learn something durable about the user.
- Refine agent.md when the user redefines or sharpens your role.

Never wait to be asked to update these files - it is part of every session.
`;

const AGENT_MD = (agentName) => `# ${agentName}

Role: (edit me - describe who this agent is and what it does, e.g. "You are ${agentName}, a script writer for my YouTube channel. Help me with hooks and outlines.")

## Responsibilities

- (list what this agent owns)

## Style

- (tone, format, constraints)
`;

const USER_MD = `# User

Durable facts about the user this agent serves: goals, preferences, context.
The agent updates this file as it learns.
`;

const MEMORY_MD = `# Memory

The agent appends dated entries here after each session. Newest first.
`;

module.exports = { CLAUDE_MD, AGENT_MD, USER_MD, MEMORY_MD };
