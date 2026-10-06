import { describe, expect, it, vi } from "vitest";
import { hostDialog, saveThroughDialog } from "./artifact-save";

const SUGGESTED = { name: "nightly-logs.txt", title: "Save the log of the backup nightly" };

describe("the file an artifact is saved into", () => {
  it("is the one the operator chooses in the dialog of the host, which is suggested the name of the artifact and says what is saved", async () => {
    const write = vi.fn(async () => undefined);
    const dialog = {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: "/chosen/by/the/operator.txt" })),
    };
    const content = Buffer.from("synthetic log");

    await expect(saveThroughDialog(dialog, write, SUGGESTED, content)).resolves.toBe(true);
    // The dialog is given a name and no folder: where the file goes is the choice of the operator. It is
    // given what is saved as its title, and as the words over its fields where the system shows no title.
    expect(dialog.showSaveDialog).toHaveBeenCalledWith({
      title: "Save the log of the backup nightly",
      message: "Save the log of the backup nightly",
      defaultPath: "nightly-logs.txt",
    });
    expect(write).toHaveBeenCalledWith("/chosen/by/the/operator.txt", content);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the operator closes the dialog, or the dialog gives no file", async () => {
    for (const chosen of [
      { canceled: true, filePath: "/a/file/that/was/not/chosen.txt" },
      { canceled: true },
      { canceled: false },
      { canceled: false, filePath: "" },
    ]) {
      const write = vi.fn(async () => undefined);

      await expect(
        saveThroughDialog({ showSaveDialog: async () => chosen }, write, SUGGESTED, Buffer.from("x")),
      ).resolves.toBe(false);
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("writes nothing of a text that is not to be saved any more when the dialog is answered", async () => {
    const write = vi.fn(async () => undefined);
    const asked: string[] = [];
    let kept = true;
    const dialog = {
      showSaveDialog: async () => {
        // The text is let go while the dialog is open.
        kept = false;
        return { canceled: false, filePath: "/chosen/by/the/operator.txt" };
      },
    };
    const still = () => {
      asked.push("still");
      return kept;
    };

    await expect(saveThroughDialog(dialog, write, SUGGESTED, Buffer.from("x"), still)).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
    // It is looked at when the file is chosen, which is when the write would be made.
    expect(asked).toEqual(["still"]);
    // A text that is still to be saved then is written.
    await expect(
      saveThroughDialog(
        { showSaveDialog: async () => ({ canceled: false, filePath: "/chosen.txt" }) },
        write,
        SUGGESTED,
        Buffer.from("x"),
        () => true,
      ),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("raises what the write raises, for what asked to say that the file was not written", async () => {
    const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: "/read-only/file.txt" }) };

    await expect(
      saveThroughDialog(
        dialog,
        async () => {
          throw new Error("EACCES");
        },
        SUGGESTED,
        Buffer.from("x"),
      ),
    ).rejects.toThrow("EACCES");
  });
});

describe("the dialog of the host", () => {
  it("is asked of the module of Electron at each save: what stands in its place then is what is asked", async () => {
    const asked: string[] = [];
    const answer = (by: string) => async (options: { defaultPath: string }) => {
      asked.push(`${by} ${options.defaultPath}`);
      return { canceled: true };
    };
    const electron = { dialog: { showSaveDialog: answer("the host") } };
    const modules: string[] = [];
    const dialog = hostDialog(() => {
      modules.push("electron");
      return electron;
    });

    // Nothing is asked of the module before a text is saved.
    expect(modules).toEqual([]);
    await dialog.showSaveDialog({ title: "a", message: "a", defaultPath: "first.txt" });
    // The function of the module is replaced after this was made, as a suite replaces it: the next save
    // asks the one that is there, and not one that was kept.
    electron.dialog.showSaveDialog = answer("its stand-in");
    await dialog.showSaveDialog({ title: "b", message: "b", defaultPath: "second.txt" });
    // And so is the dialog of the module itself.
    electron.dialog = { showSaveDialog: answer("another dialog") };
    await dialog.showSaveDialog({ title: "c", message: "c", defaultPath: "third.txt" });
    expect(asked).toEqual(["the host first.txt", "its stand-in second.txt", "another dialog third.txt"]);
    expect(modules).toHaveLength(3);
  });

  it("is asked as a method of the dialog of the module, which is what the function of the host expects", async () => {
    const electron = {
      dialog: {
        owner: "the dialog of the host",
        async showSaveDialog(this: { owner: string }) {
          return { canceled: false, filePath: this.owner };
        },
      },
    };

    await expect(
      hostDialog(() => electron).showSaveDialog({ title: "a", message: "a", defaultPath: "a.txt" }),
    ).resolves.toEqual({ canceled: false, filePath: "the dialog of the host" });
  });
});
