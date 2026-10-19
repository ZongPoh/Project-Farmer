/**
 * A wall between a throw inside the 3D canvas and the rest of the game.
 *
 * This exists because of a real incident. Demolishing a building left a stale
 * reference in a `useMemo` the renderer was working from, the component did
 * `LOOK[null.id]`, React unmounted the whole tree, and the player lost the
 * entire app — resources, selection, the lot — for a rendering mistake that
 * had nothing to do with their farm. The simulation was fine the whole time.
 *
 * That specific bug is fixed and tested. This is the guard for the next one:
 * the world lives in App's state, not in here, so a crash in the canvas now
 * costs you the picture and nothing else, and "reload the view" puts it back
 * without touching a single tile.
 *
 * A class component, because `componentDidCatch` has no hook equivalent —
 * this is the one place in the codebase where that is still true.
 */
import { Component } from "react";

export default class CanvasBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Worth keeping: the component stack says which part of the scene threw,
    // which the message alone usually does not.
    console.error("The board stopped drawing:", error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="board-crashed">
        <h2>The view stopped drawing</h2>
        <p>
          Your farm is fine — this is the picture, not the game. Nothing has
          been lost, and the day is still running.
        </p>
        <pre>{String(this.state.error && this.state.error.message)}</pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Draw it again
        </button>
      </div>
    );
  }
}
