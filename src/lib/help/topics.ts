import { routes } from "../../app/routes";

export interface HelpTopic {
  /** Stable route id from `app/routes.ts`. */
  id: string;
  title: string;
  purpose: string;
  steps: string[];
  tips?: string[];
  /** Input or business rules enforced by the screen or the core. */
  rules?: string[];
}

/**
 * Per-screen help. This is documentation the interface shows in place, not
 * marketing copy: every entry names what the screen is for, the short path
 * through it, and the rules that reject bad input.
 *
 * `check-help-coverage.mjs` fails when a registered route has no entry, when an
 * entry names a route that no longer exists, or when a step claims a path that
 * does not resolve.
 */
export const helpTopics: HelpTopic[] = [
  {
    id: "launch",
    title: "Launch",
    purpose:
      "Verifies the local database, the schema version, and the encryption key before any workspace opens.",
    steps: [
      "Wait for the three checks to finish.",
      "If a check fails, the message names the part that did not answer.",
      "Choose a workspace once the checks pass.",
    ],
    tips: ["The launch screen never writes data. It only reads and reports."],
  },
  {
    id: "welcome",
    title: "Welcome",
    purpose:
      "Choose how to enter: the bundled demo, an existing account on this device, or a new organization.",
    steps: [
      "Choose Open demo workspace to explore with seeded records.",
      "Choose Sign in if this device already has your account.",
      "Choose Create an organization to start with an empty workspace.",
    ],
    tips: ["The demo is a separate organization. Anything you change there stays in that demo."],
  },
  {
    id: "sign-in",
    title: "Sign in",
    purpose: "Opens the local account that owns a workspace on this device.",
    steps: [
      "Enter the email and password for an account on this device.",
      "Choose Sign in.",
      "Use Forgot password if the account has a recovery email.",
    ],
    rules: [
      "Both fields are required. A password is at least 8 characters.",
      "A wrong password never says whether the email exists; the message is the same for both cases.",
      "After a failed attempt the wait starts at 30 seconds, doubles for each further miss, and stops growing at 5 minutes.",
    ],
  },
  {
    id: "create-account",
    title: "Create account",
    purpose:
      "Creates a local identity. It proves who you are; it does not grant a role in any organization.",
    steps: [
      "Enter your name, email, and a password.",
      "Choose Create account.",
      "Pick an organization next: create one, or join with a code.",
    ],
    rules: [
      "Name and email are required, and the email must look like an address.",
      "The password is at least 8 characters and must match the confirmation.",
      "An email already on this device is refused without revealing which account owns it.",
    ],
  },
  {
    id: "volunteer-onboarding",
    title: "Volunteer onboarding",
    purpose:
      "Turns an account into a volunteer profile with skills, causes, availability, and contact details.",
    steps: [
      "Add the skills you can use on site.",
      "Choose the causes you want to serve.",
      "Mark the windows when you are usually free.",
      "Save the profile and browse opportunities.",
    ],
    rules: [
      "A name and a contact email are required.",
      "Availability is a preference, not a commitment. A coordinator still needs a confirmed registration.",
      "Skills drive matching. AutoRoster will not place you in a role that needs a skill you have not listed.",
    ],
  },
  {
    id: "volunteer-home",
    title: "Volunteer home",
    purpose: "Shows the next confirmed shift and the opportunities that fit your profile.",
    steps: [
      "Read the next shift card for the time and meeting point.",
      "Open a recommended opportunity to compare it.",
      "Use My Schedule for everything already confirmed.",
    ],
    tips: [
      "Recommendations explain the match: skills, availability, and cause are named, not scored in secret.",
    ],
  },
  {
    id: "discover",
    title: "Discover",
    purpose: "Browse open opportunities ranked against your skills, availability, and causes.",
    steps: [
      "Filter by cause or distance.",
      "Open an opportunity to read the roles and requirements.",
      "Save an opportunity to compare it later.",
    ],
    tips: [
      "A match score is an ordering aid. The reasons under each card are what you should read.",
    ],
  },
  {
    id: "opportunity-detail",
    title: "Opportunity detail",
    purpose: "Reads the full program, its shifts, and its requirements before you claim a seat.",
    steps: [
      "Check the address, time, and what to bring.",
      "Choose the shift and the role that fits you.",
      "Confirm the seat. It appears on My Schedule immediately.",
    ],
    rules: [
      "A seat is only held once you confirm it.",
      "A role that requires a credential cannot be claimed with an expired or missing credential.",
      "A full shift offers the waitlist instead of a seat.",
    ],
  },
  {
    id: "saved",
    title: "Saved opportunities",
    purpose: "Keeps a shortlist across visits without claiming a seat.",
    steps: [
      "Open a saved opportunity to read it again.",
      "Remove one with Save again when it no longer fits.",
    ],
  },
  {
    id: "my-schedule",
    title: "My schedule",
    purpose: "Lists every confirmed shift, the hours attached to it, and the cancel action.",
    steps: [
      "Open a shift to read the arrival instructions.",
      "Cancel at least 24 hours ahead when plans change.",
      "Check the status after a cancellation.",
    ],
    rules: [
      "Canceling frees the seat and offers it to the first eligible waitlisted volunteer.",
      "The cancellation, the promotion, and the roster change are written to the audit log.",
    ],
  },
  {
    id: "volunteer-shift",
    title: "Shift detail",
    purpose:
      "Collects the time, meeting point, role, checklist, and check-in action for one shift.",
    steps: [
      "Read the arrival instructions and checklist.",
      "Add the shift to your calendar.",
      "Open Check in when you arrive.",
    ],
    tips: ["The shift lead sees your check-in time, not your location."],
  },
  {
    id: "check-in",
    title: "Check in",
    purpose: "Records arrival with the six-digit code shown at the event.",
    steps: [
      "Enter the six-digit code from the check-in table.",
      "Choose Check in.",
      "Keep the confirmation; your hours stay pending until a coordinator reviews them.",
    ],
    rules: [
      "The code is six digits and is checked against the active code for the shift.",
      "Code entry opens 30 minutes before the shift and closes 15 minutes after it starts.",
      "If the window has closed, ask the shift lead for a manual check-in.",
    ],
  },
  {
    id: "my-hours",
    title: "My hours",
    purpose: "Shows submitted service time and whether a coordinator has verified it.",
    steps: [
      "Read the pending total and the approved total.",
      "Open an entry to see the evidence behind it.",
      "Ask a coordinator about an entry that looks wrong.",
    ],
    rules: [
      "Only approved time counts toward a verified service record and an official certificate.",
    ],
  },
  {
    id: "personal-impact",
    title: "Personal impact",
    purpose:
      "Converts your approved service into the outcomes the organization records, such as meals packed or sessions tutored.",
    steps: [
      "Read the approved hours at the top.",
      "Compare the outcome figures with the programs you served.",
      "Share the summary or print it.",
    ],
    tips: [
      "Outcomes are recorded per program, not multiplied from your hours. The page shows what the organization actually logged.",
    ],
  },
  {
    id: "service-verification",
    title: "Service verification",
    purpose: "Produces an official record of approved service that another organization can check.",
    steps: [
      "Choose the period you need.",
      "Check the totals against My Hours.",
      "Print the record or copy its verification code.",
    ],
    rules: [
      "The record excludes pending and rejected entries, so it always matches the review queue.",
    ],
  },
  {
    id: "volunteer-profile",
    title: "Volunteer profile",
    purpose:
      "Keeps your contact details, skills, causes, availability, photo, and credentials current.",
    steps: [
      "Update a section and save it.",
      "Add a credential with its expiry date.",
      "Review availability before a new season starts.",
    ],
    rules: [
      "An email must look like an address, and a phone number is optional.",
      "A credential needs a name and a valid-through date. An expired credential does not satisfy a role.",
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    purpose: "Shows coverage, waitlist, hours, and credential alerts that need your attention.",
    steps: [
      "Open an unread notification.",
      "Follow its link to the record it names.",
      "Mark the rest read once you have acted.",
    ],
  },
  {
    id: "mission-control",
    title: "Mission Control",
    purpose: "Turns stored shifts, roles, and hours into the few decisions that matter today.",
    steps: [
      "Read the greeting line for today and the next shift.",
      "Work through Needs attention from left to right.",
      "Use Staff next week to open AutoRoster when a gap exists.",
      "Open the weekly chart's data table for the exact seat fill by day.",
    ],
    tips: [
      "A metric is a link. The number and the list behind it always agree because both read the same records.",
    ],
  },
  {
    id: "coverage",
    title: "Coverage command center",
    purpose:
      "Separates role coverage from seat fill so an empty required role is not hidden by a healthy headcount.",
    steps: [
      "Filter by date range or cause.",
      "Read the health label on each shift.",
      "Open a shift to see which role is short.",
    ],
    tips: [
      "Critical means a required role is empty and seat fill is under 70%.",
      "At risk means an open required role or seat fill under 86%.",
    ],
  },
  {
    id: "autoroster",
    title: "AutoRoster",
    purpose: "Builds an explainable staffing plan for open roles without booking anyone.",
    steps: [
      "Choose the shifts or the date window.",
      "Build the plan and read the reasons beside each suggestion.",
      "Remove anyone who should not be assigned.",
      "Apply the plan and review the roster.",
    ],
    rules: [
      "A volunteer is never double-booked into overlapping shifts.",
      "Availability, role requirements, credential validity, and the 7-day rest rule are checked before a suggestion appears.",
      "A plan is a proposal. Nothing reaches the roster until you apply it.",
    ],
  },
  {
    id: "schedule",
    title: "Schedule",
    purpose:
      "Plans and inspects shifts across programs, with role gaps visible without leaving the calendar.",
    steps: [
      "Filter by cause or by shifts with role gaps.",
      "Select a day to see its shifts.",
      "Open a shift to edit its roster or its time.",
    ],
    rules: [
      "A shift must end after it starts.",
      "A shift cannot be scheduled in the past.",
      "Capacity must be a positive number.",
    ],
  },
  {
    id: "opportunities",
    title: "Opportunities",
    purpose:
      "Manages the programs volunteers browse, including their shifts, capacity, and fill rate.",
    steps: [
      "Search or filter the program list.",
      "Open a program to see its shifts and impact.",
      "Create a program when you need a new one.",
    ],
  },
  {
    id: "create-opportunity",
    title: "Create opportunity",
    purpose: "Creates a program and its first shifts in one guided flow.",
    steps: [
      "Describe the service.",
      "Confirm the title, cause, address, and capacity.",
      "Add the roles each shift needs.",
      "Publish the opportunity.",
    ],
    rules: [
      "A title, a cause, and a capacity are required.",
      "Capacity must be at least 1 and cannot be lower than the confirmed roster.",
      "Role requirements cannot add up to more seats than the shift has.",
    ],
  },
  {
    id: "opportunity-management",
    title: "Opportunity management",
    purpose: "Edits one program and shows its shifts, fill rate, and recorded impact.",
    steps: [
      "Read the fill rate and the open roles.",
      "Edit the details volunteers see.",
      "Open a shift to change its roster.",
    ],
  },
  {
    id: "coordinator-shift",
    title: "Shift detail",
    purpose: "Shows the live roster, waitlist, and role coverage for one shift.",
    steps: [
      "Check each role against its required count.",
      "Promote the next eligible volunteer from the waitlist.",
      "Open attendance when the event starts.",
    ],
    rules: [
      "The waitlist is first in, first out, and a promoted volunteer must still fit the role.",
      "A promotion is written to the audit log with the role and position.",
    ],
  },
  {
    id: "volunteers",
    title: "Volunteers",
    purpose: "Searches the volunteer database by name, skill, status, or availability.",
    steps: [
      "Search by name or filter by skill.",
      "Open a profile for attendance, credentials, and history.",
      "Invite a new volunteer from Organization and access.",
    ],
  },
  {
    id: "volunteer-detail",
    title: "Volunteer detail",
    purpose:
      "Shows one volunteer's contact details, skills, credentials, attendance, and service history.",
    steps: [
      "Read the credential register for anything expiring.",
      "Check attendance before a last-minute assignment.",
      "Use the history to start a retention conversation.",
    ],
    tips: [
      "Only members of the selected organization appear here. Another organization's roster is not readable from this screen.",
    ],
  },
  {
    id: "applications",
    title: "Recruitment pipeline",
    purpose: "Moves applicants from applied to review to onboarding with a recorded decision.",
    steps: [
      "Open an applicant card.",
      "Choose the next stage and add a note.",
      "Finish onboarding with a profile and availability.",
    ],
    rules: ["A stage change is written to the audit log with the actor and the previous stage."],
  },
  {
    id: "credentials",
    title: "Credentials and skills",
    purpose: "Compares credential supply with scheduled demand and flags anything expiring.",
    steps: [
      "Read the flagged renewals, soonest first.",
      "Open the volunteer record to verify a document.",
      "Check the demand column before scheduling a credentialed role.",
    ],
    tips: [
      "A credential is warned about 45 days before expiry and blocks a role assignment once it expires.",
    ],
  },
  {
    id: "attendance",
    title: "Attendance",
    purpose: "Checks volunteers in and out, records no-shows, and shows who is on site.",
    steps: [
      "Choose the shift.",
      "Find the volunteer and record check-in or check-out.",
      "Mark a no-show only after the arrival window has closed.",
    ],
    rules: ["Every attendance change is written to the audit log with a timestamp and actor."],
  },
  {
    id: "kiosk",
    title: "Check-in kiosk",
    purpose:
      "Runs check-in at the door with a rotating six-digit code that works without a network.",
    steps: [
      "Open the kiosk for the shift.",
      "Show the code to arriving volunteers.",
      "Watch the arrival list update as people check in.",
    ],
    rules: [
      "The code rotates every 15 minutes and is validated by the local core, not by the page.",
    ],
    tips: [
      "The kiosk writes to the same local database as the roster. It does not need a connection.",
    ],
  },
  {
    id: "hours-review",
    title: "Hours review",
    purpose: "Approves, adjusts, or rejects submitted service time with evidence.",
    steps: [
      "Choose a request from the queue.",
      "Compare the submitted time with attendance.",
      "Approve, adjust, or reject with a reason.",
    ],
    rules: [
      "An adjustment changes the approved minutes and requires a reason.",
      "A rejection requires a reason.",
      "Approved time is what reaches reports, certificates, and impact totals.",
    ],
  },
  {
    id: "reports",
    title: "Reports",
    purpose: "Runs the participation, coverage, and impact reports the board asks for.",
    steps: [
      "Choose a template.",
      "Set the date range.",
      "Preview the report, then print it or export CSV.",
    ],
  },
  {
    id: "custom-report",
    title: "Custom report builder",
    purpose: "Builds a repeatable report from validated fields, filters, and grouping.",
    steps: [
      "Choose the fields you need.",
      "Add a filter and a grouping.",
      "Preview the rows before you save the view.",
    ],
    rules: [
      "At least one field is required.",
      "Fields come from the schema. The builder never accepts raw SQL.",
      "A date range must start before it ends.",
    ],
  },
  {
    id: "impact-analytics",
    title: "Impact analytics",
    purpose:
      "Shows recorded community outcomes by program and cause, with the rows behind each figure.",
    steps: [
      "Choose the period.",
      "Read the outcome cards against their programs.",
      "Open the table alternative for exact values.",
    ],
  },
  {
    id: "insights",
    title: "Retention and engagement",
    purpose: "Measures whether volunteers return within 30 days of a first shift.",
    steps: [
      "Read the return rate and the cohort it comes from.",
      "Compare causes to see where people come back.",
      "Use the signals to plan follow-up, not to rank people.",
    ],
    tips: [
      "The denominator is volunteers who completed a first shift in that month. Someone who served twice counts once.",
    ],
  },
  {
    id: "impact-report",
    title: "Impact report preview",
    purpose:
      "Previews the printable impact report built from approved hours and recorded outcomes.",
    steps: [
      "Choose the period.",
      "Check the figures against Reports.",
      "Print the preview as a PDF.",
    ],
    rules: [
      "Pending hours are excluded. The report states the period and the organization it covers.",
    ],
  },
  {
    id: "records",
    title: "Records",
    purpose:
      "Searches and exports the unified service record across volunteers, shifts, and hours.",
    steps: [
      "Search by person, program, or date.",
      "Filter to the records you need.",
      "Export the result as CSV.",
    ],
    tips: ["CSV headers repeat on every row so the file stays machine-readable after import."],
  },
  {
    id: "audit",
    title: "Audit log",
    purpose: "Shows every consequential write: who changed what, when, and why.",
    steps: [
      "Filter by actor or entity.",
      "Open an event for the detail and the record id.",
      "Use the log to explain a roster or hours decision.",
    ],
  },
  {
    id: "backup",
    title: "Installation backups",
    purpose: "Creates, validates, and restores complete copies of every workspace on this device.",
    steps: [
      "Create a snapshot before a risky change.",
      "Export a sealed archive when the copy leaves this device.",
      "Validate an archive before restoring it.",
    ],
    rules: [
      "A sealed archive needs a passphrase of at least 12 characters.",
      "A restore writes a safety copy first, then records the restore in the audit log.",
      "A snapshot protects against a mistake, not against hardware loss. Keep an off-device copy.",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    purpose:
      "Controls workspace defaults, accounts, notifications, language, and this device's connection.",
    steps: [
      "Change a workspace default and save it.",
      "Add or reset an account from the Accounts section.",
      "Connect or disconnect the shared workspace.",
      "Choose the language and accessibility preferences.",
    ],
    rules: [
      "A workspace change is written to the audit log.",
      "A coordinator can reset a password only for a member of the selected organization.",
      "The shared-workspace session is kept in the operating system credential store, not in the page.",
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility",
    purpose:
      "Sets text scale, contrast, motion, link underlines, and color-independent status cues.",
    steps: [
      "Choose a text scale and check a form.",
      "Turn on high contrast if the default is hard to read.",
      "Reduce motion if transitions are distracting.",
    ],
    tips: ["Preferences apply to every coordinator and volunteer screen on this device."],
  },
  {
    id: "organization-access",
    title: "Organization and access",
    purpose: "Manages members, roles, and invitation codes for the selected organization.",
    steps: [
      "Review the member list and each role.",
      "Create a coordinator or volunteer invitation.",
      "Revoke an invitation or remove a member.",
    ],
    rules: [
      "Only an owner can change another member's role.",
      "An invitation code works once and grants only the role shown.",
      "A member sees only the organizations they belong to.",
    ],
  },
  {
    id: "coordinator-start",
    title: "Coordinator onboarding",
    purpose:
      "Puts a new coordinator into an organization, either by creating one or joining with a code.",
    steps: [
      "Choose Create an organization or Join with a code.",
      "Enter the code exactly as it was shared.",
      "Finish the workspace details.",
    ],
    rules: ["A join code is single-use and expires. An expired code can be replaced by an owner."],
  },
  {
    id: "organization-create",
    title: "Create organization",
    purpose: "Creates the workspace, its timezone, its contact details, and its first join codes.",
    steps: [
      "Enter the organization name and contact email.",
      "Choose the timezone volunteers will see.",
      "Create the workspace and share a join code.",
    ],
    rules: [
      "A name and a contact email are required.",
      "The timezone must be a valid IANA zone.",
      "You become the owner of the organization you create.",
    ],
  },
  {
    id: "volunteer-start",
    title: "Find an organization",
    purpose: "Lists organizations that accept volunteers and takes a join code.",
    steps: [
      "Browse the organizations that are accepting volunteers.",
      "Choose one and enter its volunteer code.",
      "Finish your profile.",
    ],
    rules: ["A code only adds you to the organization it was issued for."],
  },
  {
    id: "forgot-password",
    title: "Forgot password",
    purpose: "Sends a one-time reset link to the account's recovery email.",
    steps: ["Enter the account email.", "Open the link on this device.", "Choose a new password."],
    rules: [
      "The response is the same whether or not the email exists.",
      "A link works once and expires after an hour.",
    ],
  },
  {
    id: "reset-password",
    title: "Reset password",
    purpose: "Chooses a new password from a valid recovery link.",
    steps: [
      "Enter the new password twice.",
      "Choose Reset password.",
      "Sign in with the new password.",
    ],
    rules: ["The password is at least 8 characters and both entries must match."],
  },
  {
    id: "auth-callback",
    title: "Email link",
    purpose: "Finishes a hosted sign-in or recovery link and returns you to the right screen.",
    steps: [
      "Wait for the link to be checked.",
      "Continue to the workspace if it succeeds.",
      "Request a fresh link if it expired.",
    ],
  },
  {
    id: "ask",
    title: "Ask CivicFlow",
    purpose: "Answers questions from the records on this device and names the rows it used.",
    steps: [
      "Ask in a sentence, such as which shifts are short this week.",
      "Read the answer and the records it cites.",
      "Open a cited record to check it yourself.",
    ],
    tips: [
      "Answers are computed from stored records, not generated. The same question returns the same answer.",
    ],
  },
  {
    id: "shared-workspace",
    title: "Shared workspace",
    purpose:
      "Opens the hosted organization's app inside the desktop window using the session already in the credential store.",
    steps: [
      "Connect the hosted account under Settings first.",
      "Choose Open shared workspace.",
      "Use Shared schedule for coordinator writes, or the framed app for the volunteer view.",
    ],
    tips: ["The frame adopts the desktop session. It never asks for a second password."],
  },
  {
    id: "shared-schedule",
    title: "Shared schedule",
    purpose:
      "Creates opportunities and shifts in the hosted organization while keeping a durable local queue for offline work.",
    steps: [
      "Create an opportunity, or choose an existing one and add a shift.",
      "Use the search above the lists to narrow by program, cause, address, or shift status. Long lists show one page at a time.",
      "Enter times in this computer's timezone; the command stores an absolute instant.",
      "Choose Sync now if the connection was down, then check the synced copy for the server's rows.",
    ],
    rules: [
      "A shift must end after it starts and has at least one seat.",
      "A slot cannot shrink below the volunteers already registered.",
      "An edit carries the row version it was opened at. The server refuses the edit when someone else changed the row first.",
      "Creating a shift needs at least one seat and an opportunity in the same organization.",
    ],
  },
  {
    id: "shared-participation",
    title: "Shared participation",
    purpose:
      "Records attendance, reviews hours, and applies a reviewed roster plan for one shift at a time.",
    steps: [
      "Choose the shift at the top of the screen.",
      "Check volunteers in or out, mark a no-show, or cancel a seat.",
      "Review pending hours, then approve the submitted total or reject with a reason.",
      "Use Quick plan to fill open role slots, review the names, and apply the plan.",
    ],
    rules: [
      "Check-in is refused before the window opens and after the shift ends.",
      "A no-show needs a registration and is recorded as an event.",
      "Approved minutes cannot exceed the submitted total, and a rejection needs a reason.",
      "A roster plan applies at the revision it was built from. If the revision moved, no assignment is applied.",
    ],
  },
  {
    id: "shared-volunteers",
    title: "Shared volunteers",
    purpose:
      "Keeps profiles, skills, weekly availability, and credentials for the hosted organization in one place.",
    steps: [
      "Search the directory by name, email, or skill, or filter to the people who need attention.",
      "Edit contact details or status and save the profile.",
      "Add or remove skills and paint the weekly availability grid, then save each set.",
      "Add a credential, or a credential type first when the organization has none.",
    ],
    rules: [
      "A profile edit carries the row version it was opened at; a stale copy is refused rather than overwritten.",
      "Skills are replaced as one set, so a retry cannot duplicate a name.",
      "Availability has three windows per day, and an invalid day or window is refused whole.",
      "A credential is verified through its valid-through date; an expired document blocks new assignments.",
    ],
  },
  {
    id: "shared-reports",
    title: "Shared impact report",
    purpose:
      "Turns verified service in the hosted organization into a funder-ready report without retyping a spreadsheet.",
    steps: [
      "Choose a range or set the first and last day, then narrow to one program if the update is program-specific.",
      "Read verified hours, volunteers, completed shifts, and attendance for that window.",
      "Check expiring credentials before publishing an assignment plan.",
      "Export CSV for a grant report, or preview the funder packet page by page before printing it. The preview is the print source, so its sheet count is the file's page count.",
    ],
    rules: [
      "The printed packet leaves out volunteer names and individual credentials.",
      "A packet names the eighteen programs with the most verified hours; the screen and the CSV keep every program.",
      "Hours count on the day they were served, not the day they were approved.",
      "A shift counts on the day it starts in this computer's timezone.",
      "Only verified hours enter the headline total; pending hours are shown separately.",
      "The report reads the synced copy, so it works offline and never edits a row.",
      "Expiring credentials are sixty days or less from their valid-through date.",
    ],
  },
  {
    id: "shared-conflicts",
    title: "Sync issues",
    purpose:
      "Shows every command the server refused, with the value this device held and the value the organization now has.",
    steps: [
      "Read the code and both values.",
      "Choose Keep server when the organization's value is correct, or Dismiss to close the issue without changing anything.",
      "Choose Rebuild from server if the replica itself needs to be taken again.",
    ],
    rules: [
      "A conflict is closed locally. Closing it does not edit the organization.",
      "A revoked membership makes queued privileged work stale; rebuilding takes the current authority and rows.",
    ],
  },
  {
    id: "shared-replica",
    title: "Synced copy",
    purpose:
      "Shows the hosted organization held in this computer's encrypted SQLite database and whether it is current.",
    steps: [
      "Read the connection state, cursor, revision, and last sync time.",
      "Choose Refresh to pull new changes, or Rebuild from server to replace the copy with current state.",
      "Use Shared schedule or Shared participation to make changes.",
    ],
    rules: [
      "Pulled rows and the cursor commit together, so an interrupted pull leaves the previous consistent copy.",
      "Switching hosted accounts clears the previous account's rows.",
    ],
  },
];

const byId = new Map(helpTopics.map((topic) => [topic.id, topic]));

const PARAMETERISED: { prefix: string; id: string }[] = [
  { prefix: "/volunteer/opportunities/", id: "opportunity-detail" },
  { prefix: "/volunteer/shifts/", id: "volunteer-shift" },
  { prefix: "/coordinator/opportunities/", id: "opportunity-management" },
  { prefix: "/coordinator/shifts/", id: "coordinator-shift" },
  { prefix: "/coordinator/volunteers/", id: "volunteer-detail" },
];

/** Resolve the help entry for a live URL, including parameterised screens. */
export function topicForPath(pathname: string): HelpTopic | undefined {
  const exact = routes.find((route) => route.path === pathname);
  if (exact) return byId.get(exact.id);
  const parameterised = PARAMETERISED.find(
    (entry) => pathname.startsWith(entry.prefix) && pathname.length > entry.prefix.length,
  );
  return parameterised ? byId.get(parameterised.id) : undefined;
}

/** The rules the help page lists as the product's validation contract. */
export function validationRules(): { title: string; rules: string[] }[] {
  return helpTopics
    .filter((topic) => (topic.rules?.length ?? 0) > 0)
    .map((topic) => ({ title: topic.title, rules: topic.rules ?? [] }));
}
