import { useEffect, useId, useState } from "react";
import { ArrowRight, ArrowLeft, X } from "lucide-react";
import { Link } from "react-router-dom";
import styles from "./FirstRunTour.module.css";

export type TourRole = "coordinator" | "volunteer";

interface TourStep {
  title: string;
  body: string;
  to: string;
  link: string;
}

const STEPS: Record<TourRole, TourStep[]> = {
  coordinator: [
    {
      title: "Start with Mission Control",
      body: "The dashboard turns stored shifts, roles, and hours into the few gaps that need a decision today. Every number opens the list behind it.",
      to: "/coordinator/mission-control",
      link: "Open Mission Control",
    },
    {
      title: "Coverage is not headcount",
      body: "Coverage counts required role slots. Seat fill counts people. A shift can be 75% full and still run without a driver, and this screen shows that.",
      to: "/coordinator/coverage",
      link: "Open Coverage",
    },
    {
      title: "AutoRoster proposes, you decide",
      body: "A plan follows availability, credential validity, and the rest rule, and explains every suggestion. Nothing reaches the roster until you apply it.",
      to: "/coordinator/autoroster",
      link: "Open AutoRoster",
    },
    {
      title: "The door works offline",
      body: "The kiosk validates a six-digit code against the local database and rotates it every 15 minutes. No network is involved.",
      to: "/coordinator/kiosk",
      link: "Open the kiosk",
    },
    {
      title: "A backup is a complete copy",
      body: "Snapshots can be validated and restored, and a sealed archive can leave the device encrypted. Create one before a risky change.",
      to: "/coordinator/backup",
      link: "Open Backup & recovery",
    },
  ],
  volunteer: [
    {
      title: "Find a shift that fits",
      body: "Discover ranks opportunities by skills, availability, and causes, and explains the match instead of hiding it.",
      to: "/volunteer/discover",
      link: "Browse opportunities",
    },
    {
      title: "Know before you arrive",
      body: "Your shift page collects the time, meeting point, role, checklist, and arrival instructions in one place.",
      to: "/volunteer/schedule",
      link: "Open My Schedule",
    },
    {
      title: "Check in at the door",
      body: "Enter the six-digit code from the check-in table. It opens 30 minutes before the shift and closes 15 minutes after it starts.",
      to: "/volunteer/check-in",
      link: "Open Check in",
    },
    {
      title: "Your hours become a record",
      body: "Approved service appears in My Hours and on an official verification record. Pending time never counts until a coordinator reviews it.",
      to: "/volunteer/hours",
      link: "Open My Hours",
    },
  ],
};

const EVENT = "civicflow:tour";
const storageKey = (role: TourRole) => `civicflow.tour.v1.${role}`;

function readStep(role: TourRole): number | "done" {
  try {
    const raw = window.localStorage.getItem(storageKey(role));
    if (raw === "done") return "done";
    const step = Number(raw);
    return Number.isInteger(step) && step >= 0 && step < STEPS[role].length ? step : 0;
  } catch {
    return 0;
  }
}

function writeStep(role: TourRole, value: number | "done") {
  try {
    window.localStorage.setItem(storageKey(role), String(value));
  } catch {
    // A blocked storage area only means the tour repeats next launch.
  }
}

/** Clears the saved position so the tour opens again from the first step. */
export function replayTour(role: TourRole): void {
  writeStep(role, 0);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { role } }));
}

export function FirstRunTour({ role }: { role: TourRole }) {
  const titleId = useId();
  const [step, setStep] = useState<number | "done">(() => readStep(role));
  const [dismissed, setDismissed] = useState(() => readStep(role) === "done");

  useEffect(() => {
    function onReplay(event: Event) {
      const detail = (event as CustomEvent<{ role?: TourRole }>).detail;
      if (detail?.role !== role) return;
      setStep(0);
      setDismissed(false);
    }
    window.addEventListener(EVENT, onReplay);
    return () => window.removeEventListener(EVENT, onReplay);
  }, [role]);

  if (dismissed || step === "done") return null;

  const steps = STEPS[role];
  const currentStep = typeof step === "number" ? step : 0;
  const current = steps[currentStep];
  if (!current) return null;
  const last = currentStep === steps.length - 1;

  function finish() {
    writeStep(role, "done");
    setStep("done");
    setDismissed(true);
  }

  function next() {
    if (last) {
      finish();
      return;
    }
    const value = currentStep + 1;
    writeStep(role, value);
    setStep(value);
  }

  function previous() {
    if (currentStep === 0) return;
    const value = currentStep - 1;
    writeStep(role, value);
    setStep(value);
  }

  return (
    <section className={styles.tour} role="dialog" aria-labelledby={titleId} aria-live="polite">
      <header className={styles.header}>
        <p className={styles.kicker}>
          Guided tour · {currentStep + 1} of {steps.length}
        </p>
        <button type="button" className={styles.close} onClick={finish} aria-label="Skip the tour">
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <h2 id={titleId} className={styles.title}>
        {current.title}
      </h2>
      <p className={styles.body}>{current.body}</p>
      <Link className={styles.open} to={current.to} onClick={finish}>
        {current.link} <ArrowRight size={12} aria-hidden="true" />
      </Link>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.ghost}
          onClick={previous}
          disabled={currentStep === 0}
          aria-label="Previous step"
        >
          <ArrowLeft size={13} aria-hidden="true" />
          Back
        </button>
        <div className={styles.right}>
          <button type="button" className={styles.textButton} onClick={finish}>
            Skip
          </button>
          <button type="button" className={styles.primary} onClick={next}>
            {last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </section>
  );
}
