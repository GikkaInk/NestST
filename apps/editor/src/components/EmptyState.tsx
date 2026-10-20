/** A friendly placeholder for an empty list, with one obvious next step. */
export function EmptyState(props: {
  title: string;
  text: string;
  actionLabel: string;
  onAction(): void;
  disabled?: boolean;
}) {
  return (
    <div className="empty-state">
      <h3 className="empty-state__title">{props.title}</h3>
      <p className="hint">{props.text}</p>
      <button type="button" className="button" disabled={props.disabled} onClick={props.onAction}>
        {props.actionLabel}
      </button>
    </div>
  );
}
