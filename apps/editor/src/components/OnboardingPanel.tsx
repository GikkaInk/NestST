import { useState } from "react";
import { playBlockedReason } from "../editorStore.js";
import type { EditorStore } from "../editorStore.js";
import { canEditMode } from "../editorForms.js";
import { LABELS, ONBOARDING_LABELS } from "../labels.js";
import { allDone, findLineTarget, getOnboardingSteps } from "../onboarding.js";
import type { OnboardingStepId } from "../onboarding.js";
import { readOnboardingHidden, writeOnboardingHidden } from "../onboardingPrefs.js";
import { useEditorState } from "../useEditorState.js";

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

  const doneCount = steps.filter((x) => x.done).length;
  if (!open) {
    return (
      <section className="onboarding onboarding--done" aria-label={LABELS.onboardingTitle}>
        <span className="onboarding__title">
          {LABELS.onboardingTitle} · {LABELS.onboardingProgress(doneCount, steps.length)}
        </span>
        <button
          type="button"
          className="onboarding__btn"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          {LABELS.onboardingExpand}
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
  const characterDone = steps.find((x) => x.id === "character")!.done;
  const reasonFor = (id: OnboardingStepId): string | null => {
    if (id === "line") return target === null ? LABELS.onboardingNeedCharacter : null;
    if (id === "play") return playBlockedReason(s) ?? (characterDone ? null : LABELS.onboardingNeedCharacterFirst);
    return null;
  };

  return (
    <section className="onboarding" aria-label={LABELS.onboardingTitle}>
      <div className="onboarding__head">
        <h2 className="onboarding__title">{LABELS.onboardingTitle}</h2>
        <button
          type="button"
          className="onboarding__btn"
          aria-expanded={true}
          onClick={() => setExpanded(false)}
        >
          {LABELS.onboardingCollapseSteps}
        </button>
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
              <span className="visually-hidden">{step.done ? LABELS.onboardingDone : LABELS.onboardingTodo}</span>
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
