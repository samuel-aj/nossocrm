# Personal CRM notifications — approved design

Samuel approved implementation on STAGING only. Each user can enable incoming
client-message notifications, choose own leads or every visible lead, and enable
new-lead notifications for individually selected boards. Creation and transfer
into a board count; moving stages, editing/deleting a message and outgoing
messages do not. Defaults are off. Preferences persist per user/organization.

Reuse the global bell with a preferences modal and a recent personal-event list.
Use the existing design-system modal and form controls. Alerts appear in the CRM;
desktop alerts appear while the CRM is open in another tab, subject to browser
permission. Sound is optional, enabled through a user gesture. Clicking opens
the exact chat or lead. No background push with all CRM tabs closed.

Capture events transactionally in a service-only journal using narrowly scoped
triggers; store source IDs rather than message content. Authenticated API filters
organization, board/team ownership, WhatsApp connection and labels on every
read. Store settings in a service-only per-user table. Never accept user/org IDs
from a request body. No changes to WhatsApp sending or webhook crypto.

Global polling stays mounted across screens and runs in background tabs. A
short overlap and event-ID deduplication prevent skipped in-flight transactions.
Only events after the initial live-session baseline (and at most two minutes
old) produce alerts; enabling a category resets its baseline. Multiple tabs
coordinate presentation using Web Locks and per-user/org local storage. The
same-origin event is broadcast to the visible tab; one tab emits sound/desktop.
Browser suspension, revoked permission, sound autoplay restrictions and offline
state degrade gracefully. Saved preferences never imply browser permission.

Tests: trigger capture/transfer/no-update exclusions, per-user settings and
cross-organization authorization, current permission filtering, no old-event
burst, duplicate IDs across polls/tabs, desktop permission denial and UI controls.
STAGING demo events are explicitly simulated and send no WhatsApp messages.
