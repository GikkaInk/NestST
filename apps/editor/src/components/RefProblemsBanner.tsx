interface Props {
  problems: readonly string[];
}

/** Persistent strip about broken references; it goes away by itself once they are fixed. */
export function RefProblemsBanner({ problems }: Props) {
  if (problems.length === 0) return null;
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
  return (
    <div className="notice-banner" role="status" data-testid="ref-problems">
      <span className="notice-banner__face" aria-hidden="true">
        (・_・;)
      </span>
      <div className="notice-banner__text">
        <p>
          This project has broken references ({problems[0]}){more}. Fix them before saving or playing.
        </p>
        {problems.length > 1 && (
          <details>
            <summary>Show all</summary>
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
