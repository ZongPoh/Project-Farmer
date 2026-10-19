import { useState } from "react";

export default function JobAccess({ tile, onRetry, onFocus }) {
  const [feedback, setFeedback] = useState("");
  if (!tile.work?.accessBlocked) return null;
  return <section className="job-access" aria-label={`Unreachable job at ${tile.q},${tile.r}`}>
    <strong>⚠ Unreachable · Action needed</strong>
    <p>No worker can find a route to this job. Work is paused and completed progress is kept.</p>
    <p className="small">Inspect the approach. Open a gap in a wall or fence, finish a gate, or work from reachable land to clear a path through water or rock. Workers need a walkable tile beside water and mountains.</p>
    <p className="small">Changing priority or waiting won’t resume this job. Fix access, then check the route.</p>
    <div className="job-access-actions">
      <button onClick={() => onFocus(tile)}>Inspect job location</button>
      <button onClick={() => setFeedback(onRetry(tile).reason)}>Check route &amp; resume</button>
    </div>
    {feedback && <p className="small" role="status">{feedback}</p>}
  </section>;
}
