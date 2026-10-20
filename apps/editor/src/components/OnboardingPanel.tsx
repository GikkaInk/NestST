import { useState } from "react";
import { canPlay, playMapId } from "../editorStore.js";
import type { EditorState, EditorStore } from "../editorStore.js";
import { canEditMode } from "../editorForms.js";
import { LABELS, ONBOARDING_LABELS } from "../labels.js";
import { allDone, findLineTarget, getOnboardingSteps } from "../onboarding.js";
import type { OnboardingStepId } from "../onboarding.js";
import { readOnboardingHidden, writeOnboardingHidden } from "../onboardingPrefs.js";
import { useEditorState } from "../useEditorState.js";

/** Why Play is unavailable, or null. Task 5 replaces this with the shared reason. */
function playBlockedReason(s: EditorState): string | null {
  if (canPlay(s)) return null;
  if (playMapId(s) === null) return LABELS.noStartPoint;
  if (s.refProblems.length > 0) return LABELS.onboardingFixRefs;
  return null;
}

/** Collapsible "First steps" checklist shown above the map. */
export function OnboardingPanel({ store }: { store: EditorStore }) {
  const s = useEditorState(store);
  const [hidden, setHidden] = useState(readOnboardingHidden);
  // null = follow progress: expanded until every step is done, then collapsed.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  if (hidden || s.project === null) return null;

  const steps = getOnboardingSteps(s);
  const complete = allDone(steps);
  const editable = canEditMode(s.mode);

  const close = () => {
    writeOnboardingHidden(true);
    setHidden(true);
  };

  const open = expanded ?? !complete;
  if (complete && !open) {
    return (
      <section className="onboarding onboarding--done" aria-label={LABELS.onboardingTitle}>
        <span className="onboarding__title">{LABELS.onboardingAllSet}</span>
        <button type="button" className="onboarding__btn" onClick={() => setExpanded(true)}>
          {LABELS.onboardingShowAgain}
        </button>
        <button type="button" className="onboarding__close" aria-label={LABELS.onboardingClose} onClick={close}>
          ×
        </button>
      </section>
    );
  }

  const target = findLineTarget(s);
  const act = (id: OnboardingStepId) => {
    if (id === "ground") store.selectTool("brush");
    else if (id === "start") store.selectTool("spawn");
    else if (id === "character") store.selectTool("npc");
    else if (id === "line") {
      if (target !== null) store.newDialogForObject(target.objectId);
    } else store.play();
  };
  const reasonFor = (id: OnboardingStepId): string | null =>
    id === "line" && target === null ? LABELS.onboardingNeedCharacter : id === "play" ? playBlockedReason(s) : null;

  return (
    <section className="onboarding" aria-label={LABELS.onboardingTitle}>
      <div className="onboarding__head">
        <h2 className="onboarding__title">{LABELS.onboardingTitle}</h2>
        {complete && (
          <button type="button" className="onboarding__btn" onClick={() => setExpanded(false)}>
            {LABELS.onboardingCollapse}
          </button>
        )}
        <button type="button" className="onboarding__close" aria-label={LABELS.onboardingClose} onClick={close}>
          ×
        </button>
      </div>
      <ol className="onboarding__steps">
        {steps.map((step) => {
          const l = ONBOARDING_LABELS[step.id];
          const reason = step.done ? null : reasonFor(step.id);
          return (
            <li key={step.id} className="onboarding__step" data-done={step.done}>
              <span className="onboarding__check" aria-hidden="true">
                {step.done ? "✓" : "○"}
              </span>
              <span className="onboarding__text">{l.text}</span>
              {!step.done && (
                <button
                  type="button"
                  className="onboarding__btn"
                  aria-label={`${l.action}: ${l.text}`}
                  disabled={!editable || reason !== null}
                  onClick={() => act(step.id)}
                >
                  {l.action}
                </button>
              )}
              {reason !== null && <span className="onboarding__reason">{reason}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
