// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "./workspace";

afterEach(cleanup);

describe("Escape in the view of one object", () => {
  it("leaves the view from wherever the focus is in it, and never from inside a text field", () => {
    const onBack = vi.fn();

    render(
      <Workspace kind="backup" name="nightly" back="Backups" onBack={onBack}>
        <input data-testid="field" />
        <input type="search" data-testid="search" />
        <textarea data-testid="area" />
        <input type="checkbox" data-testid="choice" />
        <input type="radio" data-testid="one-of-several" />
        <input type="button" data-testid="input-command" value="A command of an input" />
        <input type="submit" data-testid="input-submit" />
        <input type="reset" data-testid="input-reset" />
        <button type="button" data-testid="command">
          A command
        </button>
        <p data-testid="words">Words of the view</p>
      </Workspace>,
    );
    // A text field keeps the key for what was typed in it: the view is not left by a key meant for it.
    for (const field of ["field", "search", "area"]) fireEvent.keyDown(screen.getByTestId(field), { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
    // Another key of a field is no way back either.
    fireEvent.keyDown(screen.getByTestId("field"), { key: "Enter" });
    expect(onBack).not.toHaveBeenCalled();
    // Everything else in the view leaves it, as the view itself does: a choice holds no text, whether it
    // is one of its own or one among several, and neither does an input that is a command.
    const others = [
      "choice",
      "one-of-several",
      "input-command",
      "input-submit",
      "input-reset",
      "command",
      "words",
      "velero-backup-workspace",
    ];

    others.forEach((part, index) => {
      fireEvent.keyDown(screen.getByTestId(part), { key: "Escape" });
      expect([part, onBack.mock.calls.length]).toEqual([part, index + 1]);
    });
  });
});
