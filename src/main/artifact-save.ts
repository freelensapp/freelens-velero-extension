// The file a text is saved into: the one the operator chooses in the dialog of the host, and no other.
// The dialog is suggested a name and no folder, and is told what is saved. Nothing is written when the
// operator closes it, nor when the text is not to be saved any more by the time a file is chosen.

// What is asked of the dialog of the host: the title says what is saved, and the message says the same
// over the fields of the dialog where the system shows no title.
export interface SaveDialog {
  showSaveDialog(options: {
    title: string;
    message: string;
    defaultPath: string;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

// The module of Electron, imported when a text is saved and never when this is loaded: the bundle of the
// main process is loaded as well where there is no host, by the proofs of the test environment and the
// test of the build, which save nothing.
async function electronDialog(): Promise<{ dialog: SaveDialog }> {
  const electron = await import("electron");

  return { dialog: electron.dialog ?? electron.default.dialog };
}

// The dialog of the host, asked of the module of Electron each time a text is saved, and not kept from
// when this was loaded: what stands in the place of the dialog of the module at that moment is what is
// asked, which is how a suite answers for the operator.
export function hostDialog(
  electron: () => Promise<{ dialog: SaveDialog }> | { dialog: SaveDialog } = electronDialog,
): SaveDialog {
  return { showSaveDialog: async (options) => (await electron()).dialog.showSaveDialog(options) };
}

// `still` is asked when the operator has chosen a file, which may be long after the dialog opened: a text
// whose load was dropped meanwhile is not written, and neither is one of a frame that went.
export async function saveThroughDialog(
  dialog: SaveDialog,
  write: (file: string, content: Buffer) => Promise<void>,
  suggested: { name: string; title: string },
  content: Buffer,
  still: () => boolean = () => true,
): Promise<boolean> {
  const chosen = await dialog.showSaveDialog({
    title: suggested.title,
    message: suggested.title,
    defaultPath: suggested.name,
  });

  if (chosen.canceled || !chosen.filePath || !still()) return false;
  await write(chosen.filePath, content);
  return true;
}
