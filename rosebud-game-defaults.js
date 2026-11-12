/*
 * Preserve browser input events for game handlers while suppressing native
 * browser actions that do not belong on a game surface, and release held input
 * when the game loses focus.
 */

(() => {
  const browserContextMenuSelector = [
    "input",
    "textarea",
    "select",
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    "[data-allow-browser-context-menu]",
  ].join(", ");

  document.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest(browserContextMenuSelector)
      ) {
        return;
      }

      event.preventDefault();
    },
    { capture: true },
  );

  document.addEventListener(
    "dragstart",
    (event) => {
      event.preventDefault();
    },
    { capture: true },
  );

  // A key, mouse button or touch held while the game loses focus (a click into
  // the editor, a tab or app switch) never gets its release event, so games
  // tracking held input keep acting on it. Send the missing releases where each
  // press started.
  const heldKeys = new Map();
  // Pointers are tracked separately from mouse buttons: games that call
  // preventDefault on pointerdown suppress the mousedown fallback.
  const heldPointers = new Map();
  const heldMouseButtons = new Map();
  // Releases land where the pointer last was, so a drag is not dropped back at
  // its start.
  const lastPosition = { clientX: 0, clientY: 0 };
  const releaseEvents = new WeakSet();

  const track = (type, handler) =>
    window.addEventListener(
      type,
      (event) => {
        if (!releaseEvents.has(event)) handler(event);
      },
      { capture: true },
    );
  // Only the mouse: touch contacts are cancelled, not released at a position.
  const remember = (event) => {
    if (event.pointerType !== undefined && event.pointerType !== "mouse") return;
    lastPosition.clientX = event.clientX;
    lastPosition.clientY = event.clientY;
  };
  track("keydown", (event) => heldKeys.set(event.code || event.key, event));
  track("keyup", (event) => heldKeys.delete(event.code || event.key));
  track("pointerdown", (event) => {
    remember(event);
    heldPointers.set(event.pointerId, event);
  });
  track("pointermove", remember);
  track("pointerup", (event) => heldPointers.delete(event.pointerId));
  track("pointercancel", (event) => heldPointers.delete(event.pointerId));
  track("mousedown", (event) => {
    remember(event);
    heldMouseButtons.set(event.button, event);
  });
  track("mousemove", remember);
  track("mouseup", (event) => heldMouseButtons.delete(event.button));

  const dispatchRelease = (pressed, release) => {
    releaseEvents.add(release);
    const target = pressed.target;
    (target && target.isConnected !== false ? target : document).dispatchEvent(
      release,
    );
  };

  const releaseHeldInput = () => {
    const keys = [...heldKeys.values()];
    const pointers = [...heldPointers.values()];
    const buttons = [...heldMouseButtons.values()];
    heldKeys.clear();
    heldPointers.clear();
    heldMouseButtons.clear();

    for (const pressed of keys) {
      const release = new KeyboardEvent("keyup", {
        key: pressed.key,
        code: pressed.code,
        location: pressed.location,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      // Many games still read these; the KeyboardEvent constructor cannot set them.
      for (const legacy of ["keyCode", "which"]) {
        Object.defineProperty(release, legacy, { value: pressed[legacy] });
      }
      dispatchRelease(pressed, release);
    }

    if (typeof PointerEvent === "function") {
      for (const pressed of pointers) {
        // A mouse button is let go; a touch or pen contact is cancelled, so
        // drag games revert instead of dropping at the last position.
        const isMouse = pressed.pointerType === "mouse";
        dispatchRelease(
          pressed,
          new PointerEvent(isMouse ? "pointerup" : "pointercancel", {
            pointerId: pressed.pointerId,
            pointerType: pressed.pointerType,
            isPrimary: pressed.isPrimary,
            button: pressed.button,
            buttons: 0,
            ...(isMouse
              ? lastPosition
              : { clientX: pressed.clientX, clientY: pressed.clientY }),
            bubbles: true,
            cancelable: isMouse,
            composed: true,
          }),
        );
      }
    }

    for (const pressed of buttons) {
      dispatchRelease(
        pressed,
        new MouseEvent("mouseup", {
          button: pressed.button,
          buttons: 0,
          ...lastPosition,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
  };

  window.addEventListener("blur", releaseHeldInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseHeldInput();
  });
})();
