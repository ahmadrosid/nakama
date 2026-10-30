# Nakama

An agent platform where each org runs agent profiles that talk with people through web, CLI and messaging channels.

## Sessions

**Session**:
One conversation between people and an agent profile, with its history and the settings it runs with.
_Avoid_: Thread, conversation (for the stored thing)

**Session record**:
The stored row of a session: its owner, profile, channel, and run settings such as model and thinking effort.
_Avoid_: Session row, stored session

**Chat**:
A session made ready to take a turn: its history loaded, its tools, prompt and model set.
_Avoid_: Session object, live session

**Branch**:
A session copied from another session up to one message, so the user can try a different path from there.
_Avoid_: Fork

**Child chat**:
A session that a sub_agent run started from inside another session, nested under it. One level deep.
_Avoid_: Sub-session, branch

**Cognito chat**:
A session that is never stored; it exists only in memory and is gone when it ends.
_Avoid_: Ephemeral session, incognito chat

**Capability revision**:
A mark of what an agent profile may use (tools, skills, plugins) at a point in time; a chat built under an older revision is out of date.
_Avoid_: Capability version
