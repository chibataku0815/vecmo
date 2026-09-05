# Agent Scene Batch Missing Node Cleanup

Status: internal.

This internal cleanup keeps the agent scene command compiler behavior unchanged
while consolidating the repeated missing-node issue creation used by array-batch
commands. The helper preserves submitted node-id ordering, duplicate ids, issue
code, severity, message text, and node target payloads.

No product behavior or public surface changes.
