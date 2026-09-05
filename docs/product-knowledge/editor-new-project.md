# Editor New Project

Date: 2026-07-03.
Status: `public`.

## What changed?

The editor now exposes new project creation as a first-class chrome action
instead of an icon-only `+` button.

## What can the user do now?

Users can start a blank editable project directly from the editor without going
to the project browser or interpreting an unlabeled icon.

## How does the user operate it?

- Click **New project** beside the top-left document chip.
- Or open the Cloud projects popover and choose **Projects > New project**.

Both affordances route through `/editor?newProject=1`, so the existing
replacement guard remains in charge.

## What should a reviewer manually verify?

- The top-left new project action is visible as text on desktop chrome and falls
  back to an icon with tooltip on narrower widths.
- The Cloud projects popover includes **New project** above **Open projects**.
- Starting a new project over unsaved or local-only work still shows the
  save/backup/start-without-saving guard.

## What is still intentionally limited?

New project creation starts from the standard blank document and replaces the
current Working Copy after its recovery guard. Additional independent Working
Copies are opened from Projects; template selection is still outside this
workflow.
