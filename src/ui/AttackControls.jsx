import { useState } from "react";
import { canSendWarParty, MAX_PARTY_SENT } from "../game/rivalcamp.js";

export default function AttackControls({ world, campId, onWarParty }) {
  const [requested, setRequested] = useState(3);
  const available = canSendWarParty(world, campId, MAX_PARTY_SENT);
  const count = Math.max(1, Math.min(requested, available.most || 1));
  return <div className="attack-controls">
    <label>People to send <select aria-label={`Attack village ${campId}: people to send`} value={count} disabled={!available.ok} onChange={e => setRequested(Number(e.target.value))}>
      {Array.from({length: available.most || 1}, (_,i) => <option key={i+1} value={i+1}>{i+1}</option>)}
    </select></label>
    <button className="job danger" disabled={!available.ok} onClick={() => onWarParty(campId,count)}><span>Attack village {campId}</span><em>{available.ok ? `${count} people` : available.reason}</em></button>
    <p className="small muted">At least one worker stays home. Attackers breach defences, destroy village buildings, then assault the headquarters. Spears and training improve their chances.</p>
  </div>;
}
