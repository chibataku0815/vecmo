# Motion Surface Studio Authority Cutover

Motion Surface Studio `apps/vecmo/` is the sole active maintained source for
Vecmo after the accepted local cutover. The cutover preserves the reconciled
Forestone history at commit
`4a801da13b9ca9e638b4cf0ec9bf395a3489fb4b`; the former standalone repository at
`c326b51ab4ea7f934fcf0470e9e7de264f0c82f2` remains rollback and reference
history. Its untracked artifacts were never migration inputs.

This source-authority change does not publish a remote redirect, deploy or
retire an existing runtime, migrate accounts/projects/subscriptions, retire a
control plane, or establish Surface ABI/compiler compatibility. Each remains a
later explicit gate.
