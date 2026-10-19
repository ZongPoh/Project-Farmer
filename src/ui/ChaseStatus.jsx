import { catchStatus, CATCH_PATIENCE } from "../game/horses.js";

/**
 * Horse chases, always on screen.
 *
 * The tile panel cannot carry this: you ask for a horse from its tile, and the
 * horse walks off that tile within a day, taking the panel's view of it along.
 * So the chase gets its own strip on the map, like a battle does, with a way to
 * find the horse and a way to call it off.
 */
export default function ChaseStatus({ world, onFocus, onCancel }) {
  const chases = catchStatus(world);
  if (!chases.length) return null;
  return (
    <aside className="chase-status" aria-label="Horse catch orders">
      {chases.map(({ order, horse, worker, marked, state, distance, patienceLeft }) => (
        <section key={order.id}>
          <strong>{marked ? "Catching the marked horse" : "Catching a horse"}</strong>
          <p>
            {state === "waiting"
              ? "Waiting for a free worker."
              : state === "roping"
              ? `${worker.name} is alongside it, trying to get a rope on.`
              : `${worker.name} is ${distance} tile${distance === 1 ? "" : "s"} behind it.`}
          </p>
          {patienceLeft != null && (
            <label className="combat-meter">
              Patience · {patienceLeft}h of {CATCH_PATIENCE}h
              <progress aria-label="Patience left" value={patienceLeft} max={CATCH_PATIENCE} />
            </label>
          )}
          <div>
            {horse && <button onClick={() => onFocus(horse)}>Find horse</button>}
            {worker && <button onClick={() => onFocus(worker)}>Find {worker.name}</button>}
            <button onClick={() => onCancel(order.id)}>Call off</button>
          </div>
        </section>
      ))}
      <small>Horses wander once a day and bolt when a rope misses. Patience refills whenever the worker closes the gap.</small>
    </aside>
  );
}
