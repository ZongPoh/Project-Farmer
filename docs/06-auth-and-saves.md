> **HISTORICAL — this describes the game as it was, not as it is.**
>
> **Firebase has since been dropped entirely.** There is no login and no
> Firestore: the game saves to a JSON file the player downloads (and autosaves
> to browser storage as a safety net). See `src/game/persistence.js`.
>
> Written during step 6, before hours, workers, forest, the base levels,
> the rivals and everything after. Following it would build the wrong thing.
> It is kept because the *reasoning* in it is still good and the decisions it
> records are still the decisions that were made.
>
> For how the game works now, read `docs/07-the-game-now.md`, then the module
> headers in `src/game/` — those are maintained with the code and this is not.

# Step 6 — Login and saving

Leave this until last. A half-built game with no login is far more useful than
a login screen with no game.

## Why the save is easy already

`world` is a plain object, and `serialize(world)` turns its `Map` into an
array because Firestore cannot store a `Map`. `deserialize` puts it back.
There is already a test covering the round-trip.

## Setup

```bash
npm install firebase
```

`src/firebase.js`:

```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const app = initializeApp({ /* config from the Firebase console */ });
export const auth = getAuth(app);
export const db = getFirestore(app);
```

Put the config in `.env.local` as `VITE_FIREBASE_API_KEY` etc. and read it
with `import.meta.env.VITE_...`. Note these values ship to the browser and
are **not** secret — a Firebase web API key is an identifier, not a password.
What protects your data is security rules, not hiding the key.

## Auth

Start with `signInAnonymously`. The player gets a save with no signup friction,
and you can upgrade the same account to Google or email later without losing
it. That single choice removes the biggest drop-off in a hobby game.

## Storing

One document per player: `saves/{uid}` holding
`{ world: serialize(world), savedAt: Date.now() }`.

Rules, so nobody can read anyone else's save:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /saves/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Offline progress

On load: read `savedAt`, call `daysSince(savedAt)`, then `advanceDays(world, n)`.
Show the player what they missed using the events it returns — that list of
"while you were away" lines is the most satisfying part of an idle game, and
you get it for free because time only moves in one function.

## Watch out for

- **Do not save on every change.** Debounce to every 10 seconds or on tab
  close, or you will burn through Firestore writes.
- **Validate on load.** A save from an older version may lack fields you now
  expect. Merge it over a fresh `createWorld` result rather than trusting it.
